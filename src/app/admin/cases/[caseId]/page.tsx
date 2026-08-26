import { requirePageUser } from "@/lib/auth/requirePageUser";
import { ClientCaseDetail } from "@/components/admin/client-case-detail";

export default async function AdminCaseDetailPage({ params }: { params: Promise<{ caseId: string }> }) {
  await requirePageUser(["client_admin"]);
  const { caseId } = await params;
  return <ClientCaseDetail caseId={caseId} />;
}
