import { requirePageUser } from "@/lib/auth/requirePageUser";
import { HitlInbox } from "@/components/admin/hitl-inbox";

export default async function AdminHitlPage() {
  await requirePageUser(["client_admin"]);
  return <HitlInbox />;
}
