import { requirePageUser } from "@/lib/auth/requirePageUser";
import { ClientCaseList } from "@/components/admin/client-case-list";

export default async function AdminCasesPage() {
  await requirePageUser(["client_admin"]);
  return <ClientCaseList />;
}
