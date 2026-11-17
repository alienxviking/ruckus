"use client";

import { useSyncExternalStore, useState } from "react";
import { exportCode, importCode, subscribeProgress } from "@/lib/progress";

/** Move unlocks to another device: copy a code here, paste it there. No account needed. */
export function TransferProgress({ open: startOpen = false }: { open?: boolean } = {}) {
  // Your code, always up to date with your progress (made in this browser, so empty on the server).
  const code = useSyncExternalStore(subscribeProgress, exportCode, () => "");
  const [input, setInput] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <details className="group mt-3 text-xs" open={startOpen}>
      <summary className="cursor-pointer list-none text-muted hover:text-text">
        <span className="underline decoration-dotted underline-offset-2">Move your unlocks to another device</span>
      </summary>
      <div className="mt-2 space-y-2 rounded-lg border border-line bg-ink/40 p-3">
        <p className="text-muted">Copy this code here, then paste it on your other device.</p>
        <div className="flex gap-2">
          <input
            readOnly
            className="input min-w-0 flex-1 font-mono text-[11px]"
            value={code}
            placeholder="Making your code…"
            aria-label="Your transfer code"
            onFocus={(e) => e.currentTarget.select()}
          />
          <button
            type="button"
            className="btn px-3 py-1 text-xs"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(code);
                setMsg("Copied!");
              } catch {
                setMsg("Select the code and copy it.");
              }
            }}
          >
            Copy code
          </button>
        </div>
        <div className="flex gap-2">
          <input
            className="input min-w-0 flex-1 font-mono text-[11px]"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Paste a code from another device"
            aria-label="Paste a transfer code"
          />
          <button
            type="button"
            className="btn px-3 py-1 text-xs"
            disabled={!input.trim()}
            onClick={() => {
              const r = importCode(input);
              setMsg(r.ok ? `Done! ${r.wins} ${r.wins === 1 ? "win" : "wins"} on this device now.` : r.error);
              if (r.ok) setInput("");
            }}
          >
            Add
          </button>
        </div>
        {msg && <p className="font-mono text-[11px] text-brand-2">{msg}</p>}
      </div>
    </details>
  );
}
