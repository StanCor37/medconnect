import { requirePageUser } from "@/lib/auth/requirePageUser";
import { NewCaseForm } from "@/components/provider/new-case-form";

export default async function NewCasePage() {
  const user = await requirePageUser(["provider_user"]);
  return <NewCaseForm currentUserId={user.id} />;
}
