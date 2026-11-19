import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    // Rooms, invites and private pages aren't worth indexing.
    rules: { userAgent: "*", allow: "/", disallow: ["/r/", "/i/", "/room", "/stats", "/me", "/dev", "/og/"] },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
