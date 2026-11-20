"use client"

import { useState } from "react"
import { AtlasAdminTemplate } from "@/layouts"
import type { DashboardViewId } from "@/components/shadcn/navigation"
import { SectionCards, ChartAreaInteractive, DataTable } from "@/components/shadcn/dashboard"
import { KanbanBoard } from "@/components/shadcn/kanban"
import { Scheduler } from "@/components/shadcn/scheduler"
import { TransactionsView } from "@/components/shadcn/transactions"
import { CardStatementsView } from "@/components/shadcn/credit-card"
import { PDVView } from "@/components/shadcn/pdv"
import { BankAccountsView } from "@/components/shadcn/bank-accounts"
import { AIWorkspaceView } from "@/components/shadcn/ai"
import { SettingsView } from "@/components/shadcn/settings"
import { CheckoutView } from "@/components/shadcn/checkout"
import { FileManagerView } from "@/components/shadcn/file-manager"
import { BackofficeView } from "@/components/shadcn/backoffice"
import { InternalAdminView } from "@/components/shadcn/internal-admin"
import { Toaster } from "@/components/shadcn/ui/sonner"
import data from "@/app/dashboard/data.json"

const titles: Record<DashboardViewId, string> = {
  overview: "Visão Geral",
  ai: "Atlas AI • Copiloto & Agentes",
  "internal-admin": "SaaS Admin • Gestão de Empresas",
  backoffice: "Backoffice & Central de Compliance",
  files: "Gerenciador de Arquivos",
  kanban: "Quadro Kanban",
  scheduler: "Agenda de Profissionais",
  transactions: "Gestão de Transações",
  cards: "Cartões & Faturas",
  pdv: "PDV • Frente de Caixa",
  accounts: "Contas & Tesouraria",
  settings: "Configurações",
  checkout: "Checkout & Pagamento",
}

export default function App() {
  const [activeView, setActiveView] = useState<DashboardViewId>("overview")

  return (
    <>
      <AtlasAdminTemplate
        title={titles[activeView] ?? "Painel"}
        activeView={activeView}
        onSelectView={setActiveView}
      >
        {activeView === "overview" && (
          <>
            <SectionCards />
            <div className="px-4 lg:px-6">
              <ChartAreaInteractive />
            </div>
            <DataTable data={data} />
          </>
        )}

        {activeView === "ai" && (
          <AIWorkspaceView />
        )}

        {activeView === "internal-admin" && (
          <InternalAdminView />
        )}

        {activeView === "backoffice" && (
          <BackofficeView />
        )}

        {activeView === "files" && (
          <FileManagerView />
        )}

        {activeView === "kanban" && (
          <div className="flex flex-col gap-4 px-4 lg:px-6">
            <div className="flex flex-col gap-1 border-b border-border/70 pb-3">
              <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                Quadro de Tarefas & Demandas
              </h1>
              <p className="text-xs text-muted-foreground">
                Organize o backlog da equipe com colunas Kanban no padrão Linear, busca e filtros de prioridade.
              </p>
            </div>
            <KanbanBoard />
          </div>
        )}

        {activeView === "scheduler" && (
          <div className="flex flex-col gap-4 px-4 lg:px-6">
            <div className="flex flex-col gap-1 border-b border-border/70 pb-3">
              <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
                Agenda & Agendamento de Profissionais
              </h1>
              <p className="text-xs text-muted-foreground">
                Grade multi-profissional de consultas, perspectiva diária, semanal e timeline por turnos.
              </p>
            </div>
            <Scheduler />
          </div>
        )}

        {activeView === "transactions" && (
          <TransactionsView />
        )}

        {activeView === "cards" && (
          <CardStatementsView />
        )}

        {activeView === "pdv" && (
          <PDVView />
        )}

        {activeView === "accounts" && (
          <BankAccountsView />
        )}

        {activeView === "settings" && (
          <SettingsView />
        )}

        {activeView === "checkout" && (
          <CheckoutView />
        )}
      </AtlasAdminTemplate>
      <Toaster position="top-right" />
    </>
  )
}
