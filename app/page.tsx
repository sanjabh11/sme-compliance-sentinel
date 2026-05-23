import { DashboardClient } from "@/app/dashboard-client";
import { getDashboardSnapshot } from "@/lib/store";

export default function Home() {
  return <DashboardClient initialSnapshot={getDashboardSnapshot()} />;
}
