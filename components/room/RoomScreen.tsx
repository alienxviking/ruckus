"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { loadIdentity, saveIdentity, type Identity } from "@/lib/identity";
import { ProfileForm } from "./ProfileForm";
import { Room } from "./Room";
import { Logo } from "../Logo";

const noopSubscribe = () => () => {};

export function RoomScreen({ code }: { code: string }) {
  // Read localStorage only on the client; the server renders the loading state.
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const [override, setOverride] = useState<Identity | null>(null);
  const stored = useMemo(() => (mounted ? loadIdentity() : null), [mounted]);
  const identity = override ?? stored;

  useEffect(() => {
    document.title = `Room ${code} · Ruckus`;
  }, [code]);

  if (!mounted) return <div className="flex-1" />;

  if (!identity) {
    return (
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 px-4 py-10">
        <Logo />
        <div className="card p-5 sm:p-6">
          <h1 className="font-display text-2xl font-bold">Joining room {code}</h1>
          <p className="mt-1 mb-5 text-sm text-muted">Pick a name and a look. Saved on this device.</p>
          <ProfileForm submitLabel="Let's go" onSubmit={(v) => setOverride(saveIdentity(v))} />
        </div>
      </main>
    );
  }

  return <Room code={code} identity={identity} onIdentity={(v) => setOverride(saveIdentity(v))} />;
}
