import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/session";

const ROLE_HOME: Record<string, string> = {
  super_admin: "/super-admin/overview",
  client_admin: "/admin/overview",
  provider_user: "/provider/home",
};

export default async function Home() {
  const user = await getCurrentUser();
  redirect(user ? (ROLE_HOME[user.role] ?? "/login") : "/login");
}
