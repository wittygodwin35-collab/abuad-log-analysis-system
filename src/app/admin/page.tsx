import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AdminRequestsDashboard } from "@/components/admin/admin-requests-dashboard";
import { getSessionCookieName, isAdminUser, verifySessionToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(getSessionCookieName())?.value;
  const user = await verifySessionToken(token);

  if (!user) {
    redirect("/login?callbackUrl=/admin");
  }

  if (!isAdminUser(user)) {
    redirect("/dashboard");
  }

  return <AdminRequestsDashboard adminName={user.name} />;
}
