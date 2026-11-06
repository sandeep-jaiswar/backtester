"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/", label: "Backtest" },
  { href: "/optimize", label: "Optimise" },
  { href: "/strategies", label: "Strategies" },
  { href: "/runs", label: "History" },
];

export function AppNav() {
  const pathname = usePathname();
  return (
    <header className="border-b bg-background">
      <nav className="mx-auto flex max-w-7xl items-center gap-1 overflow-x-auto p-2 md:px-6">
        <span className="mr-3 px-2 text-sm font-semibold">Backtester</span>
        {LINKS.map((l) => {
          const active = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
          return (
            <Link
              key={l.href}
              href={l.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-accent",
                active ? "bg-accent font-medium" : "text-muted-foreground",
              )}
            >
              {l.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
