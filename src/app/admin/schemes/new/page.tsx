import { requirePageUser } from "@/lib/auth/requirePageUser";
import { SchemeForm } from "@/components/admin/scheme-form";

export default async function AdminNewSchemePage() {
  await requirePageUser(["client_admin"]);
  return <SchemeForm basePath="/admin" />;
}
