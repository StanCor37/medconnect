import { requirePageUser } from "@/lib/auth/requirePageUser";
import { RuleDetail } from "@/components/admin/rule-detail";

export default async function SuperAdminRuleDetailPage({ params }: { params: Promise<{ ruleId: string }> }) {
  const user = await requirePageUser(["super_admin"]);
  const { ruleId } = await params;
  return <RuleDetail basePath="/super-admin" ruleId={ruleId} currentUserId={user.id} viewerRole="super_admin" />;
}
