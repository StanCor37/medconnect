import { requirePageUser } from "@/lib/auth/requirePageUser";
import { SchemesList } from "@/components/admin/schemes-list";

export default async function AdminSchemesPage() {
  await requirePageUser(["client_admin"]);
  return <SchemesList basePath="/admin" />;
}
