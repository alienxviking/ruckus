import type { Metadata } from "next";
import { RoomScreen } from "@/components/room/RoomScreen";

// Every room link (/r/CODE) is rewritten to this one static page (see next.config.ts),
// so rooms load straight from the CDN with no server render. The client reads the
// code from the address bar. This metadata is what invite links preview as.
export const metadata: Metadata = {
  title: "You're invited · Ruckus",
  description: "Tap to join the room and play real-time party games together. No sign-up.",
  openGraph: {
    title: "Join my Ruckus room",
    description: "Tap to join and play real-time party games together. No sign-up.",
  },
};

export default function RoomPage() {
  return <RoomScreen />;
}
