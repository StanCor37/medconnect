import { requirePageUser } from "@/lib/auth/requirePageUser";
import { RuleDetail } from "@/components/admin/rule-detail";

export default async function AdminRuleDetailPage({ params }: { params: Promise<{ ruleId: string }> }) {
  const user = await requirePageUser(["client_admin"]);
  const { ruleId } = await params;
  return <RuleDetail basePath="/admin" ruleId={ruleId} currentUserId={user.id} viewerRole="client_admin" />;
}
