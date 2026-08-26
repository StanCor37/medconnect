import { requirePageUser } from "@/lib/auth/requirePageUser";
import { RulesList } from "@/components/admin/rules-list";

export default async function SuperAdminRulesPage() {
  await requirePageUser(["super_admin"]);
  return <RulesList basePath="/super-admin" />;
}
