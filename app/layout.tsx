import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Caveat_Brush, Chakra_Petch, Geist, Geist_Mono } from "next/font/google";
import { preconnect, prefetchDNS } from "react-dom";
import { MotionProvider } from "@/components/motion/MotionProvider";
import { ServiceWorker } from "@/components/ServiceWorker";
import { BlobBackdrop } from "@/components/BlobBackdrop";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
// Narrow, angular display face for game UI headings (keeps game layouts compact).
const display = Chakra_Petch({ variable: "--font-display-face", subsets: ["latin"], weight: ["500", "600", "700"] });
// Chunky, characterful hero face: the wordmark, headlines and big titles.
const hero = Bricolage_Grotesque({ variable: "--font-hero-face", subsets: ["latin"], weight: ["600", "800"] });
// Marker scribbles: side remarks, stickers, Rux's speech. Used sparingly.
const marker = Caveat_Brush({ variable: "--font-marker-face", subsets: ["latin"], weight: "400" });

// Absolute base for link-preview images: an explicit site URL, Vercel's production
// domain when deployed there, or localhost in development.
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Ruckus — games with friends",
  description: "Make a room, share the link, play real-time party games together. No sign-up.",
  applicationName: "Ruckus",
  appleWebApp: { capable: true, title: "Ruckus", statusBarStyle: "black" },
};

export const viewport: Viewport = {
  themeColor: "#05060a",
};

// The deployed game server: start DNS + TLS early so the room's WebSocket opens faster.
const partyHost = process.env.NEXT_PUBLIC_PARTYKIT_HOST;

export default function RootLayout({ children }: LayoutProps<"/">) {
  if (partyHost) {
    prefetchDNS(`https://${partyHost}`);
    preconnect(`https://${partyHost}`);
  }
  return (
    <html
      lang="en"
      // The home intro marks <html data-intro> before first paint (see RuxIntro).
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${display.variable} ${hero.variable} ${marker.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <BlobBackdrop />
        <MotionProvider>{children}</MotionProvider>
        <ServiceWorker />
      </body>
    </html>
  );
}
