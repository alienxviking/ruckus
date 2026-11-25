"use client";

import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";

// Vercel Web Analytics: visitors, where they came from (LinkedIn, WhatsApp, Google), devices.
// Cookie-free. Room and invite links are folded into one page each, so codes never reach the
// dashboard and "/r/[code]" shows up as a single row.
function scrub(e: BeforeSendEvent): BeforeSendEvent {
  return { ...e, url: e.url.replace(/\/(r|i)\/[^/?#]+/, "/$1/[code]") };
}

export function SiteAnalytics() {
  return <Analytics beforeSend={scrub} />;
}
