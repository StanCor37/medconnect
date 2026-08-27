import { requirePageUser } from "@/lib/auth/requirePageUser";
import { AccountList } from "@/components/admin/account-list";

export default async function AdminAccountsPage() {
  await requirePageUser(["client_admin"]);
  return <AccountList basePath="/admin" />;
}
