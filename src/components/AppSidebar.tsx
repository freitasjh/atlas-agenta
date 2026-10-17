import {
  CalendarDays,
  LayoutDashboard,
  Receipt,
  Settings,
  Users,
} from "lucide-react";

import { Logo } from "@/components/Logo";
import { SignOutButton } from "@/components/SignOutButton";
import { SidebarNav, type SidebarNavItem } from "@/components/SidebarNav";

const APP_NAV_ITEMS: SidebarNavItem[] = [
  { to: "/app", label: "Visão geral", icon: LayoutDashboard, end: true },
  { to: "/app/agenda", label: "Agenda", icon: CalendarDays },
  { to: "/app/clientes", label: "Clientes", icon: Users },
  { to: "/app/cobrancas", label: "Cobranças", icon: Receipt },
  { to: "/app/config", label: "Configurações", icon: Settings },
];

interface AppSidebarProps {
  /** Fecha o Sheet no mobile ao navegar. */
  onNavigate?: () => void;
}

/**
 * Sidebar do painel do tenant (`/app`). Compõe a marca e a navegação dos
 * módulos. O layout decide onde montá-la (fixa em ≥768px, Sheet no mobile).
 */
export function AppSidebar({ onNavigate }: AppSidebarProps) {
  return (
    <div className="flex h-full flex-col gap-6">
      <div className="px-3">
        <Logo />
      </div>
      <SidebarNav items={APP_NAV_ITEMS} onNavigate={onNavigate} />
      <SignOutButton className="mt-auto w-full justify-start" />
    </div>
  );
}
