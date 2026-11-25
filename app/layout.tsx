import { SiteAnalytics } from "@/components/SiteAnalytics";
import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Caveat_Brush, Chakra_Petch, Geist, Geist_Mono } from "next/font/google";
import { preconnect, prefetchDNS } from "react-dom";
import { MotionProvider } from "@/components/motion/MotionProvider";
import { ServiceWorker } from "@/components/ServiceWorker";
import { BlobBackdrop } from "@/components/BlobBackdrop";
import { INTRO_SCRIPT } from "@/lib/intro-script";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
// Narrow, angular display face for game UI headings (keeps game layouts compact).
const display = Chakra_Petch({ variable: "--font-display-face", subsets: ["latin"], weight: ["500", "600", "700"] });
// Chunky, characterful hero face: the wordmark, headlines and big titles.
const hero = Bricolage_Grotesque({ variable: "--font-hero-face", subsets: ["latin"], weight: ["600", "800"] });
// Marker scribbles: side remarks, stickers, Rux's speech. Used sparingly.
const marker = Caveat_Brush({ variable: "--font-marker-face", subsets: ["latin"], weight: "400" });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Ruckus — games with friends",
  description: "Make a room, share the link, play real-time party games together. No sign-up.",
  applicationName: "Ruckus",
  // Installed on an iPhone: the app runs under the status bar (edge to edge); the body is padded by the safe area.
  appleWebApp: { capable: true, title: "Ruckus", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#05060a",
  // Draw edge to edge on phones with a notch / rounded corners; the safe-area padding keeps
  // content clear of them (globals.css).
  viewportFit: "cover",
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
      <head>
        {/* Landing intro: decide before first paint whether it plays (see RuxIntro). */}
        <script dangerouslySetInnerHTML={{ __html: INTRO_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">
        <BlobBackdrop />
        <MotionProvider>{children}</MotionProvider>
        <ServiceWorker />
        <SiteAnalytics />
      </body>
    </html>
  );
}
