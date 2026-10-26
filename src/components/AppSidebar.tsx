import {
  BarChart3,
  CalendarDays,
  LayoutDashboard,
  Receipt,
  Settings,
  Users,
} from "lucide-react";

import { Logo } from "@/components/Logo";
import { SignOutButton } from "@/components/SignOutButton";
import { SidebarNav, type SidebarNavItem } from "@/components/SidebarNav";
import { usePermissions } from "@/hooks/usePermissions";
import { useSegmentFeatures } from "@/hooks/useSegmentFeatures";

const BASE_NAV_ITEMS: SidebarNavItem[] = [
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
 *
 * O item "Relatórios" é condicional (ADR-08, Fase 1b): aparece só quando o ramo
 * habilita comissão (`useSegmentFeatures().commission`) e o papel pode ver
 * comissão (`canViewCommission` — admin/professional). Para os demais a sidebar
 * fica idêntica a hoje, sem layout shift. O gating é só de UI; a trava real é o
 * RLS. O `SidebarNav` marca o item ativo com `aria-current="page"`.
 */
export function AppSidebar({ onNavigate }: AppSidebarProps) {
  const { canViewCommission } = usePermissions();
  const { commission } = useSegmentFeatures();

  const showReports = commission && canViewCommission;

  const items: SidebarNavItem[] = showReports
    ? [
        ...BASE_NAV_ITEMS,
        { to: "/app/relatorios", label: "Relatórios", icon: BarChart3 },
      ]
    : BASE_NAV_ITEMS;

  return (
    <div className="flex h-full flex-col gap-6">
      <div className="px-3">
        <Logo />
      </div>
      <SidebarNav items={items} onNavigate={onNavigate} />
      <SignOutButton className="mt-auto w-full justify-start" />
    </div>
  );
}
