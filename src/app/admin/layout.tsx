import { requirePageUser } from "@/lib/auth/requirePageUser";
import { SignOutButton } from "@/components/sign-out-button";
import { AdminNav } from "@/components/admin/admin-nav";
import { BrandMark } from "@/components/brand-mark";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requirePageUser(["client_admin"]);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-8">
            <BrandMark />
            <AdminNav />
          </div>
          <SignOutButton />
        </div>
      </header>
      <main className="mx-auto max-w-5xl p-6">{children}</main>
    </div>
  );
}
