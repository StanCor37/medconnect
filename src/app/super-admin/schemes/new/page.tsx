import { requirePageUser } from "@/lib/auth/requirePageUser";
import { SchemeForm } from "@/components/admin/scheme-form";

export default async function SuperAdminNewSchemePage() {
  await requirePageUser(["super_admin"]);
  return <SchemeForm basePath="/super-admin" />;
}
