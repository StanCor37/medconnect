import { requirePageUser } from "@/lib/auth/requirePageUser";
import { RuleForm } from "@/components/admin/rule-form";

export default async function AdminNewRulePage() {
  const user = await requirePageUser(["client_admin"]);
  return (
    <div className="mx-auto max-w-lg">
      <RuleForm basePath="/admin" currentUserId={user.id} mode="create" />
    </div>
  );
}
