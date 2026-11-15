import { Suspense } from "react";
import type { Metadata } from "next";
import { RoomScreen } from "@/components/room/RoomScreen";
import { normalizeCode } from "@/lib/identity";

// The room code only matters on the client (the tab title is set there), so
// metadata stays static and the page keeps a prerendered shell. This is also
// what shows up when someone pastes an invite link into a chat app.
export const metadata: Metadata = {
  title: "You're invited · Ruckus",
  description: "Tap to join the room and play real-time party games together. No sign-up.",
  openGraph: {
    title: "Join my Ruckus room",
    description: "Tap to join and play real-time party games together. No sign-up.",
  },
};

export default function RoomPage({ params }: PageProps<"/r/[code]">) {
  return (
    <Suspense fallback={<div className="flex-1" />}>
      <RoomFromParams params={params} />
    </Suspense>
  );
}

async function RoomFromParams({ params }: Pick<PageProps<"/r/[code]">, "params">) {
  const { code } = await params;
  return <RoomScreen code={normalizeCode(code)} />;
}
