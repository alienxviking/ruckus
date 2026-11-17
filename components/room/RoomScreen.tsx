"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { loadIdentity, normalizeCode, saveIdentity, type Identity } from "@/lib/identity";
import { roomExists } from "@/lib/rooms";
import { ProfileForm } from "./ProfileForm";
import { Room } from "./Room";
import { Logo } from "../Logo";
import { Rux, type RuxMood } from "../Rux";

const noopSubscribe = () => () => {};
function subscribeHistory(cb: () => void) {
  window.addEventListener("popstate", cb);
  return () => window.removeEventListener("popstate", cb);
}

/** The room code from the address bar: /r/CODE is rewritten to this static page. */
function useRoomCode(): string | null {
  // usePathname re-renders us on client-side navigation; the code itself is read from
  // the real address bar, which is the same on every request and needs no server work.
  usePathname();
  const path = useSyncExternalStore(subscribeHistory, () => window.location.pathname, () => "");
  const m = /^\/r\/([^/?#]+)/.exec(path);
  const code = m ? normalizeCode(decodeURIComponent(m[1])) : "";
  return code.length >= 4 ? code : null;
}

export function RoomScreen() {
  // Read localStorage only on the client; the server renders the loading state.
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const code = useRoomCode();
  const [override, setOverride] = useState<Identity | null>(null);
  const stored = useMemo(() => (mounted ? loadIdentity() : null), [mounted]);
  const identity = override ?? stored;
  // Dead or mistyped invite links: say so up front instead of asking for a name first.
  const [missing, setMissing] = useState<string | null>(null);
  useEffect(() => {
    if (!code) return;
    let live = true;
    roomExists(code).then((exists) => {
      if (live && exists === false) setMissing(code);
    });
    return () => {
      live = false;
    };
  }, [code]);

  useEffect(() => {
    if (code) document.title = `Room ${code} · Ruckus`;
  }, [code]);

  if (!mounted) return <div className="flex-1" />;

  if (!code) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 py-10">
        <Logo />
        <RuxSays mood="wow">hmm, code kahan hai?</RuxSays>
        <div className="glass animate-rise p-5 sm:p-6">
          <h1 className="font-hero text-2xl font-extrabold tracking-[-0.03em]">That link has no room code</h1>
          <p className="mt-1 mb-5 text-sm text-muted">Room links look like /r/ABCDE. Make a new room or enter a code.</p>
          <Link href="/" className="btn btn-primary w-full py-3">
            Go to the start page
          </Link>
        </div>
      </main>
    );
  }

  if (missing === code) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 py-10">
        <Logo />
        <RuxSays mood="wow">arre! ye room toh hai hi nahi</RuxSays>
        <div className="glass p-5 sm:p-6" role="alert">
          <h1 className="font-hero text-2xl font-extrabold tracking-[-0.03em]">No room called {code}</h1>
          <p className="mt-1 mb-5 text-sm text-muted">
            The code may be mistyped, or everyone left and the room closed. Ask for a fresh link, or start your own.
          </p>
          <Link href="/" className="btn btn-primary w-full py-3">
            Go to the start page
          </Link>
        </div>
      </main>
    );
  }

  if (!identity) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 py-10">
        <Logo />
        <RuxSays mood="grin">aao aao! pehle naam batao 👋</RuxSays>
        <div className="glass animate-rise p-5 sm:p-6">
          <h1 className="font-hero text-2xl font-extrabold tracking-[-0.03em]">
            Joining room <span className="text-brand-2">{code}</span>
          </h1>
          <p className="mt-1 mb-5 text-sm text-muted">Pick a name and a look. Saved on this device.</p>
          <ProfileForm submitLabel="Let's go" onSubmit={(v) => setOverride(saveIdentity(v))} />
        </div>
      </main>
    );
  }

  return <Room key={code} code={code} identity={identity} onIdentity={(v) => setOverride(saveIdentity(v))} />;
}

/** Rux popping up beside a speech bubble, above a card. */
function RuxSays({ mood, children }: { mood: RuxMood; children: ReactNode }) {
  return (
    <div className="-mb-3 flex items-end gap-2 pl-2" aria-hidden>
      <span className="slap w-16 shrink-0" style={{ "--tilt": "-8deg" } as React.CSSProperties}>
        <Rux mood={mood} className="w-full" />
      </span>
      <span
        className="slap marker mb-6 rounded-2xl border-[3px] border-ink bg-paper px-3 py-1.5 text-xl leading-tight text-ink shadow-[3px_4px_0_var(--color-pink)]"
        style={{ "--tilt": "-3deg", animationDelay: "160ms" } as React.CSSProperties}
      >
        {children}
      </span>
    </div>
  );
}
