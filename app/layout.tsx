import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Geist, Geist_Mono } from "next/font/google";
import { preconnect, prefetchDNS } from "react-dom";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const display = Bricolage_Grotesque({ variable: "--font-display-face", subsets: ["latin"] });

// Absolute base for link-preview images: an explicit site URL, Vercel's production
// domain when deployed there, or localhost in development.
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Ruckus — games with friends",
  description: "Make a room, share the link, play real-time party games together. No sign-up.",
};

export const viewport: Viewport = {
  themeColor: "#0e0c1d",
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
      className={`${geistSans.variable} ${geistMono.variable} ${display.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
