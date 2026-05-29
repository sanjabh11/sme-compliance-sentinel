import { DashboardClient } from "@/app/dashboard-client";
import { AdminUnlockClient } from "@/app/admin/admin-unlock-client";
import { isValidAdminSessionValue } from "@/lib/admin-action-auth";
import { adminSessionCookieName, getExpectedAdminToken, isPublicSurfaceLockdownEnabled } from "@/lib/admin-session";
import { getDashboardSnapshot } from "@/lib/store";
import { cookies } from "next/headers";

export const metadata = {
  title: "Admin Console | SME Workspace Sentinel"
};

export default async function AdminPage() {
  if (isPublicSurfaceLockdownEnabled()) {
    const cookieStore = await cookies();
    const sessionValue = cookieStore.get(adminSessionCookieName)?.value ?? "";
    const expectedToken = getExpectedAdminToken();
    if (!isValidAdminSessionValue(sessionValue, expectedToken)) {
      return <AdminUnlockClient tokenConfigured={Boolean(expectedToken)} />;
    }
  }

  return <DashboardClient initialSnapshot={getDashboardSnapshot()} />;
}
