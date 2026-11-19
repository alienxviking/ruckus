import { getServerByName, routePartykitRequest, Server, type Connection } from "partyserver";
import type { GameCtx, GameDef } from "../shared/game";
import {
  AVATARS,
  toAvatarId,
  MAX_NAME,
  MAX_PLAYERS,
  MAX_PAUSES,
  PAUSE_MAX_MS,
  PLAYER_COLORS,
  REACTIONS,
  type ChatMsg,
  type HistoryEntry,
  type ClientMsg,
  type GameResult,
  type Player,
  type RoomWire,
  type ServerMsg,
} from "../shared/types";
import { CATALOG, CATALOG_BY_ID } from "../games/catalog";
import { GAME_DEFS } from "../games/server-registry";
import { GAME_CONFIG } from "../games/config";
import { validSetting, type Settings } from "../shared/settings";
import { addRating, cleanErrorReport, cleanNote, clientIp, isPublicRoomId, Limiter, LIMITS_ROOM, Stats, type ErrorEntry, type LimitKind, type RatingNote, type RoomReport } from "./limits";

const HOST_HANDOFF_MS = 8_000; // host must be gone this long before someone else takes over
const REMOVE_AFTER_MS = 60_000; // disconnected lobby players disappear after this
const EMPTY_ROOM_GRACE_MS = 30_000; // a running game survives everyone refreshing at once
/** Room snapshot (survives Cloudflare restarting the room, e.g. on a deploy). */
const SNAPSHOT_KEY = "room";
const SNAPSHOT_EVERY_MS = 3_000; // at most one write per 3 s of room changes
const SNAPSHOT_TTL_MS = 6 * 3_600_000; // forgotten 6 h after the last change
const AUTO_NEXT_MS = 12_000; // quick play: pause between a result and the next game
const CHAT_LIMIT = 80;
const CHAT_BURST = 6; // chat messages allowed per window, per player
const CHAT_WINDOW_MS = 5_000;
const MSG_RATE = 60; // sustained messages/second per connection (drawing sends ~25/s)
const MSG_BURST = 120;
/** Sockets per room (12 players + spectators + spare tabs). */
const MAX_SOCKETS = 30;
/** A socket that keeps flooding past the rate limit is dropped. */
const MAX_DROPPED = 200;
const REACT_BURST = 3; // reactions per player in a burst...
const REACT_REFILL_MS = 1_500; // ...then one more every 1.5 s
const ROOM_REACTS_PER_SEC = 12; // and the whole room can't go past this
const HISTORY_LIMIT = 40;
const BOT_NAMES = ["Bolt", "Pixel", "Byte", "Chip", "Sprocket", "Widget", "Gizmo", "Servo", "Diode", "Turbo", "Nano"];
const BOT_AVATARS = ["robot", "robot+cap", "robot+shades", "alien", "robot+headphones", "alien+beanie"];

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS } });

/** Ask the internal limiter room. Local dev has no client IP and is never limited. */
async function allowed(
  env: Env,
  kind: LimitKind,
  ip: string | null,
  room: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  try {
    // Local dev (no IP) is never limited, but still counted in the stats.
    const stub = await getServerByName(env.Main, LIMITS_ROOM);
    const res = await stub.fetch(new Request("https://limits.internal/", { method: "POST", body: JSON.stringify({ kind, ip, room }) }));
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
type Conn = Connection<ConnState>;

/**
 * The player behind a socket. Each browser tab connects as "<playerId>.<random>", so sockets
 * never share an id: PartyServer keeps one connection per id, and a shared (public) player id
 * would let a second socket knock the first out of the room. Old clients send the bare id.
 */
function pid(conn: { id: string }): string {
  return conn.id.split(".")[0];
}

/** What a room saves so it survives a restart (see RuckusRoom.onStart). */
interface RoomSnapshot {
  savedAt: number;
  players: Player[];
  keys: Record<string, string>;
  hostId: string | null;
  gameId: string;
  wins: Record<string, number>;
  settings: Record<string, Settings>;
  locked: boolean;
  banned: string[];
  autoNext: boolean;
  recent: string[];
  history: HistoryEntry[];
  botSeq: number;
  gameSeq: number;
  chatSeq: number;
  chat: ChatMsg[];
  playing: boolean;
}

export class RuckusRoom extends Server<Env> {
  static options = { hibernate: false };

  /** Set when someone creates the room; joining a room nobody created is refused. */
  created = false;
  /** Only used by the internal "__limits" room. */
  limiter = new Limiter();
  stats = new Stats();
  statsLoaded = false;
  statsSaveTimer: ReturnType<typeof setTimeout> | null = null;
  /** This room's usage since it last woke up, reported to the limiter when it goes idle. */
  usage = { since: 0, http: 0, messages: 0, games: {} as Record<string, number> };
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
  /** Quick play: start a fitting game automatically after each result. */
  autoNext = false;
  next: { gameId: string; at: number } | null = null;
  nextTimer: ReturnType<typeof setTimeout> | null = null;
  /** Recently played game ids, newest last (quick play avoids repeats). */
  recent: string[] = [];
  /** Who played the last game (a full game seats those who sat out first). */
  lastPlayed: string[] = [];
  /** Host tools: nobody new can join a locked room; removed players can't come back. */
  locked = false;
  banned = new Set<string>();
  /** Host settings per game id. */
  settings: Record<string, Settings> = {};
  /** Rule-reading pause: who holds it (until when), since when, and total paused time. */
  pauseHolders = new Map<string, number>();
  pauseAt: number | null = null;
  pausedMs = 0;
  pauseUses: Record<string, number> = {};
  /** Reaction rate limits: per-player token buckets, and the room's last second. */
  reactBuckets = new Map<string, { tokens: number; at: number }>();
  roomReacts: number[] = [];
  history: HistoryEntry[] = [];
  botSeq = 0;
  /** Per-game memory kept between games in this room (see GameCtx.memory). */
  memory: Record<string, Record<string, unknown>> = {};


  /** A snapshot write is waiting (writes are batched). */
  saveTimer: ReturnType<typeof setTimeout> | null = null;

  // ---------- surviving restarts ----------
  // Rooms live in memory, and Cloudflare restarts them now and then (every deploy, runtime
  // updates). Each room keeps a small snapshot of the lobby (players, host, wins, settings),
  // so after a restart everyone reconnects into the same room. A game that was running is lost.

  async onStart() {
    if (this.name === LIMITS_ROOM) return;
    const snap = await this.ctx.storage.get<RoomSnapshot>(SNAPSHOT_KEY).catch(() => undefined);
    if (!snap || Date.now() - snap.savedAt > SNAPSHOT_TTL_MS) {
      if (snap) await this.ctx.storage.deleteAll().catch(() => {});
      return;
    }
    const now = Date.now();
    this.created = true;
    for (const p of snap.players) {
      this.players.set(p.id, { ...p, connected: !!p.bot });
      if (!p.bot) this.disconnectedAt.set(p.id, now);
    }
    this.keys = new Map(Object.entries(snap.keys));
    this.hostId = snap.hostId;
    this.gameId = CATALOG_BY_ID[snap.gameId] ? snap.gameId : this.gameId;
    this.wins = snap.wins;
    this.settings = snap.settings;
    this.locked = snap.locked;
    this.banned = new Set(snap.banned);
    this.autoNext = snap.autoNext;
    this.recent = snap.recent;
    this.history = snap.history;
    this.botSeq = snap.botSeq;
    this.gameSeq = snap.gameSeq;
    this.chatSeq = snap.chatSeq;
    this.chat = snap.chat;
    this.emptySince = now;
    if (snap.playing) this.system("Sorry, the server restarted and the game in progress was lost. Pick it again to carry on!");
    this.ensureHousekeeping();
  }

  /** Saves the snapshot soon (batched), and keeps it for 6 h after the last change. */
  scheduleSave() {
    if (this.name === LIMITS_ROOM || !this.created || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      const snap: RoomSnapshot = {
        savedAt: Date.now(),
        players: [...this.players.values()],
        keys: Object.fromEntries(this.keys),
        hostId: this.hostId,
        gameId: this.gameId,
        wins: this.wins,
        settings: this.settings,
        locked: this.locked,
        banned: [...this.banned],
        autoNext: this.autoNext,
        recent: this.recent,
        history: this.history,
        botSeq: this.botSeq,
        gameSeq: this.gameSeq,
        chatSeq: this.chatSeq,
        chat: this.chat.slice(-30),
        playing: !!this.game,
      };
      void this.ctx.storage.put(SNAPSHOT_KEY, snap).catch(() => {});
      void this.ctx.storage.setAlarm(Date.now() + SNAPSHOT_TTL_MS).catch(() => {});
    }, SNAPSHOT_EVERY_MS);
  }

  /** Six hours after the last change: forget the room for good. */
  async onAlarm() {
    try {
      if (this.name === LIMITS_ROOM) return;
    } catch {
      /* no name (shouldn't happen): just clean up below */
    }
    const snap = await this.ctx.storage.get<RoomSnapshot>(SNAPSHOT_KEY).catch(() => undefined);
    if (snap && Date.now() - snap.savedAt < SNAPSHOT_TTL_MS - 60_000) return; // changed since: a newer alarm is set
    await this.ctx.storage.deleteAll().catch(() => {});
  }

  // ---------- connection lifecycle ----------

  onConnect(conn: Conn) {
    const open = [...this.getConnections()].length;
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
  async onRequest(req: Request) {
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (this.name === LIMITS_ROOM) return this.limitsRequest(req);
    this.usage.http++;
    const exists = this.created || this.players.size > 0;
    if (req.method === "GET") return json({ exists });
    if (req.method === "POST") {
      if (exists) return json({ ok: true, existed: true });
      const verdict = await allowed(this.env, "create", clientIp(req), this.name);
      if (!verdict.ok) return json({ ok: false, error: verdict.reason }, 429);
      this.created = true;
      this.emptySince = Date.now(); // nobody has joined yet: the usual empty-room rules apply
      this.ensureHousekeeping();
      this.scheduleSave();
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
    const left = (this.sockets.get(pid(conn)) ?? 1) - 1;
    if (left > 0) {
      this.sockets.set(pid(conn), left);
      return;
    }
    this.sockets.delete(pid(conn));
    this.buckets.delete(conn.id);
    if (this.sockets.size === 0) this.emptySince = Date.now();
    const p = this.players.get(pid(conn));
    if (!p || this.banned.has(p.id)) return; // removed by the host: already handled
    p.connected = false;
    if (!this.banned.has(p.id)) this.disconnectedAt.set(p.id, Date.now());
    if (this.pauseHolders.delete(p.id) && !this.pauseHolders.size) this.resume(false);
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

  onMessage(sender: Conn, raw: string | ArrayBuffer | ArrayBufferView) {
    this.usage.messages++;
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

    const player = this.players.get(pid(sender));
    if (!player) return;

    switch (msg.t) {
      case "chat":
        return this.handleChat(player, msg.text);
      case "pick":
        return this.handlePick(player, msg.gameId);
      case "start":
        return this.handleStart(player, sender, msg.gameId);
      case "lobby":
        return this.handleLobby(player);
      case "auto":
        return this.handleAuto(player, msg.on);
      case "act":
        return this.handleAct(player, msg.a);
      case "pause":
        return this.handlePause(player, msg.on, msg.all);
      case "react":
        return this.handleReact(player, msg.e);
      case "kick":
        return this.handleKick(player, msg.id);
      case "host":
        return this.handleHostChange(player, msg.id);
      case "lock":
        return this.handleLock(player, msg.on);
      case "setting":
        return this.handleSetting(player, msg.gameId, msg.key, msg.value);
      case "bot":
        return this.handleBot(player, msg.add);
    }
  }

  // ---------- handlers ----------

  handleHello(conn: Conn, msg: Extract<ClientMsg, { t: "hello" }>) {
    const key = typeof msg.key === "string" && msg.key.length >= 16 && msg.key.length <= 64 ? msg.key : null;
    if (!key) return this.reject(conn, "Please refresh the page to join.");
    const known = this.keys.get(pid(conn));
    if (known !== undefined && known !== key) {
      return this.reject(conn, "That player is already in this room on another device.");
    }

    const name = cleanText(msg.name, MAX_NAME) || "Player";
    const color = (PLAYER_COLORS as readonly string[]).includes(msg.color)
      ? msg.color
      : PLAYER_COLORS[this.players.size % PLAYER_COLORS.length];
    const avatar = toAvatarId(msg.avatar) ?? AVATARS[0];

    // Only rooms someone created can be joined (a mistyped code shouldn't make a new room).
    if (!this.created && this.players.size === 0) {
      return this.reject(conn, `There's no room with the code ${this.name.toUpperCase()}. Check the code, or create a new room.`);
    }
    if (this.banned.has(pid(conn))) return this.reject(conn, "The host removed you from this room.");
    const existing = this.players.get(pid(conn));
    if (!existing && this.locked) return this.reject(conn, "This room is locked by the host.");
    if (!existing && this.players.size >= MAX_PLAYERS) {
      return this.reject(conn, `This room is full (${MAX_PLAYERS} players).`);
    }

    // Verify this socket (first hello on it).
    if (!conn.state?.verified) {
      conn.setState({ verified: true });
      this.sockets.set(pid(conn), (this.sockets.get(pid(conn)) ?? 0) + 1);
      this.emptySince = null;
    }
    this.keys.set(pid(conn), key);

    if (existing) {
      const wasAway = !existing.connected;
      Object.assign(existing, { name, color, avatar, connected: true });
      this.disconnectedAt.delete(pid(conn));
      if (wasAway && this.game && this.participants.includes(pid(conn))) {
        try {
          this.game.def.playerReturned?.(this.game.state, pid(conn), this.game.ctx);
        } catch (err) {
          console.error(`[${this.game.def.id}] playerReturned failed`, err);
        }
        this.broadcastGame();
      }
    } else {
      this.players.set(pid(conn), { id: pid(conn), name, color, avatar, connected: true });
      this.system(this.game ? `${name} joined · playing from the next round` : `${name} joined`, avatar);
    }

    if (!this.hostId || !this.players.get(this.hostId)) this.hostId = pid(conn);
    this.broadcastRoom();
    if (this.hostId === pid(conn)) this.sendWords(conn);
    // The (re)joining socket gets a full sync: the chat history and the current game view.
    this.sendTo(conn, { t: "room", room: this.roomView(true), now: Date.now() });
    if (this.game) {
      const view = JSON.stringify(this.viewFor(this.game, pid(conn)) ?? null);
      this.lastView.set(pid(conn), view);
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
    this.sendWords();
  }

  handleStart(player: Player, conn: Conn, gameId?: unknown) {
    if (player.id !== this.hostId) return;
    if (typeof gameId === "string" && CATALOG_BY_ID[gameId] && GAME_DEFS[gameId]) this.gameId = gameId;
    this.startGame(conn);
  }

  /** Starts the picked game. `conn` (the host) hears about problems; quick play passes none. */
  startGame(conn?: Conn): boolean {
    const meta = CATALOG_BY_ID[this.gameId];
    const def = GAME_DEFS[this.gameId];
    if (!meta || !def) return false;

    // Practice bots only take a seat in games that know how to play them.
    const ready = [...this.players.values()].filter((p) => p.connected && (!p.bot || def.bot));
    if (ready.length < meta.minPlayers) {
      if (conn) this.sendTo(conn, { t: "err", msg: `${meta.name} needs at least ${meta.minPlayers} players.`, now: Date.now() });
      return false;
    }
    // Too many for this game? Whoever sat out the last one gets a seat first.
    const last = new Set(this.lastPlayed);
    const satOut = new Set(last.size ? ready.filter((p) => !last.has(p.id)).map((p) => p.id) : []);
    ready.sort((a, b) => Number(satOut.has(b.id)) - Number(satOut.has(a.id)));
    this.stopGame();
    this.clearNext();

    // Humans before bots when seats are short.
    ready.sort((a, b) => Number(!!a.bot) - Number(!!b.bot));
    this.participants = ready.slice(0, meta.maxPlayers).map((p) => p.id);
    this.lastPlayed = this.participants;
    this.result = null;
    this.pauseAt = null;
    this.pauseHolders.clear();
    this.pausedMs = 0;
    this.pauseUses = {};

    const ctx = this.makeCtx();
    let state: unknown;
    try {
      state = def.setup(ctx);
    } catch (err) {
      console.error(`[${def.id}] setup failed`, err);
      this.participants = [];
      this.phase = "lobby";
      if (conn) this.sendTo(conn, { t: "err", msg: `${meta.name} failed to start. Try another game.`, now: Date.now() });
      this.broadcastRoom();
      return false;
    }
    this.recent = [...this.recent.filter((id) => id !== this.gameId), this.gameId].slice(-6);
    this.usage.games[this.gameId] = (this.usage.games[this.gameId] ?? 0) + 1;
    this.phase = "playing";
    this.gameSeq += 1;
    this.lastView.clear();
    const active: ActiveGame = { def, state, ctx, timer: null };
    if (def.tick) {
      active.timer = setInterval(() => {
        if (this.game !== active) return;
        if (this.pauseAt !== null) return; // frozen while someone reads the rules
        let changed: boolean | void = false;
        try {
          changed = def.tick!(active.state, ctx);
        } catch (err) {
          console.error(`[${def.id}] tick failed`, err);
        }
        if (def.bot && !this.result) {
          for (const id of this.participants) {
            const p = this.players.get(id);
            if (!p?.bot || !p.connected) continue;
            try {
              const a = def.bot(active.state, id, ctx);
              if (a != null && def.action(active.state, id, a, ctx) !== false) changed = true;
            } catch (err) {
              console.error(`[${def.id}] bot failed`, err);
            }
          }
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
    return true;
  }

  handleLobby(player: Player) {
    if (player.id !== this.hostId) return;
    this.clearNext();
    this.stopGame();
    this.phase = "lobby";
    this.result = null;
    this.participants = [];
    this.pruneDeparted();
    this.broadcastRoom();
  }

  handleAuto(player: Player, on: unknown) {
    if (player.id !== this.hostId || typeof on !== "boolean" || on === this.autoNext) return;
    this.autoNext = on;
    this.system(on ? "⏭️ Quick play on: the next game starts by itself" : "⏸️ Quick play off");
    if (!on) this.clearNext();
    else if (this.result) this.scheduleNext();
    this.broadcastRoom();
  }

  /** Quick play: pick a game that fits who's here (avoiding recent ones) and start it soon. */
  scheduleNext() {
    this.clearNext();
    const online = [...this.players.values()].filter((p) => p.connected).length;
    const fits = CATALOG.filter((g) => GAME_DEFS[g.id] && online >= g.minPlayers && online <= g.maxPlayers);
    const fresh = fits.filter((g) => !this.recent.includes(g.id));
    const others = fits.filter((g) => g.id !== this.gameId);
    const pool = fresh.length ? fresh : others.length ? others : fits;
    if (!pool.length) return;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    this.next = { gameId: pick.id, at: Date.now() + AUTO_NEXT_MS };
    const seq = this.gameSeq;
    this.nextTimer = setTimeout(() => {
      this.nextTimer = null;
      // Only if nothing changed meanwhile (no "Play again", no lobby, quick play still on).
      if (!this.autoNext || this.gameSeq !== seq || !this.result || this.next?.gameId !== pick.id) return;
      this.gameId = pick.id;
      if (!this.startGame()) {
        this.next = null;
        this.broadcastRoom();
      }
    }, AUTO_NEXT_MS);
  }

  clearNext() {
    if (this.nextTimer) clearTimeout(this.nextTimer);
    this.nextTimer = null;
    this.next = null;
  }

  handleAct(player: Player, action: unknown) {
    const game = this.game;
    if (!game) return;
    const playing = this.participants.includes(player.id);
    if (!playing && !game.def.spectatorAction) return;
    if (playing && this.pauseAt !== null) return; // the game is frozen
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
      // The game clock stands still while paused, and skips the time spent paused.
      now: () => (this.pauseAt ?? Date.now()) - this.pausedMs,
      settings: { ...(this.settings[this.gameId] ?? {}) },
      memory: this.gameMemory(),
      players: this.participants.map((id) => ({ ...this.players.get(id)! })),
      player: (id) => this.players.get(id),
      random: Math.random,
      emit: (event, opts) => {
        const msg = JSON.stringify({ t: "ev", e: event, now: Date.now() } satisfies ServerMsg);
        for (const c of this.verifiedConnections()) {
          // A player may have several tabs open, so `to` matches every socket of that id.
          if (opts?.to && pid(c) !== opts.to) continue;
          if (opts?.except && pid(c) === opts.except) continue;
          c.send(msg);
        }
      },
      end: (result) => {
        if (this.result || !this.game || this.game.ctx !== ctx) return;
        this.result = result;
        if (this.pauseAt !== null) this.resume(false);
        for (const id of result.winners) this.wins[id] = (this.wins[id] ?? 0) + 1;
        this.history = [
          ...this.history,
          { gameId: this.gameId, winners: result.winners, headline: result.headline, players: [...this.participants], at: Date.now() },
        ].slice(-HISTORY_LIMIT);
        this.system(`🏆 ${result.headline}`);
        if (this.autoNext) this.scheduleNext();
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
      let payload = payloads.get(pid(conn));
      if (payload === undefined) {
        const view = JSON.stringify(this.viewFor(game, pid(conn)) ?? null);
        if (this.lastView.get(pid(conn)) === view) payload = null;
        else {
          this.lastView.set(pid(conn), view);
          payload = gamePayload(view, now);
        }
        payloads.set(pid(conn), payload);
      }
      if (payload !== null) conn.send(payload);
    }
  }

  /** Room state for everyone (without the chat history, which travels as "chat" deltas). */
  broadcastRoom() {
    const payload = JSON.stringify({ t: "room", room: this.roomView(false), now: Date.now() } satisfies ServerMsg);
    for (const conn of this.verifiedConnections()) conn.send(payload);
    this.scheduleSave();
  }

  *verifiedConnections(): Generator<Conn> {
    for (const conn of this.getConnections<ConnState>()) {
      if (conn.state?.verified) yield conn;
    }
  }

  roomView(withChat: boolean): RoomWire {
    return {
      code: this.name,
      hostId: this.hostId,
      players: [...this.players.values()],
      phase: this.phase,
      gameId: this.gameId,
      participants: this.participants,
      ...(withChat ? { chat: this.chat } : {}),
      wins: this.wins,
      result: this.result,
      gameSeq: this.gameSeq,
      autoNext: this.autoNext,
      next: this.next,
      locked: this.locked,
      ...this.settingsView(),
      pause:
        this.pauseAt === null
          ? null
          : { by: [...this.pauseHolders.keys()], at: this.pauseAt, until: Math.max(this.pauseAt, ...this.pauseHolders.values()) },
      pausedMs: this.pausedMs,
      pauseUses: this.pauseUses,
      history: this.history,
    };
  }

  /** This game's memory; dropped if a game lets it grow past ~64 KB. */
  gameMemory(): Record<string, unknown> {
    const mem = (this.memory[this.gameId] ??= {});
    try {
      if (JSON.stringify(mem).length > 64_000) return (this.memory[this.gameId] = {});
    } catch {
      return (this.memory[this.gameId] = {});
    }
    return mem;
  }

  // ---------- pause (someone reading the rules) ----------

  handlePause(player: Player, on: unknown, all?: unknown) {
    if (!this.game || this.result || typeof on !== "boolean") return;
    const now = Date.now();
    if (on) {
      if (!this.participants.includes(player.id) || this.pauseHolders.has(player.id)) return;
      const used = this.pauseUses[player.id] ?? 0;
      if (used >= MAX_PAUSES) return;
      this.pauseUses[player.id] = used + 1;
      this.pauseHolders.set(player.id, now + PAUSE_MAX_MS);
      if (this.pauseAt === null) {
        this.pauseAt = now;
        this.system(`⏸️ ${player.name} paused the game to read the rules`);
      }
      this.broadcastRoom();
      return;
    }
    if (all === true && player.id === this.hostId) this.pauseHolders.clear();
    else if (!this.pauseHolders.delete(player.id)) return;
    if (!this.pauseHolders.size) this.resume();
    else this.broadcastRoom();
  }

  /** Unfreeze the game clock (the paused stretch is skipped, so timers carry on where they were). */
  resume(announce = true) {
    if (this.pauseAt === null) return;
    this.pausedMs += Date.now() - this.pauseAt;
    this.pauseAt = null;
    this.pauseHolders.clear();
    if (announce) this.system("▶️ Back to the game");
    this.broadcastRoom();
    this.broadcastGame();
  }

  // ---------- reactions ----------

  handleReact(player: Player, e: unknown) {
    if (typeof e !== "number" || !Number.isInteger(e) || e < 0 || e >= REACTIONS.length) return;
    const now = Date.now();
    const b = this.reactBuckets.get(player.id) ?? { tokens: REACT_BURST, at: now };
    b.tokens = Math.min(REACT_BURST, b.tokens + (now - b.at) / REACT_REFILL_MS);
    b.at = now;
    this.reactBuckets.set(player.id, b);
    if (b.tokens < 1) return;
    this.roomReacts = this.roomReacts.filter((t) => now - t < 1000);
    if (this.roomReacts.length >= ROOM_REACTS_PER_SEC) return;
    b.tokens -= 1;
    this.roomReacts.push(now);
    const msg = JSON.stringify({ t: "react", from: player.id, e, now } satisfies ServerMsg);
    for (const c of this.verifiedConnections()) c.send(msg);
  }

  // ---------- host tools ----------

  handleKick(host: Player, id: unknown) {
    if (host.id !== this.hostId || typeof id !== "string" || id === host.id) return;
    const target = this.players.get(id);
    if (!target) return;
    if (target.bot) return this.removeBot(target);
    this.banned.add(id);
    target.removed = true;
    this.keys.delete(id);
    this.pauseHolders.delete(id);
    this.system(`🚫 ${target.name} was removed by the host`, target.avatar);
    for (const c of this.getConnections<ConnState>()) {
      if (pid(c) !== id) continue;
      this.sendTo(c, { t: "rejected", msg: "The host removed you from this room.", now: Date.now() });
      c.close(4003, "removed");
    }
    if (target.connected) {
      target.connected = false;
      this.sockets.delete(id);
      if (this.game && this.participants.includes(id)) {
        try {
          this.game.def.playerLeft?.(this.game.state, id, this.game.ctx);
        } catch (err) {
          console.error(`[${this.game.def.id}] playerLeft failed`, err);
        }
        this.broadcastGame();
      }
    }
    // Gone for good: removed from the list as soon as they're not in a running game.
    this.disconnectedAt.set(id, 0);
    if (this.pauseAt !== null && !this.pauseHolders.size) this.resume(false);
    this.pruneDeparted();
    this.broadcastRoom();
  }

  handleHostChange(host: Player, id: unknown) {
    if (host.id !== this.hostId || typeof id !== "string" || id === host.id) return;
    const target = this.players.get(id);
    if (!target || target.bot || !target.connected) return;
    this.hostId = id;
    this.system(`👑 ${host.name} made ${target.name} the host`);
    this.broadcastRoom();
    this.sendWords();
  }

  handleLock(host: Player, on: unknown) {
    if (host.id !== this.hostId || typeof on !== "boolean" || on === this.locked) return;
    this.locked = on;
    this.system(on ? "🔒 The host locked the room: no new players" : "🔓 The room is open to new players again");
    this.broadcastRoom();
  }

  handleSetting(host: Player, gameId: unknown, key: unknown, value: unknown) {
    if (host.id !== this.hostId || typeof gameId !== "string" || typeof key !== "string") return;
    const def = GAME_CONFIG[gameId]?.settings?.find((d) => d.key === key);
    if (!def) return;
    const v = validSetting(def, value);
    if (v === undefined) return;
    const cur = (this.settings[gameId] ??= {});
    if ((def.kind === "choice" && v === def.default) || (Array.isArray(v) && v.length === 0)) delete cur[key];
    else cur[key] = v;
    this.broadcastRoom();
    if (def.kind === "words") this.sendWords();
  }

  /** Choice settings of the picked game for everyone; word lists only as counts. */
  settingsView(): { settings: Record<string, number | string>; wordCounts: Record<string, number> } {
    const settings: Record<string, number | string> = {};
    const wordCounts: Record<string, number> = {};
    for (const [k, v] of Object.entries(this.settings[this.gameId] ?? {})) {
      if (Array.isArray(v)) wordCounts[k] = v.length;
      else settings[k] = v;
    }
    return { settings, wordCounts };
  }

  /** The host's own word lists for the picked game (secret from everyone else). */
  sendWords(only?: Conn) {
    const defs = GAME_CONFIG[this.gameId]?.settings?.filter((d) => d.kind === "words");
    if (!defs?.length || !this.hostId) return;
    const words: Record<string, string[]> = {};
    for (const d of defs) words[d.key] = (this.settings[this.gameId]?.[d.key] as string[] | undefined) ?? [];
    const msg: ServerMsg = { t: "words", gameId: this.gameId, words, now: Date.now() };
    if (only) return this.sendTo(only, msg);
    for (const c of this.verifiedConnections()) if (pid(c) === this.hostId) this.sendTo(c, msg);
  }

  handleBot(host: Player, add: unknown) {
    if (host.id !== this.hostId || typeof add !== "boolean") return;
    if (!add) {
      const bots = [...this.players.values()].filter((p) => p.bot && p.connected);
      const last = bots[bots.length - 1];
      if (last) this.removeBot(last);
      return;
    }
    if (this.players.size >= MAX_PLAYERS) return;
    // Only games with a bot player can take practice bots (no bots in Sketch Storm etc.).
    if (!GAME_CONFIG[this.gameId]?.bots) return;
    const taken = new Set([...this.players.values()].map((p) => p.name));
    const n = this.botSeq++;
    const name = BOT_NAMES.find((x) => !taken.has(x)) ?? `Bot ${n + 1}`;
    const used = new Set([...this.players.values()].map((p) => p.color));
    const color = PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[n % PLAYER_COLORS.length];
    const bot: Player = { id: `bot-${n}`, name, color, avatar: BOT_AVATARS[n % BOT_AVATARS.length], connected: true, bot: true };
    this.players.set(bot.id, bot);
    this.system(`${name} joined (practice bot)`, bot.avatar);
    this.broadcastRoom();
  }

  removeBot(bot: Player) {
    if (this.game && this.participants.includes(bot.id)) {
      // Mid-game the bot stops (like a player leaving) and is removed when the game ends.
      bot.connected = false;
      try {
        this.game.def.playerLeft?.(this.game.state, bot.id, this.game.ctx);
      } catch (err) {
        console.error(`[${this.game.def.id}] playerLeft failed`, err);
      }
      this.banned.add(bot.id);
      this.disconnectedAt.set(bot.id, 0);
      this.broadcastGame();
    } else {
      this.players.delete(bot.id);
      delete this.wins[bot.id];
    }
    this.system(`${bot.name} left`, bot.avatar);
    this.broadcastRoom();
  }

  // ---------- housekeeping ----------

  ensureHousekeeping() {
    if (this.housekeeping) return;
    this.usage.since = Date.now();
    this.housekeeping = setInterval(() => this.tidy(), 2_000);
  }

  tidy() {
    let changed = false;
    const now = Date.now();

    // Hand host over if the host has been gone a while.
    const host = this.hostId ? this.players.get(this.hostId) : undefined;
    const hostAwayFor = host && !host.connected ? now - (this.disconnectedAt.get(host.id) ?? now) : 0;
    if (!host || hostAwayFor > HOST_HANDOFF_MS) {
      const next = [...this.players.values()].find((p) => p.connected && !p.bot);
      if (next && next.id !== this.hostId) {
        this.hostId = next.id;
        this.system(`👑 ${next.name} is now the host`);
        this.sendWords();
        changed = true;
      }
    }

    if (this.pruneDeparted()) changed = true;
    // Pauses run out on their own.
    for (const [id, until] of this.pauseHolders) {
      if (until > now) continue;
      this.pauseHolders.delete(id);
      changed = true;
    }
    if (this.pauseAt !== null && !this.pauseHolders.size) this.resume();
    else if (changed) this.broadcastRoom();

    // Everyone has been gone a while: stop the game and timers so the room can idle
    // (a room that only ever saw unverified sockets counts as empty too).
    if (this.sockets.size === 0 && this.emptySince === null) this.emptySince = now;
    if (this.sockets.size === 0 && this.emptySince !== null && now - this.emptySince > EMPTY_ROOM_GRACE_MS) {
      this.clearNext();
      this.stopGame();
      this.phase = "lobby";
      this.participants = [];
      this.result = null;
      if (this.housekeeping) clearInterval(this.housekeeping);
      this.housekeeping = null;
      this.reportUsage();
    }
  }

  /** Tell the limiter room what this room used since it woke (one request per session). */
  reportUsage() {
    const u = this.usage;
    if (!u.since) return;
    const report: RoomReport = { room: this.name, http: u.http, messages: u.messages, activeMs: Date.now() - u.since, games: u.games };
    this.usage = { since: 0, http: 0, messages: 0, games: {} };
    void getServerByName(this.env.Main, LIMITS_ROOM)
      .then((stub) => stub.fetch(new Request("https://limits.internal/", { method: "POST", body: JSON.stringify({ report }) })))
      .catch(() => {});
  }

  // ---------- the internal limiter room ----------

  async limitsRequest(req: Request): Promise<Response> {
    const now = Date.now();
    if (!this.statsLoaded) {
      this.statsLoaded = true;
      const saved = await this.ctx.storage.get<Stats["days"]>("days").catch(() => undefined);
      if (Array.isArray(saved)) this.stats.days = saved.map((d) => ({ ...d, errors: d.errors ?? 0 }));
      const errs = await this.ctx.storage.get<ErrorEntry[]>("errors").catch(() => undefined);
      if (Array.isArray(errs)) this.stats.errors = errs;
      const notes = await this.ctx.storage.get<RatingNote[]>("notes").catch(() => undefined);
      if (Array.isArray(notes)) this.stats.notes = notes;
    }
    const day = this.stats.today(now);
    day.limiterRequests++;
    if (req.method === "GET") return json(this.stats.snapshot(now));
    if (req.method !== "POST") return new Response("Not found", { status: 404 });
    const body = (await req.json().catch(() => null)) as
      | { kind?: LimitKind; ip?: string | null; room?: string; report?: RoomReport; error?: unknown; rating?: { game?: unknown; v?: unknown; note?: unknown } }
      | null;
    let verdict: { ok: true } | { ok: false; reason: string } = { ok: true };
    if (body?.report && typeof body.report.room === "string") {
      this.stats.report(body.report, now);
    } else if (body?.rating) {
      const g = body.rating.game;
      const v = body.rating.v;
      const known = typeof g === "string" && !!CATALOG_BY_ID[g];
      const note = cleanNote(body.rating.note);
      const valid = known && (note ? v === undefined : v === 1 || v === -1);
      const ok = valid && (typeof body.ip !== "string" || this.limiter.check("rate", body.ip, now).ok);
      if (ok && note) {
        this.stats.addNote(g as string, note, now);
        void this.ctx.storage.put("notes", this.stats.notes).catch(() => {});
      } else if (ok) addRating(day, g as string, v as number);
    } else if (body?.error) {
      const e = cleanErrorReport(body.error);
      const ok = !e ? false : typeof body.ip === "string" ? this.limiter.check("error", body.ip, now).ok : true;
      if (e && ok) this.stats.recordError(e, now);
    } else if (body && (body.kind === "create" || body.kind === "connect")) {
      if (typeof body.ip === "string") verdict = this.limiter.check(body.kind, body.ip, now);
      if (!verdict.ok) day.blocked++;
      else {
        if (body.kind === "create") day.roomsCreated++;
        else day.connects++;
        if (typeof body.room === "string" && !this.stats.open.has(body.room)) this.stats.open.set(body.room, now);
      }
    }
    // Persist the daily numbers now and then (cheap: one row, at most every 10 s).
    if (!this.statsSaveTimer) {
      this.statsSaveTimer = setTimeout(() => {
        this.statsSaveTimer = null;
        void this.ctx.storage.put("days", this.stats.days).catch(() => {});
        void this.ctx.storage.put("errors", this.stats.errors).catch(() => {});
      }, 10_000);
    }
    return json(verdict);
  }

  /** Remove players who've been gone long enough and aren't in a running game. */
  pruneDeparted(): boolean {
    let removed = false;
    const now = Date.now();
    for (const [id, since] of this.disconnectedAt) {
      const inGame = this.game && this.participants.includes(id);
      const kicked = this.banned.has(id);
      if (inGame || (!kicked && now - since < REMOVE_AFTER_MS)) continue;
      const p = this.players.get(id);
      this.players.delete(id);
      this.disconnectedAt.delete(id);
      this.keys.delete(id);
      this.chatTimes.delete(id);
      delete this.wins[id];
      if (p && !kicked) this.system(`${p.name} left`, p.avatar);
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

  system(text: string, avatar?: string) {
    this.pushChat({ id: `c${++this.chatSeq}`, from: null, text, at: Date.now(), ...(avatar ? { avatar } : {}) });
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

/**
 * The Worker in front of the rooms: routes /parties/main/<room> to its Durable Object.
 * Malformed room ids (and the internal limiter) are refused here, before any room starts,
 * and WebSocket connects are rate limited per IP.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/stats") return statsRequest(request, env);
    if (url.pathname === "/errors") return errorsRequest(request, env);
    if (url.pathname === "/rate") return rateRequest(request, env);
    const res = await routePartykitRequest(request, env, {
      cors: true,
      onBeforeConnect: async (req, lobby) => {
        if (!isPublicRoomId(lobby.name)) return new Response("Not found", { status: 404 });
        const verdict = await allowed(env, "connect", clientIp(req), lobby.name);
        if (!verdict.ok) return new Response(verdict.reason, { status: 429 });
      },
      onBeforeRequest: (_req, lobby) => {
        if (!isPublicRoomId(lobby.name)) return new Response("Not found", { status: 404 });
      },
    });
    return res ?? new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

/**
 * The private usage dashboard's data: GET /stats with "Authorization: Bearer <STATS_TOKEN>".
 * Without the STATS_TOKEN secret set (wrangler secret put STATS_TOKEN) it doesn't exist.
 */
async function statsRequest(request: Request, env: Env): Promise<Response> {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization", "Access-Control-Allow-Methods": "GET, OPTIONS" };
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  const token = (env as Env & { STATS_TOKEN?: string }).STATS_TOKEN;
  const given = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!token || request.method !== "GET") return new Response("Not found", { status: 404, headers: cors });
  if (!timingSafeEqual(given, token)) return new Response("Unauthorized", { status: 401, headers: cors });
  const stub = await getServerByName(env.Main, LIMITS_ROOM);
  const res = await stub.fetch(new Request("https://limits.internal/", { method: "GET" }));
  return new Response(await res.text(), { headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

/** A 👍/👎 after a game: POST /rate {game, v: 1 | -1}, or a note after a 👎: {game, note}. Rate limited per IP; anonymous. */
async function rateRequest(request: Request, env: Env): Promise<Response> {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (request.method !== "POST") return new Response("Not found", { status: 404, headers: cors });
  const text = await request.text().catch(() => "");
  if (text.length > 600) return new Response(null, { status: 413, headers: cors });
  let rating: { game?: unknown; v?: unknown; note?: unknown } | null = null;
  try {
    rating = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400, headers: cors });
  }
  const isNote = !!rating && rating.v === undefined && !!cleanNote(rating.note);
  if (!rating || typeof rating.game !== "string" || !CATALOG_BY_ID[rating.game] || (!isNote && rating.v !== 1 && rating.v !== -1)) {
    return new Response(null, { status: 400, headers: cors });
  }
  try {
    const stub = await getServerByName(env.Main, LIMITS_ROOM);
    await stub.fetch(new Request("https://limits.internal/", { method: "POST", body: JSON.stringify({ rating, ip: clientIp(request) }) }));
  } catch {
    /* best effort */
  }
  return new Response(null, { status: 204, headers: cors });
}

/** Crash reports from browsers: POST /errors (small JSON). Rate limited per IP; never fails loudly. */
async function errorsRequest(request: Request, env: Env): Promise<Response> {
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (request.method !== "POST") return new Response("Not found", { status: 404, headers: cors });
  const text = await request.text().catch(() => "");
  if (text.length > 4_000) return new Response(null, { status: 413, headers: cors });
  let error: unknown = null;
  try {
    error = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400, headers: cors });
  }
  if (!cleanErrorReport(error)) return new Response(null, { status: 400, headers: cors });
  try {
    const stub = await getServerByName(env.Main, LIMITS_ROOM);
    await stub.fetch(new Request("https://limits.internal/", { method: "POST", body: JSON.stringify({ error, ip: clientIp(request) }) }));
  } catch {
    /* best effort */
  }
  return new Response(null, { status: 204, headers: cors });
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
