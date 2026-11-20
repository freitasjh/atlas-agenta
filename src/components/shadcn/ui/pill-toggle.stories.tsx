import type { Meta, StoryObj } from "@storybook/react"
import * as React from "react"
import { PillToggle, PillToggleItem } from "./pill-toggle"
import { Building2, Receipt, Wallet, Layers, Grid, List, CheckCircle2, AlertCircle } from "lucide-react"

const meta: Meta<typeof PillToggle> = {
  title: "Shadcn/UI/PillToggle",
  component: PillToggle,
  parameters: {
    layout: "centered",
  },
  tags: ["autodocs"],
}

export default meta
type Story = StoryObj<typeof PillToggle>

export const Default: Story = {
  render: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [mode, setMode] = React.useState("statements")
    return (
      <PillToggle
        value={mode}
        onChange={setMode}
        options={[
          { value: "statements", label: "Extrato & Conciliação", icon: <Receipt className="size-3.5" /> },
          { value: "grid", label: "Carteira de Contas", icon: <Building2 className="size-3.5" /> },
        ]}
      />
    )
  },
}

export const ThreeSizes: Story = {
  render: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [valSm, setValSm] = React.useState("statements")
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [valMd, setValMd] = React.useState("statements")
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [valLg, setValLg] = React.useState("statements")

    const options = [
      { value: "statements", label: "Extrato & Conciliação", icon: <Receipt /> },
      { value: "grid", label: "Carteira de Contas", icon: <Building2 /> },
    ]

    return (
      <div className="flex flex-col items-start gap-6">
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Tamanho Pequeno (sm) - Ideal para headers compactos e filtros de tabela:
          </span>
          <PillToggle size="sm" value={valSm} onChange={setValSm} options={options} />
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Tamanho Médio (md / padrão) - Ideal para alternância de visualização principal:
          </span>
          <PillToggle size="md" value={valMd} onChange={setValMd} options={options} />
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Tamanho Grande (lg) - Ideal para telas de onboarding, dashboards e destaques:
          </span>
          <PillToggle size="lg" value={valLg} onChange={setValLg} options={options} />
        </div>
      </div>
    )
  },
}

export const WithBadgesAndCounts: Story = {
  render: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [view, setView] = React.useState("wallet")
    return (
      <PillToggle
        value={view}
        onChange={setView}
        size="md"
        options={[
          {
            value: "statements",
            label: "Faturas em Aberto",
            icon: <Receipt className="size-3.5" />,
            badge: "3",
          },
          {
            value: "wallet",
            label: "Gerenciar Cartões",
            icon: <Wallet className="size-3.5" />,
            badge: "8",
          },
        ]}
      />
    )
  },
}

export const MultiOptionSegmented: Story = {
  render: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [view, setView] = React.useState("all")
    return (
      <PillToggle
        value={view}
        onChange={setView}
        size="sm"
        options={[
          { value: "all", label: "Todos", icon: <Layers className="size-3.5" />, badge: 42 },
          { value: "active", label: "Aprovados", icon: <CheckCircle2 className="size-3.5" />, badge: 38 },
          { value: "pending", label: "Pendentes", icon: <AlertCircle className="size-3.5" />, badge: 4 },
        ]}
      />
    )
  },
}

export const CompoundChildrenSyntax: Story = {
  render: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [layout, setLayout] = React.useState("grid")
    return (
      <PillToggle value={layout} onChange={setLayout} size="md">
        <PillToggleItem value="grid" icon={<Grid className="size-3.5" />}>
          Grade
        </PillToggleItem>
        <PillToggleItem value="list" icon={<List className="size-3.5" />}>
          Lista
        </PillToggleItem>
      </PillToggle>
    )
  },
}

export const TableFilterToolbar: Story = {
  render: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [type, setType] = React.useState("all")
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [status, setStatus] = React.useState("all")

    return (
      <div className="flex flex-wrap items-center gap-3 p-4 rounded-xl border border-border/80 bg-card">
        <PillToggle
          value={type}
          onChange={setType}
          size="sm"
          options={[
            { value: "all", label: "Todos" },
            { value: "in", label: "Entradas", activeClassName: "text-emerald-600 dark:text-emerald-400 font-bold" },
            { value: "out", label: "Saídas" },
          ]}
        />

        <PillToggle
          value={status}
          onChange={setStatus}
          size="sm"
          options={[
            { value: "all", label: "Status: Todos" },
            { value: "reconciled", label: "Conciliados", activeClassName: "text-emerald-600 dark:text-emerald-400 font-bold" },
            { value: "pending", label: "Pendentes", activeClassName: "text-amber-600 dark:text-amber-400 font-bold" },
          ]}
        />
      </div>
    )
  },
}

export const IconOnlyViewMode: Story = {
  render: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [mode, setMode] = React.useState("grid")
    return (
      <PillToggle
        value={mode}
        onChange={setMode}
        size="sm"
        options={[
          { value: "grid", icon: <Grid className="size-3.5" />, title: "Grade" },
          { value: "list", icon: <List className="size-3.5" />, title: "Lista" },
        ]}
      />
    )
  },
}


