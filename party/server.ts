import type * as Party from "partykit/server";
import type { GameCtx, GameDef } from "../shared/game";
import {
  AVATARS,
  MAX_NAME,
  MAX_PLAYERS,
  PLAYER_COLORS,
  type ChatMsg,
  type ClientMsg,
  type GameResult,
  type Player,
  type RoomWire,
  type ServerMsg,
} from "../shared/types";
import { CATALOG_BY_ID } from "../games/catalog";
import { GAME_DEFS } from "../games/server-registry";
import { clientIp, isPublicRoomId, Limiter, LIMITS_ROOM, type LimitKind } from "./limits";

const HOST_HANDOFF_MS = 8_000; // host must be gone this long before someone else takes over
const REMOVE_AFTER_MS = 60_000; // disconnected lobby players disappear after this
const EMPTY_ROOM_GRACE_MS = 30_000; // a running game survives everyone refreshing at once
const CHAT_LIMIT = 80;
const CHAT_BURST = 6; // chat messages allowed per window, per player
const CHAT_WINDOW_MS = 5_000;
const MSG_RATE = 60; // sustained messages/second per connection (drawing sends ~25/s)
const MSG_BURST = 120;
/** Sockets per room (12 players + spectators + spare tabs). */
const MAX_SOCKETS = 30;
/** A socket that keeps flooding past the rate limit is dropped. */
const MAX_DROPPED = 200;

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });

/** Ask the internal limiter room. Local dev has no client IP and is never limited. */
async function allowed(
  parties: Party.Context["parties"],
  kind: LimitKind,
  ip: string | null,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!ip) return { ok: true };
  try {
    const res = await parties.main.get(LIMITS_ROOM).fetch({ method: "POST", body: JSON.stringify({ kind, ip }) });
    return (await res.json()) as { ok: true } | { ok: false; reason: string };
  } catch {
    return { ok: true }; // never lock everyone out because the limiter hiccuped
  }
}

interface ActiveGame {
  def: GameDef;
  state: unknown;
  ctx: GameCtx;
  timer: ReturnType<typeof setInterval> | null;
}

/**
 * Connection ids double as public player ids (everyone in the room sees them),
 * so a connection only counts as that player once it proves it holds the
 * player's secret key in "hello". Unverified sockets get nothing and can do nothing.
 */
type ConnState = { verified: true };
type Conn = Party.Connection<ConnState>;

export default class RuckusRoom implements Party.Server {
  options: Party.ServerOptions = { hibernate: false };

  /** Runs at the edge before a socket reaches a room: bad ids and connect floods stop here. */
  static async onBeforeConnect(req: Party.Request, lobby: Party.Lobby) {
    if (!isPublicRoomId(lobby.id)) return new Response("Not found", { status: 404 });
    const verdict = await allowed(lobby.parties, "connect", clientIp(req));
    if (!verdict.ok) return new Response(verdict.reason, { status: 429 });
    return req;
  }

  /** HTTP to a room id that isn't public (e.g. the internal limiter) never gets through. */
  static async onBeforeRequest(req: Party.Request, lobby: Party.Lobby) {
    if (!isPublicRoomId(lobby.id)) return new Response("Not found", { status: 404 });
    return req;
  }

  /** Set when someone creates the room; joining a room nobody created is refused. */
  created = false;
  /** Only used by the internal "__limits" room. */
  limiter = new Limiter();
  /** Messages dropped by the rate limiter, per connection id. */
  dropped = new Map<string, number>();

  players = new Map<string, Player>();
  /** Secret key per player id, set by the first verified hello. */
  keys = new Map<string, string>();
  /** Open verified sockets per player id (a player can have two tabs open). */
  sockets = new Map<string, number>();
  disconnectedAt = new Map<string, number>();
  hostId: string | null = null;
  phase: RoomWire["phase"] = "lobby";
  gameId = "sketch";
  participants: string[] = [];
  chat: ChatMsg[] = [];
  wins: Record<string, number> = {};
  result: GameResult | null = null;
  game: ActiveGame | null = null;
  housekeeping: ReturnType<typeof setInterval> | null = null;
  emptySince: number | null = null;
  chatSeq = 0;
  /** Increments on every game start so clients remount the game UI ("Play again"). */
  gameSeq = 0;
  /** Per-connection token buckets so one client can't flood the room. */
  buckets = new Map<string, { tokens: number; at: number }>();
  /** Recent chat timestamps per player for chat-specific throttling. */
  chatTimes = new Map<string, number[]>();
  /** Last game view JSON sent to each player id: unchanged views aren't re-sent. */
  lastView = new Map<string, string>();

  constructor(readonly room: Party.Room) {}

  // ---------- connection lifecycle ----------

  onConnect(conn: Conn) {
    const open = [...this.room.getConnections()].length;
    if (open > MAX_SOCKETS) {
      conn.close(4029, "room is full");
      return;
    }
    // Nothing is sent until the client verifies itself with "hello".
    this.ensureHousekeeping();
  }

  /**
   * HTTP API: POST creates the room (rate limited per IP, plus a daily global cap);
   * GET says whether it exists. The internal limiter room answers limit checks.
   */
  async onRequest(req: Party.Request) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (this.room.id === LIMITS_ROOM) {
      if (req.method !== "POST") return new Response("Not found", { status: 404 });
      const { kind, ip } = (await req.json()) as { kind: LimitKind; ip: string };
      if ((kind !== "create" && kind !== "connect") || typeof ip !== "string") return json({ ok: true });
      return json(this.limiter.check(kind, ip, Date.now()));
    }
    const exists = this.created || this.players.size > 0;
    if (req.method === "GET") return json({ exists });
    if (req.method === "POST") {
      if (exists) return json({ ok: true, existed: true });
      const verdict = await allowed(this.room.context.parties, "create", clientIp(req));
      if (!verdict.ok) return json({ ok: false, error: verdict.reason }, 429);
      this.created = true;
      this.emptySince = Date.now(); // nobody has joined yet: the usual empty-room rules apply
      this.ensureHousekeeping();
      return json({ ok: true });
    }
    return new Response("Method not allowed", { status: 405, headers: CORS });
  }

  onClose(conn: Conn) {
    // Complete the closing handshake; the Workers runtime doesn't reply on its own,
    // which otherwise leaves clients stuck in CLOSING.
    try {
      conn.close();
    } catch {
      /* already closed */
    }
    if (!conn.state?.verified) {
      if (this.sockets.size === 0 && this.emptySince === null) this.emptySince = Date.now();
      return;
    }
    const left = (this.sockets.get(conn.id) ?? 1) - 1;
    if (left > 0) {
      this.sockets.set(conn.id, left);
      return;
    }
    this.sockets.delete(conn.id);
    this.buckets.delete(conn.id);
    if (this.sockets.size === 0) this.emptySince = Date.now();
    const p = this.players.get(conn.id);
    if (!p) return;
    p.connected = false;
    this.disconnectedAt.set(p.id, Date.now());
    if (this.game && this.participants.includes(p.id)) {
      try {
        this.game.def.playerLeft?.(this.game.state, p.id, this.game.ctx);
      } catch (err) {
        console.error(`[${this.game.def.id}] playerLeft failed`, err);
      }
      this.broadcastGame();
    }
    this.broadcastRoom();
  }

  onMessage(raw: string | ArrayBuffer | ArrayBufferView, sender: Conn) {
    if (typeof raw !== "string" || raw.length > 20_000) return;
    if (!this.allowMessage(sender.id)) {
      const n = (this.dropped.get(sender.id) ?? 0) + 1;
      this.dropped.set(sender.id, n);
      if (n > MAX_DROPPED) sender.close(4008, "too many messages");
      return;
    }
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;

    if (msg.t === "hello") return this.handleHello(sender, msg);
    if (!sender.state?.verified) return; // must say hello first
    if (msg.t === "ping") {
      // Answer immediately: the client measures the round trip and syncs its clock.
      if (typeof msg.c === "number" && Number.isFinite(msg.c)) this.sendTo(sender, { t: "pong", c: msg.c, now: Date.now() });
      return;
    }

    const player = this.players.get(sender.id);
    if (!player) return;

    switch (msg.t) {
      case "chat":
        return this.handleChat(player, msg.text);
      case "pick":
        return this.handlePick(player, msg.gameId);
      case "start":
        return this.handleStart(player, sender);
      case "lobby":
        return this.handleLobby(player);
      case "act":
        return this.handleAct(player, msg.a);
    }
  }

  // ---------- handlers ----------

  handleHello(conn: Conn, msg: Extract<ClientMsg, { t: "hello" }>) {
    const key = typeof msg.key === "string" && msg.key.length >= 16 && msg.key.length <= 64 ? msg.key : null;
    if (!key) return this.reject(conn, "Please refresh the page to join.");
    const known = this.keys.get(conn.id);
    if (known !== undefined && known !== key) {
      return this.reject(conn, "That player is already in this room on another device.");
    }

    const name = cleanText(msg.name, MAX_NAME) || "Player";
    const color = (PLAYER_COLORS as readonly string[]).includes(msg.color)
      ? msg.color
      : PLAYER_COLORS[this.players.size % PLAYER_COLORS.length];
    const avatar = (AVATARS as readonly string[]).includes(msg.avatar) ? msg.avatar : AVATARS[0];

    // Only rooms someone created can be joined (a mistyped code shouldn't make a new room).
    if (!this.created && this.players.size === 0) {
      return this.reject(conn, `There's no room with the code ${this.room.id.toUpperCase()}. Check the code, or create a new room.`);
    }
    const existing = this.players.get(conn.id);
    if (!existing && this.players.size >= MAX_PLAYERS) {
      return this.reject(conn, `This room is full (${MAX_PLAYERS} players).`);
    }

    // Verify this socket (first hello on it).
    if (!conn.state?.verified) {
      conn.setState({ verified: true });
      this.sockets.set(conn.id, (this.sockets.get(conn.id) ?? 0) + 1);
      this.emptySince = null;
    }
    this.keys.set(conn.id, key);

    if (existing) {
      const wasAway = !existing.connected;
      Object.assign(existing, { name, color, avatar, connected: true });
      this.disconnectedAt.delete(conn.id);
      if (wasAway && this.game && this.participants.includes(conn.id)) {
        try {
          this.game.def.playerReturned?.(this.game.state, conn.id, this.game.ctx);
        } catch (err) {
          console.error(`[${this.game.def.id}] playerReturned failed`, err);
        }
        this.broadcastGame();
      }
    } else {
      this.players.set(conn.id, { id: conn.id, name, color, avatar, connected: true });
      this.system(`${avatar} ${name} joined`);
    }

    if (!this.hostId || !this.players.get(this.hostId)) this.hostId = conn.id;
    this.broadcastRoom();
    // The (re)joining socket gets a full sync: the chat history and the current game view.
    this.sendTo(conn, { t: "room", room: this.roomView(true), now: Date.now() });
    if (this.game) {
      const view = JSON.stringify(this.viewFor(this.game, conn.id) ?? null);
      this.lastView.set(conn.id, view);
      conn.send(gamePayload(view, Date.now()));
    }
  }

  handleChat(player: Player, text: unknown) {
    const clean = cleanText(text, 200);
    if (!clean) return;
    // At most CHAT_BURST messages per CHAT_WINDOW_MS per player.
    const now = Date.now();
    const recent = (this.chatTimes.get(player.id) ?? []).filter((t) => now - t < CHAT_WINDOW_MS);
    if (recent.length >= CHAT_BURST) return;
    recent.push(now);
    this.chatTimes.set(player.id, recent);
    this.pushChat({ id: `c${++this.chatSeq}`, from: player.id, text: clean, at: now });
  }

  handlePick(player: Player, gameId: unknown) {
    if (player.id !== this.hostId || this.phase !== "lobby") return;
    if (typeof gameId !== "string" || !CATALOG_BY_ID[gameId] || !GAME_DEFS[gameId]) return;
    this.gameId = gameId;
    this.broadcastRoom();
  }

  handleStart(player: Player, conn: Conn) {
    if (player.id !== this.hostId) return;
    const meta = CATALOG_BY_ID[this.gameId];
    const def = GAME_DEFS[this.gameId];
    if (!meta || !def) return;

    const ready = [...this.players.values()].filter((p) => p.connected);
    if (ready.length < meta.minPlayers) {
      this.sendTo(conn, {
        t: "err",
        msg: `${meta.name} needs at least ${meta.minPlayers} players.`,
        now: Date.now(),
      });
      return;
    }
    this.stopGame();

    this.participants = ready.slice(0, meta.maxPlayers).map((p) => p.id);
    this.result = null;

    const ctx = this.makeCtx();
    let state: unknown;
    try {
      state = def.setup(ctx);
    } catch (err) {
      console.error(`[${def.id}] setup failed`, err);
      this.participants = [];
      this.phase = "lobby";
      this.sendTo(conn, { t: "err", msg: `${meta.name} failed to start. Try another game.`, now: Date.now() });
      this.broadcastRoom();
      return;
    }
    this.phase = "playing";
    this.gameSeq += 1;
    this.lastView.clear();
    const active: ActiveGame = { def, state, ctx, timer: null };
    if (def.tick) {
      active.timer = setInterval(() => {
        if (this.game !== active) return;
        let changed: boolean | void = false;
        try {
          changed = def.tick!(active.state, ctx);
        } catch (err) {
          console.error(`[${def.id}] tick failed`, err);
        }
        if (changed) this.broadcastGame();
      }, def.tickMs ?? 250);
    }
    this.game = active;

    const extra = ready.length - this.participants.length;
    this.system(
      `🎮 ${meta.name} started` + (extra > 0 ? ` (${extra} watching, max ${meta.maxPlayers})` : ""),
    );
    this.broadcastRoom();
    this.broadcastGame();
  }

  handleLobby(player: Player) {
    if (player.id !== this.hostId) return;
    this.stopGame();
    this.phase = "lobby";
    this.result = null;
    this.participants = [];
    this.pruneDeparted();
    this.broadcastRoom();
  }

  handleAct(player: Player, action: unknown) {
    const game = this.game;
    if (!game) return;
    const playing = this.participants.includes(player.id);
    if (!playing && !game.def.spectatorAction) return;
    let changed: boolean | void;
    try {
      changed = playing
        ? game.def.action(game.state, player.id, action, game.ctx)
        : game.def.spectatorAction!(game.state, player.id, action, game.ctx);
    } catch (err) {
      console.error(`[${game.def.id}] action failed`, err);
      return;
    }
    if (changed !== false) this.broadcastGame();
  }

  // ---------- game plumbing ----------

  makeCtx(): GameCtx {
    const ctx: GameCtx = {
      now: () => Date.now(),
      players: this.participants.map((id) => ({ ...this.players.get(id)! })),
      player: (id) => this.players.get(id),
      random: Math.random,
      emit: (event, opts) => {
        const msg = JSON.stringify({ t: "ev", e: event, now: Date.now() } satisfies ServerMsg);
        for (const c of this.verifiedConnections()) {
          // A player may have several tabs open, so `to` matches every socket of that id.
          if (opts?.to && c.id !== opts.to) continue;
          if (opts?.except && c.id === opts.except) continue;
          c.send(msg);
        }
      },
      end: (result) => {
        if (this.result || !this.game || this.game.ctx !== ctx) return;
        this.result = result;
        for (const id of result.winners) this.wins[id] = (this.wins[id] ?? 0) + 1;
        this.system(`🏆 ${result.headline}`);
        // Keep ticking briefly so final animations settle, then stop.
        const g = this.game;
        setTimeout(() => {
          if (this.game === g && g.timer) {
            clearInterval(g.timer);
            g.timer = null;
          }
        }, 1500);
        this.broadcastRoom();
      },
    };
    return ctx;
  }

  stopGame() {
    if (this.game?.timer) clearInterval(this.game.timer);
    this.game = null;
    this.lastView.clear();
  }

  viewFor(game: ActiveGame, viewerId: string): unknown {
    try {
      return game.def.view(game.state, viewerId, game.ctx);
    } catch (err) {
      console.error(`[${game.def.id}] view failed`, err);
      return null;
    }
  }

  broadcastGame() {
    const game = this.game;
    if (!game) return;
    const now = Date.now();
    // Views are per-player (secrets!), so serialise once per player id, and skip
    // players whose view didn't change since the last send.
    const payloads = new Map<string, string | null>();
    for (const conn of this.verifiedConnections()) {
      let payload = payloads.get(conn.id);
      if (payload === undefined) {
        const view = JSON.stringify(this.viewFor(game, conn.id) ?? null);
        if (this.lastView.get(conn.id) === view) payload = null;
        else {
          this.lastView.set(conn.id, view);
          payload = gamePayload(view, now);
        }
        payloads.set(conn.id, payload);
      }
      if (payload !== null) conn.send(payload);
    }
  }

  /** Room state for everyone (without the chat history, which travels as "chat" deltas). */
  broadcastRoom() {
    const payload = JSON.stringify({ t: "room", room: this.roomView(false), now: Date.now() } satisfies ServerMsg);
    for (const conn of this.verifiedConnections()) conn.send(payload);
  }

  *verifiedConnections(): Generator<Conn> {
    for (const conn of this.room.getConnections<ConnState>()) {
      if (conn.state?.verified) yield conn;
    }
  }

  roomView(withChat: boolean): RoomWire {
    return {
      code: this.room.id,
      hostId: this.hostId,
      players: [...this.players.values()],
      phase: this.phase,
      gameId: this.gameId,
      participants: this.participants,
      ...(withChat ? { chat: this.chat } : {}),
      wins: this.wins,
      result: this.result,
      gameSeq: this.gameSeq,
    };
  }

  // ---------- housekeeping ----------

  ensureHousekeeping() {
    if (this.housekeeping) return;
    this.housekeeping = setInterval(() => this.tidy(), 2_000);
  }

  tidy() {
    let changed = false;
    const now = Date.now();

    // Hand host over if the host has been gone a while.
    const host = this.hostId ? this.players.get(this.hostId) : undefined;
    const hostAwayFor = host && !host.connected ? now - (this.disconnectedAt.get(host.id) ?? now) : 0;
    if (!host || hostAwayFor > HOST_HANDOFF_MS) {
      const next = [...this.players.values()].find((p) => p.connected);
      if (next && next.id !== this.hostId) {
        this.hostId = next.id;
        this.system(`👑 ${next.name} is now the host`);
        changed = true;
      }
    }

    if (this.pruneDeparted()) changed = true;
    if (changed) this.broadcastRoom();

    // Everyone has been gone a while: stop the game and timers so the room can idle
    // (a room that only ever saw unverified sockets counts as empty too).
    if (this.sockets.size === 0 && this.emptySince === null) this.emptySince = now;
    if (this.sockets.size === 0 && this.emptySince !== null && now - this.emptySince > EMPTY_ROOM_GRACE_MS) {
      this.stopGame();
      this.phase = "lobby";
      this.participants = [];
      this.result = null;
      if (this.housekeeping) clearInterval(this.housekeeping);
      this.housekeeping = null;
    }
  }

  /** Remove players who've been gone long enough and aren't in a running game. */
  pruneDeparted(): boolean {
    let removed = false;
    const now = Date.now();
    for (const [id, since] of this.disconnectedAt) {
      const inGame = this.game && this.participants.includes(id);
      if (inGame || now - since < REMOVE_AFTER_MS) continue;
      const p = this.players.get(id);
      this.players.delete(id);
      this.disconnectedAt.delete(id);
      this.keys.delete(id);
      this.chatTimes.delete(id);
      delete this.wins[id];
      if (p) this.system(`${p.avatar} ${p.name} left`);
      removed = true;
    }
    if (removed && this.hostId && !this.players.has(this.hostId)) this.hostId = null;
    return removed;
  }

  /** Token bucket per connection: MSG_RATE/s sustained, MSG_BURST burst. */
  allowMessage(connId: string): boolean {
    const now = Date.now();
    const b = this.buckets.get(connId) ?? { tokens: MSG_BURST, at: now };
    b.tokens = Math.min(MSG_BURST, b.tokens + ((now - b.at) / 1000) * MSG_RATE);
    b.at = now;
    this.buckets.set(connId, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  reject(conn: Conn, msg: string) {
    if (conn.state?.verified) {
      // Already in the room (e.g. a profile update with a bad key): just complain.
      this.sendTo(conn, { t: "err", msg, now: Date.now() });
      return;
    }
    this.sendTo(conn, { t: "rejected", msg, now: Date.now() });
    conn.close(4001, "rejected");
  }

  system(text: string) {
    this.pushChat({ id: `c${++this.chatSeq}`, from: null, text, at: Date.now() });
  }

  pushChat(msg: ChatMsg) {
    this.chat.push(msg);
    if (this.chat.length > CHAT_LIMIT) this.chat.splice(0, this.chat.length - CHAT_LIMIT);
    const payload = JSON.stringify({ t: "chat", msg, now: msg.at } satisfies ServerMsg);
    for (const conn of this.verifiedConnections()) conn.send(payload);
  }

  sendTo(conn: Conn, msg: ServerMsg) {
    conn.send(JSON.stringify(msg));
  }
}

/** A "game" message around an already-serialised view (no second JSON.stringify). */
function gamePayload(viewJson: string, now: number): string {
  return `{"t":"game","now":${now},"view":${viewJson}}`;
}

function cleanText(input: unknown, max: number): string {
  if (typeof input !== "string") return "";
  // Collapse whitespace and strip control characters.
  return input
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}
