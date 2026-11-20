"use client"

import {
  IconDashboard,
  IconListDetails,
  IconCreditCard,
  IconBuildingBank,
  IconDots,
} from "@tabler/icons-react"
import { useSidebar } from "@/components/shadcn/ui/sidebar"
import type { DashboardViewId } from "@/components/shadcn/navigation/app-sidebar"
import { cn } from "@/lib/cn"

export interface MobileBottomNavProps {
  activeView?: DashboardViewId
  onSelectView?: (view: DashboardViewId) => void
}

export function MobileBottomNav({
  activeView = "overview",
  onSelectView,
}: MobileBottomNavProps) {
  const { toggleSidebar } = useSidebar()

  const primaryItems = [
    {
      id: "overview" as DashboardViewId,
      label: "Início",
      icon: IconDashboard,
    },
    {
      id: "transactions" as DashboardViewId,
      label: "Transações",
      icon: IconListDetails,
    },
    {
      id: "cards" as DashboardViewId,
      label: "Cartões",
      icon: IconCreditCard,
    },
    {
      id: "accounts" as DashboardViewId,
      label: "Contas",
      icon: IconBuildingBank,
    },
  ]

  return (
    <nav
      aria-label="Navegação móvel inferior"
      className="fixed bottom-0 left-0 right-0 z-40 flex h-16 items-center justify-around border-t border-border/80 bg-background/95 px-2 backdrop-blur-md pb-[env(safe-area-inset-bottom,0px)] shadow-[0_-4px_16px_rgba(0,0,0,0.06)] dark:shadow-[0_-4px_16px_rgba(0,0,0,0.3)] md:hidden transition-all duration-200"
    >
      {primaryItems.map((item) => {
        const Icon = item.icon
        const isActive = activeView === item.id

        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelectView?.(item.id)}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "group relative flex flex-1 flex-col items-center justify-center gap-1 py-1 text-[11px] font-medium transition-all min-h-[48px] active:scale-95",
              isActive
                ? "text-primary font-semibold"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {/* Indicador sutil de aba ativa no topo */}
            {isActive && (
              <span className="absolute -top-[1px] h-0.5 w-8 rounded-full bg-primary" />
            )}
            <div
              className={cn(
                "flex size-7 items-center justify-center rounded-lg transition-all",
                isActive
                  ? "bg-primary/10 text-primary scale-105"
                  : "group-hover:bg-muted/50"
              )}
            >
              <Icon className="size-5" />
            </div>
            <span className="truncate max-w-[64px]">{item.label}</span>
          </button>
        )
      })}

      {/* Botão 'Mais' para abrir a gaveta completa */}
      <button
        type="button"
        onClick={toggleSidebar}
        aria-label="Mais opções e módulos"
        className="group relative flex flex-1 flex-col items-center justify-center gap-1 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground active:text-primary transition-all min-h-[48px] active:scale-95"
      >
        <div className="flex size-7 items-center justify-center rounded-lg group-hover:bg-muted/50 transition-all">
          <IconDots className="size-5" />
        </div>
        <span>Mais</span>
      </button>
    </nav>
  )
}
