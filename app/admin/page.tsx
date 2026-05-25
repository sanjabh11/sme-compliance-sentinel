import { DashboardClient } from "@/app/dashboard-client";
import { getDashboardSnapshot } from "@/lib/store";

export const metadata = {
  title: "Admin Console | SME Workspace Sentinel"
};

export default function AdminPage() {
  return <DashboardClient initialSnapshot={getDashboardSnapshot()} />;
}
