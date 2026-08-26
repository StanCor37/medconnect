import "server-only";
import { redirect } from "next/navigation";
import { getCurrentUser, type AuthenticatedUser } from "@/lib/session";

/**
 * Server-component page guard. This is an OPTIMISTIC UX redirect only — it
 * makes wrong-role pages redirect nicely instead of rendering broken UI. It
 * is NOT the authorization boundary: every actual read/write still goes
 * through withAuth()+can()+RLS in the API routes those pages call. Per the
 * Next.js Proxy docs, this kind of check must never be treated as a
 * standalone auth solution — treat this as a redirect convenience only.
 */
export async function requirePageUser(
  allowedRoles: AuthenticatedUser["role"][]
): Promise<AuthenticatedUser> {
  const user = await getCurrentUser();
  if (!user || user.status !== "active") {
    redirect("/login");
  }
  if (!allowedRoles.includes(user.role)) {
    redirect("/login");
  }
  return user;
}
