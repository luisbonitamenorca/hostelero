"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/visitas", label: "Dashboard" },
  { href: "/visitas/productos", label: "Productos" },
  { href: "/visitas/calendario", label: "Calendario" },
  { href: "/visitas/reservas", label: "Reservas" },
  { href: "/visitas/bonos", label: "Bonos" },
];

export default function Tabs() {
  const pathname = usePathname();
  return (
    <nav className="vis-tabs">
      {TABS.map((t) => {
        const on = t.href === "/visitas" ? pathname === "/visitas" : pathname.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href} className={on ? "on" : ""}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
