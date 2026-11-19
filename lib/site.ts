// The site's absolute address: an explicit site URL, Vercel's production domain when
// deployed there, or localhost in development. Used for link previews and the sitemap.
export const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");
