import { requirePageUser } from "@/lib/auth/requirePageUser";
import { SchemeDetail } from "@/components/admin/scheme-detail";

export default async function SuperAdminSchemeDetailPage({ params }: { params: Promise<{ schemeId: string }> }) {
  await requirePageUser(["super_admin"]);
  const { schemeId } = await params;
  return <SchemeDetail basePath="/super-admin" schemeId={schemeId} viewerRole="super_admin" />;
}
