"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/provider/home", label: "Home", icon: Home },
  { href: "/provider/cases", label: "Cases", icon: FileText },
];

export function ProviderNav() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1">
      {LINKS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
              active ? "bg-accent text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground"
            )}
          >
            <Icon className="size-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
