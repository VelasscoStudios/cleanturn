"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS: { href: string; label: string }[] = [
  { href: "/admin", label: "📅 Schedule" },
  { href: "/admin/billing", label: "💵 Billing" },
  { href: "/admin/properties", label: "🏠 Properties" },
  { href: "/admin/owners", label: "👤 Owners" },
  { href: "/admin/cleaners", label: "🧹 Cleaners" },
  { href: "/admin/notes", label: "📝 Notes" },
  { href: "/admin/users", label: "👥 Users" },
  { href: "/admin/account", label: "⚙️ Account" },
];

export default function AdminNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        className="nav-burger"
        aria-label={open ? "Close menu" : "Open menu"}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? "✕" : "☰"}
      </button>
      <nav className={`admin-nav${open ? " open" : ""}`}>
        {TABS.map((tab) => {
          const isActive =
            tab.href === "/admin"
              ? pathname === "/admin"
              : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`admin-nav-link${isActive ? " active" : ""}`}
              onClick={() => setOpen(false)}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
