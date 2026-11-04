import {
  BarChart3,
  CalendarDays,
  Clock,
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
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useProfessionals } from "@/hooks/useProfessionals";

interface AppSidebarProps {
  /** Fecha o Sheet no mobile ao navegar. */
  onNavigate?: () => void;
}

export function AppSidebar({ onNavigate }: AppSidebarProps) {
  const { isAdmin, isProfessional, canViewCommission } = usePermissions();
  const { commission } = useSegmentFeatures();
  const { userId } = useCurrentUser();
  const professionalsQuery = useProfessionals({ activeOnly: true, enabled: isProfessional });

  const ownProfessional = isProfessional
    ? (professionalsQuery.data?.find((p) => p.profile_id === userId) ?? null)
    : null;

  const showReports = commission && canViewCommission;

  const items: SidebarNavItem[] = [];

  items.push({ to: "/app", label: "Visão geral", icon: LayoutDashboard, end: true });
  items.push({ to: "/app/agenda", label: "Agenda", icon: CalendarDays });
  items.push({ to: "/app/clientes", label: "Clientes", icon: Users });

  if (isAdmin) {
    items.push({ to: "/app/cobrancas", label: "Cobranças", icon: Receipt });
  }

  if (isProfessional && ownProfessional) {
    items.push({
      to: `/app/config/profissionais/${ownProfessional.id}/horarios`,
      label: "Horários",
      icon: Clock,
    });
  }

  if (isAdmin) {
    items.push({ to: "/app/config", label: "Configurações", icon: Settings });
  }

  if (showReports) {
    items.push({ to: "/app/relatorios", label: "Relatórios", icon: BarChart3 });
  }

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
