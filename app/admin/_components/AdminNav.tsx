"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS: { href: string; label: string }[] = [
  { href: "/admin", label: "📅 Schedule" },
  { href: "/admin/billing", label: "💵 Billing" },
  { href: "/admin/properties", label: "🏠 Properties" },
  { href: "/admin/owners", label: "👤 Owners" },
  { href: "/admin/cleaners", label: "🧹 Cleaners" },
];

export default function AdminNav() {
  const pathname = usePathname();

  return (
    <nav style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
      {TABS.map((tab) => {
        const isActive =
          tab.href === "/admin"
            ? pathname === "/admin"
            : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            style={{
              color: isActive ? "#5eead4" : "#cbd5e1",
              background: isActive ? "#1e293b" : "transparent",
              border: "1px solid",
              borderColor: isActive ? "#334155" : "transparent",
              padding: "6px 14px",
              borderRadius: "20px",
              fontSize: "13px",
              fontWeight: isActive ? 600 : 400,
              textDecoration: "none",
            }}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
