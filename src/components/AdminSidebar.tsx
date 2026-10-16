import { Building2, ShieldCheck } from "lucide-react";

import { Logo } from "@/components/Logo";
import { SidebarNav, type SidebarNavItem } from "@/components/SidebarNav";

const ADMIN_NAV_ITEMS: SidebarNavItem[] = [
  { to: "/admin", label: "Painel", icon: ShieldCheck, end: true },
  { to: "/admin/empresas", label: "Empresas", icon: Building2 },
];

interface AdminSidebarProps {
  /** Fecha o Sheet no mobile ao navegar. */
  onNavigate?: () => void;
}

/**
 * Sidebar do painel do super admin (`/admin`). Mesmo padrão da AppSidebar.
 */
export function AdminSidebar({ onNavigate }: AdminSidebarProps) {
  return (
    <div className="flex h-full flex-col gap-6">
      <div className="px-3">
        <Logo />
      </div>
      <SidebarNav items={ADMIN_NAV_ITEMS} onNavigate={onNavigate} />
    </div>
  );
}
