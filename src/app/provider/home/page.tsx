import Link from "next/link";
import { FileText } from "lucide-react";
import { requirePageUser } from "@/lib/auth/requirePageUser";
import { Button } from "@/components/ui/button";

export default async function ProviderHomePage() {
  const user = await requirePageUser(["provider_user"]);

  return (
    <div>
      <h1 className="font-heading text-2xl font-semibold text-foreground">
        Welcome back, {user.firstName}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">Signed in as {user.email}.</p>
      <Button
        className="mt-6"
        nativeButton={false}
        render={
          <Link href="/provider/cases">
            <FileText className="size-4" />
            View Cases
          </Link>
        }
      />
    </div>
  );
}
