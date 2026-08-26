import { requirePageUser } from "@/lib/auth/requirePageUser";
import { SchemeDetail } from "@/components/admin/scheme-detail";

export default async function AdminSchemeDetailPage({ params }: { params: Promise<{ schemeId: string }> }) {
  await requirePageUser(["client_admin"]);
  const { schemeId } = await params;
  return <SchemeDetail basePath="/admin" schemeId={schemeId} viewerRole="client_admin" />;
}
