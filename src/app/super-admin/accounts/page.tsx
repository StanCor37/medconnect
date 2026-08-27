import { requirePageUser } from "@/lib/auth/requirePageUser";
import { AccountList } from "@/components/admin/account-list";

export default async function SuperAdminAccountsPage() {
  await requirePageUser(["super_admin"]);
  return <AccountList basePath="/super-admin" />;
}
