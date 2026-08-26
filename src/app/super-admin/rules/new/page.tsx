import { requirePageUser } from "@/lib/auth/requirePageUser";
import { RuleForm } from "@/components/admin/rule-form";

export default async function SuperAdminNewRulePage() {
  const user = await requirePageUser(["super_admin"]);
  return (
    <div className="mx-auto max-w-lg">
      <RuleForm basePath="/super-admin" currentUserId={user.id} mode="create" />
    </div>
  );
}
