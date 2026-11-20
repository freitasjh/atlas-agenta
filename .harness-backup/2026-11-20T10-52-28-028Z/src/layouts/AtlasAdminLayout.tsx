"use client"

import type { CSSProperties, ReactNode } from "react"
import { SidebarProvider, SidebarInset } from "@/components/shadcn/ui/sidebar"
import { AppSidebar, type DashboardViewId } from "@/components/shadcn/navigation/app-sidebar"
import { SiteHeader } from "@/components/shadcn/navigation/site-header"
import { MobileBottomNav } from "@/components/shadcn/navigation/mobile-bottom-nav"

export const defaultSidebarStyle: CSSProperties = {
  "--sidebar-width": "calc(var(--spacing) * 72)",
  "--header-height": "calc(var(--spacing) * 12)",
} as CSSProperties

export interface AtlasAdminLayoutProps {
  /** Título exibido no cabeçalho e breadcrumb */
  title?: string
  /** Identificador da rota/visão ativa na navegação lateral */
  activeView?: DashboardViewId
  /** Callback acionado ao clicar em um item da barra lateral */
  onSelectView?: (view: DashboardViewId) => void
  /** Conteúdo da página atual (renderizado dentro do <main> responsivo) */
  children: ReactNode
  /** Estilos e variáveis CSS customizadas da sidebar */
  sidebarStyle?: CSSProperties
}

/**
 * Template Admin Atlas (Perfil Shadcn).
 *
 * É o esqueleto administrativo completo para aplicações SaaS/ERP.
 * Gerencia a barra lateral retrátil (AppSidebar), cabeçalho com ações, busca,
 * notificações e alternador de tema (SiteHeader), e provê a área de <main>
 * com Container Queries (@container/main) e ritmo vertical consistente.
 */
export function AtlasAdminLayout({
  title = "Painel",
  activeView,
  onSelectView,
  children,
  sidebarStyle = defaultSidebarStyle,
}: AtlasAdminLayoutProps) {
  return (
    <SidebarProvider style={sidebarStyle}>
      <AppSidebar
        variant="inset"
        activeView={activeView}
        onSelectView={onSelectView}
      />
      <SidebarInset>
        <SiteHeader title={title} />
        <main className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6 pb-20 md:pb-6">
              {children}
            </div>
          </div>
        </main>
      </SidebarInset>
      <MobileBottomNav
        activeView={activeView}
        onSelectView={onSelectView}
      />
    </SidebarProvider>
  )
}

// Aliases semânticos para máxima ergonomia de importação
export const AtlasAdminTemplate = AtlasAdminLayout
export const AdminLayout = AtlasAdminLayout
export const DashboardLayout = AtlasAdminLayout
export type AtlasAdminTemplateProps = AtlasAdminLayoutProps
export type AdminLayoutProps = AtlasAdminLayoutProps
export type DashboardLayoutProps = AtlasAdminLayoutProps

