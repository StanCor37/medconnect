import { requirePageUser } from "@/lib/auth/requirePageUser";

export default async function ClientAdminOverviewPage() {
  const user = await requirePageUser(["client_admin"]);

  return (
    <div>
      <h1 className="font-heading text-2xl font-semibold text-foreground">
        Welcome back, {user.firstName}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">Signed in as {user.email}.</p>
      <p className="mt-4 text-sm text-muted-foreground">
        Cases, Reviews, Providers, and Analytics are not built yet — start with Rules and Schemes above.
      </p>
    </div>
  );
}
