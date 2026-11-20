"use client"

import * as React from "react"
import {
  IconCalendarEvent,
  IconCreditCard,
  IconBuildingSkyscraper,
  IconDashboard,
  IconFileDescription,
  IconFileWord,
  IconFolder,
  IconHelp,
  IconInnerShadowTop,
  IconLayoutKanban,
  IconListDetails,
  IconReport,
  IconSearch,
  IconSettings,
  IconShieldCheck,
  IconSparkles,
  IconUsers,
  IconReceiptTax,
  IconBuildingBank,
} from "@tabler/icons-react"

import { NavDocuments } from "@/components/shadcn/navigation/nav-documents"
import { NavMain } from "@/components/shadcn/navigation/nav-main"
import { NavSecondary } from "@/components/shadcn/navigation/nav-secondary"
import { NavUser } from "@/components/shadcn/navigation/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/shadcn/ui/sidebar"

export type DashboardViewId = "overview" | "ai" | "kanban" | "scheduler" | "transactions" | "cards" | "checkout" | "pdv" | "accounts" | "files" | "backoffice" | "internal-admin" | "settings"

const data = {
  user: {
    name: "Atlas Admin",
    email: "admin@atlas.com.br",
    avatar: "",
  },
  navMain: [
    {
      id: "overview" as DashboardViewId,
      title: "Visão geral",
      url: "#",
      icon: IconDashboard,
    },
    {
      id: "ai" as DashboardViewId,
      title: "Atlas AI Copilot",
      url: "#ai",
      icon: IconSparkles,
      badge: "AI",
    },
    {
      id: "internal-admin" as DashboardViewId,
      title: "SaaS Admin",
      url: "#internal-admin",
      icon: IconBuildingSkyscraper,
      badge: "148",
    },
    {
      id: "backoffice" as DashboardViewId,
      title: "Backoffice",
      url: "#backoffice",
      icon: IconShieldCheck,
      badge: "28",
    },
    {
      id: "files" as DashboardViewId,
      title: "Arquivos",
      url: "#files",
      icon: IconFolder,
      badge: "8",
    },
    {
      id: "kanban" as DashboardViewId,
      title: "Quadro Kanban",
      url: "#kanban",
      icon: IconLayoutKanban,
      badge: "6",
    },
    {
      id: "scheduler" as DashboardViewId,
      title: "Agendamento",
      url: "#scheduler",
      icon: IconCalendarEvent,
      badge: "4",
    },
    {
      id: "transactions" as DashboardViewId,
      title: "Transações",
      url: "#transactions",
      icon: IconListDetails,
      badge: "10",
    },
    {
      id: "cards" as DashboardViewId,
      title: "Cartões & Faturas",
      url: "#cards",
      icon: IconCreditCard,
      badge: "3",
    },
    {
      id: "pdv" as DashboardViewId,
      title: "PDV Frente de Caixa",
      url: "#pdv",
      icon: IconReceiptTax,
      badge: "NFC-e",
    },
    {
      id: "checkout" as DashboardViewId,
      title: "Checkout",
      url: "#checkout",
      icon: IconCreditCard,
    },
    {
      id: "accounts" as DashboardViewId,
      title: "Contas Bancárias",
      url: "#accounts",
      icon: IconBuildingBank,
      badge: "6",
    },
    {
      id: "reports",
      title: "Relatórios",
      url: "#",
      icon: IconReport,
    },
    {
      id: "team",
      title: "Equipe",
      url: "#",
      icon: IconUsers,
    },
  ],
  navSecondary: [
    {
      id: "settings" as DashboardViewId,
      title: "Configurações",
      url: "#settings",
      icon: IconSettings,
    },
    {
      title: "Ajuda",
      url: "#",
      icon: IconHelp,
    },
    {
      title: "Busca",
      url: "#",
      icon: IconSearch,
    },
  ],
  documents: [
    {
      name: "Faturas",
      url: "#",
      icon: IconFileDescription,
    },
    {
      name: "Contratos",
      url: "#",
      icon: IconFileWord,
    },
    {
      name: "Integrações",
      url: "#",
      icon: IconFolder,
    },
  ],
}

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  activeView?: DashboardViewId
  onSelectView?: (view: DashboardViewId) => void
  onNewEntry?: () => void
}

export function AppSidebar({
  activeView = "overview",
  onSelectView,
  onNewEntry,
  ...props
}: AppSidebarProps) {
  const { isMobile, setOpenMobile } = useSidebar()

  const handleSelect = React.useCallback(
    (viewId: DashboardViewId) => {
      onSelectView?.(viewId)
      if (isMobile) {
        setOpenMobile(false)
      }
    },
    [isMobile, onSelectView, setOpenMobile]
  )

  const navMainItems = data.navMain.map((item) => ({
    ...item,
    isActive: activeView === item.id,
    onClick: () => {
      if (item.id) {
        handleSelect(item.id as DashboardViewId)
      }
    },
  }))

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="data-[slot=sidebar-menu-button]:p-1.5! hover:bg-transparent"
            >
              <a href="#" className="flex items-center gap-2.5">
                <div className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-xs">
                  <IconInnerShadowTop className="size-4" />
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-semibold tracking-tight">Atlas</span>
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Workspace</span>
                </div>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain
          items={navMainItems}
          onNewEntry={onNewEntry ?? (() => onSelectView?.("transactions"))}
        />
        <NavDocuments items={data.documents} />
        <NavSecondary
          items={data.navSecondary.map((item) => ({
            ...item,
            isActive: "id" in item && activeView === item.id,
            onClick:
              "id" in item
                ? () => handleSelect(item.id as DashboardViewId)
                : undefined,
          }))}
          className="mt-auto"
        />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={data.user} />
      </SidebarFooter>
    </Sidebar>
  )
}
