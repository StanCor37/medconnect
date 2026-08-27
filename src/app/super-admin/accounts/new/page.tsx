import { requirePageUser } from "@/lib/auth/requirePageUser";
import { AccountForm } from "@/components/admin/account-form";

export default async function SuperAdminNewAccountPage() {
  await requirePageUser(["super_admin"]);
  return (
    <div className="mx-auto max-w-lg">
      <AccountForm basePath="/super-admin" allowedRoles={["client_admin", "provider_user"]} />
    </div>
  );
}
