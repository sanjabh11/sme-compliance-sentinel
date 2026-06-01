import { DashboardClient } from "@/app/dashboard-client";
import { AdminUnlockClient } from "@/app/admin/admin-unlock-client";
import { isValidAdminSessionValue } from "@/lib/admin-action-auth";
import { adminSessionCookieName, getExpectedAdminToken, requiresAdminProtection } from "@/lib/admin-session";
import { getDashboardSnapshot } from "@/lib/store";
import { unstable_noStore as noStore } from "next/cache";
import { cookies } from "next/headers";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export const metadata = {
  title: "Admin Console | SME Workspace Sentinel"
};

export default async function AdminPage() {
  noStore();

  if (requiresAdminProtection()) {
    const cookieStore = await cookies();
    const sessionValue = cookieStore.get(adminSessionCookieName)?.value ?? "";
    const expectedToken = getExpectedAdminToken();
    if (!isValidAdminSessionValue(sessionValue, expectedToken)) {
      return <AdminUnlockClient tokenConfigured={Boolean(expectedToken)} />;
    }
  }

  return <DashboardClient initialSnapshot={getDashboardSnapshot()} />;
}
