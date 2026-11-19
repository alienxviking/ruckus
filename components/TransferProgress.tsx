"use client";

import { Check, Copy, Eye, EyeOff } from "lucide-react";
import { useEffect, useRef, useSyncExternalStore, useState } from "react";
import { exportCode, importCode, subscribeTransfer } from "@/lib/progress";
import { markRecoverySeen, PASTE_CODE_EVENT, SHOW_CODE_EVENT } from "./RecoveryTip";

/**
 * Move unlocks and daily results to another device: show the code here, paste it there.
 * No account needed. The code stays hidden until asked for (it's yours, like a password).
 */
export function TransferProgress({ open: startOpen = false }: { open?: boolean } = {}) {
  // Always up to date with your progress (made in this browser, so empty on the server).
  const code = useSyncExternalStore(subscribeTransfer, exportCode, () => "");
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  const [input, setInput] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const box = useRef<HTMLDetailsElement>(null);
  const pasteRef = useRef<HTMLInputElement>(null);
  const reveal = () => {
    setShown(true);
    markRecoverySeen();
  };

  // "Show my code" from the recovery tip: open this box, show the code and bring it into view.
  useEffect(() => {
    const onShow = () => {
      if (box.current) box.current.open = true;
      setShown(true);
      requestAnimationFrame(() => box.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
    };
    // "I have a code": open the box and put the cursor in the paste field.
    const onPaste = () => {
      if (box.current) box.current.open = true;
      requestAnimationFrame(() => {
        pasteRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        pasteRef.current?.focus({ preventScroll: true });
      });
    };
    window.addEventListener(SHOW_CODE_EVENT, onShow);
    window.addEventListener(PASTE_CODE_EVENT, onPaste);
    return () => {
      window.removeEventListener(SHOW_CODE_EVENT, onShow);
      window.removeEventListener(PASTE_CODE_EVENT, onPaste);
    };
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      markRecoverySeen();
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setMsg("Select the code and copy it.");
    }
  };

  return (
    <details ref={box} className="group mt-3 text-xs" open={startOpen}>
      <summary className="cursor-pointer list-none text-muted hover:text-text">
        <span className="underline decoration-dotted underline-offset-2">Move your progress to another device</span>
      </summary>
      <div className="mt-2 space-y-3 rounded-lg border border-line bg-ink/40 p-3">
        <p className="text-muted">Your name, look, wins, unlocks and daily streak travel in one code. Keep it to yourself.</p>
        <p className="label text-[10px]">This device&apos;s code</p>

        {shown ? (
          <div className="flex gap-2">
            <input
              readOnly
              className="input min-w-0 flex-1 font-mono text-[11px]"
              value={code}
              placeholder="Making your code…"
              aria-label="Your transfer code"
              onFocus={(e) => e.currentTarget.select()}
            />
            <button type="button" className="btn min-h-9 px-3 text-xs" onClick={copy}>
              {copied ? <Check aria-hidden className="size-3.5" strokeWidth={2.5} /> : <Copy aria-hidden className="size-3.5" strokeWidth={2.25} />}
              {copied ? "Copied" : "Copy"}
            </button>
            <button type="button" className="btn min-h-9 px-2.5" onClick={() => setShown(false)} aria-label="Hide code" title="Hide code">
              <EyeOff aria-hidden className="size-3.5" strokeWidth={2.25} />
            </button>
          </div>
        ) : (
          <button type="button" className="btn min-h-9 w-full justify-center text-xs font-bold" onClick={reveal} disabled={!code}>
            <Eye aria-hidden className="size-3.5" strokeWidth={2.25} />
            Show my code
          </button>
        )}

        <p className="label pt-1 text-[10px]">Have a code from another device?</p>
        <div className="flex gap-2">
          <input
            ref={pasteRef}
            className="input min-w-0 flex-1 font-mono text-[11px]"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Paste a code from another device"
            aria-label="Paste a transfer code"
          />
          <button
            type="button"
            className="btn min-h-9 px-3 text-xs"
            disabled={!input.trim()}
            onClick={() => {
              const r = importCode(input);
              if (!r.ok) setMsg(r.error);
              else {
                const parts = [
                  ...(r.look ? ["your name & look"] : []),
                  `${r.wins} ${r.wins === 1 ? "win" : "wins"}`,
                  ...(r.streak > 0 ? [`${r.streak}-day streak`] : []),
                ];
                setMsg(
                  `Done! Brought over: ${parts.join(" · ")}.` +
                    (r.look ? "" : " Older codes don't carry your name and look: make a fresh code on your old device for those."),
                );
              }
              if (r.ok) setInput("");
            }}
          >
            Use code
          </button>
        </div>
        {msg && (
          <p role="status" className="font-mono text-[11px] text-brand-2">
            {msg}
          </p>
        )}
      </div>
    </details>
  );
}
