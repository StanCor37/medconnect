import { requirePageUser } from "@/lib/auth/requirePageUser";
import { SchemesList } from "@/components/admin/schemes-list";

export default async function SuperAdminSchemesPage() {
  await requirePageUser(["super_admin"]);
  return <SchemesList basePath="/super-admin" />;
}
