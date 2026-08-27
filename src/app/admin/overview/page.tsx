import { requirePageUser } from "@/lib/auth/requirePageUser";
import { AdminOverview } from "@/components/admin/admin-overview";

export default async function ClientAdminOverviewPage() {
  const user = await requirePageUser(["client_admin"]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground">Welcome back, {user.firstName}</h1>
        <p className="mt-1 text-sm text-muted-foreground">Signed in as {user.email}.</p>
      </div>
      <AdminOverview />
    </div>
  );
}
