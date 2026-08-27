import { requirePageUser } from "@/lib/auth/requirePageUser";
import { AccountForm } from "@/components/admin/account-form";

export default async function AdminNewAccountPage() {
  await requirePageUser(["client_admin"]);
  return (
    <div className="mx-auto max-w-lg">
      <AccountForm basePath="/admin" allowedRoles={["provider_user"]} />
    </div>
  );
}
