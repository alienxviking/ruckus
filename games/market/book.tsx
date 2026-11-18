"use client";

// The order book: bids (buyers) on the left, asks (sellers) on the right, best
// prices at the top. Tap someone else's row to trade against it at that price.

import type { BookRow } from "./server";
import { HOUSE, HOUSE_SPREAD, SIZE_MAX } from "./shared";
import { ASK, BID, Panel, type WhoFn } from "./ui";
import { Avatar } from "@/components/Avatar";

const MAX_ROWS = 6;

export interface BookProps {
  bids: BookRow[];
  asks: BookRow[];
  me: number;
  who: WhoFn;
  /** Null = read-only (spectators). */
  onTake: ((side: "buy" | "sell", qty: number, price: number) => void) | null;
  onCancel: ((side: "bid" | "ask") => void) | null;
  /** Lots you'd trade per click (already clipped to your position room per side). */
  room: { buy: number; sell: number };
  size: number;
  /** Public fair value, for the House note. */
  fair: number;
}

export function OrderBook({ bids, asks, me, who, onTake, onCancel, room, size, fair }: BookProps) {
  const bestBid = bids[0]?.[1];
  const bestAsk = asks[0]?.[1];
  const spread = bestBid !== undefined && bestAsk !== undefined ? bestAsk - bestBid : null;
  return (
    <Panel
      title="Order book"
      label="Order book"
      aside={
        spread !== null ? (
          <span>
            best <b className="font-mono text-text">{bestBid}</b> / <b className="font-mono text-text">{bestAsk}</b> · spread{" "}
            {spread}
          </span>
        ) : null
      }
    >
      <div className="grid grid-cols-2 gap-2">
        <Side kind="bid" rows={bids} me={me} who={who} onTake={onTake} onCancel={onCancel} room={room} size={size} />
        <Side kind="ask" rows={asks} me={me} who={who} onTake={onTake} onCancel={onCancel} room={room} size={size} />
      </div>
      <p className="mt-2 text-center text-[11px] leading-snug text-muted">
        {onTake && (
          <>
            Tap a <span style={{ color: BID }}>bid</span> to sell to it, an <span style={{ color: ASK }}>ask</span> to buy from it.{" "}
          </>
        )}
        <span className="whitespace-nowrap">
          <span aria-hidden>🏦</span> House quotes fair value ({fair}) ± {HOUSE_SPREAD}.
        </span>
      </p>
    </Panel>
  );
}

function Side({
  kind,
  rows,
  me,
  who,
  onTake,
  onCancel,
  room,
  size,
}: Omit<BookProps, "bids" | "asks" | "fair"> & { kind: "bid" | "ask"; rows: BookRow[] }) {
  const color = kind === "bid" ? BID : ASK;
  const shown = rows.slice(0, MAX_ROWS);
  const hidden = rows.length - shown.length;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className={`flex items-baseline gap-1 px-1 text-[11px] font-bold tracking-wide uppercase ${kind === "ask" ? "flex-row-reverse" : ""}`}>
        <span style={{ color }}>{kind === "bid" ? "Bids" : "Asks"}</span>
        <span className="truncate font-medium text-muted normal-case">{kind === "bid" ? "· buyers" : "sellers ·"}</span>
      </div>
      {shown.length === 0 && (
        <div className="grid h-10 place-items-center rounded-lg border border-dashed border-line text-xs text-muted">
          {kind === "bid" ? "No buyers yet" : "No sellers yet"}
        </div>
      )}
      <ul className="flex flex-col gap-1">
        {shown.map((r, i) => {
          const [owner, price, qty] = r;
          // Everything at this price or better from other traders: what a click here can take.
          const reach = rows
            .filter((x) => x[0] !== me && (kind === "bid" ? x[1] >= price : x[1] <= price))
            .reduce((a, x) => a + x[2], 0);
          return (
            <li key={`${owner}:${price}:${qty}`} className="mk-in">
              <Row
                kind={kind}
                row={r}
                best={i === 0}
                mine={owner === me}
                who={who}
                take={onTake && owner !== me ? Math.min(size, reach, kind === "bid" ? room.sell : room.buy) : 0}
                onTake={onTake ? (n) => onTake(kind === "bid" ? "sell" : "buy", n, price) : null}
                onCancel={onCancel && owner === me ? () => onCancel(kind) : null}
                qty={qty}
              />
            </li>
          );
        })}
      </ul>
      {hidden > 0 && <p className="px-1 text-[11px] text-muted">+{hidden} more</p>}
    </div>
  );
}

function Row({
  kind,
  row,
  best,
  mine,
  who,
  take,
  onTake,
  onCancel,
  qty,
}: {
  kind: "bid" | "ask";
  row: BookRow;
  best: boolean;
  mine: boolean;
  who: WhoFn;
  take: number;
  onTake: ((qty: number) => void) | null;
  onCancel: (() => void) | null;
  qty: number;
}) {
  const [owner, price] = row;
  const p = who(owner);
  const color = kind === "bid" ? BID : ASK;
  const flip = kind === "ask";
  const depth = `${(qty / SIZE_MAX) * 100}%`;
  const body = (
    <>
      <span
        aria-hidden
        className="absolute inset-y-0 rounded-lg"
        style={{
          [flip ? "left" : "right"]: 0,
          width: depth,
          background: `${color}${best ? "2e" : "1a"}`,
          transition: "width .3s",
        }}
      />
      <span className={`relative flex min-w-0 flex-1 items-center gap-1 ${flip ? "flex-row-reverse" : ""}`}>
        <span aria-hidden className="text-sm leading-none">
          <Avatar id={p.avatar} />
        </span>
        <span className="min-w-0 truncate text-xs font-semibold" style={{ color: owner === HOUSE ? "var(--color-muted)" : p.color }}>
          {mine ? "You" : p.name}
        </span>
      </span>
      <span className={`relative flex shrink-0 items-baseline gap-1 ${flip ? "flex-row-reverse" : ""}`}>
        <span className="text-[11px] text-muted tabular-nums">{qty}×</span>
        <span className="font-mono text-base font-extrabold tabular-nums" style={{ color }}>
          {price}
        </span>
      </span>
    </>
  );
  const base = `relative flex h-10 w-full min-w-0 items-center gap-1.5 overflow-hidden rounded-lg border px-2 ${flip ? "flex-row-reverse" : ""}`;

  if (mine) {
    return (
      <div className={base} style={{ borderColor: p.color, borderStyle: "dashed", background: `${p.color}12` }}>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            aria-label={`Cancel your ${kind} of ${qty} at ${price}`}
            className="group relative -mx-2 grid w-10 shrink-0 self-stretch place-items-center rounded-md"
          >
            <span
              aria-hidden
              className="grid size-7 place-items-center rounded-full border-2 text-xs font-bold transition group-hover:brightness-125 group-active:scale-90"
              style={{ borderColor: color, color, background: `${color}26` }}
            >
              ✕
            </span>
          </button>
        )}
        {body}
      </div>
    );
  }
  if (!onTake || take <= 0) {
    return (
      <div className={`${base} border-line`} aria-label={`${p.name} ${kind === "bid" ? "bids" : "offers"} ${qty} at ${price}`}>
        {body}
      </div>
    );
  }
  const verb = kind === "bid" ? `Sell ${take} to` : `Buy ${take} from`;
  return (
    <button
      type="button"
      onClick={() => onTake(take)}
      aria-label={`${verb} ${p.name} at ${price}${kind === "bid" ? " or more" : " or less"}`}
      title={`${verb} ${p.name} at ${price}`}
      className={`${base} cursor-pointer border-line text-left transition-[border-color,transform] duration-150 hover:border-[var(--mk-row)] active:scale-[.98]`}
      style={{ ["--mk-row" as string]: color }}
    >
      {body}
    </button>
  );
}
