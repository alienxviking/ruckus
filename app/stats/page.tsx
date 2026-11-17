import type { Metadata } from "next";
import { StatsDashboard } from "@/components/StatsDashboard";

// Private usage dashboard: the data needs the STATS_TOKEN secret, entered on the page.
export const metadata: Metadata = {
  title: "Usage · Ruckus",
  robots: { index: false, follow: false },
};

export default function StatsPage() {
  return <StatsDashboard />;
}
