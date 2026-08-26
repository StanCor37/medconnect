import { requirePageUser } from "@/lib/auth/requirePageUser";
import { RulesList } from "@/components/admin/rules-list";

export default async function AdminRulesPage() {
  await requirePageUser(["client_admin"]);
  return <RulesList basePath="/admin" />;
}
