import type { Meta, StoryObj } from "@storybook/react"
import * as React from "react"
import { createColumnHelper } from "@tanstack/react-table"
import {
  Download,
  Plus,
  Receipt,
  MoreHorizontal,
  Eye,
  Pencil,
  Trash2,
  CheckCircle2,
  Clock,
  AlertCircle,
  FileSpreadsheet,
} from "lucide-react"

import { Button } from "@/components/shadcn/ui/button"
import { Badge } from "@/components/shadcn/ui/badge"
import { Checkbox } from "@/components/shadcn/ui/checkbox"
import { PillToggle } from "@/components/shadcn/ui/pill-toggle"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/shadcn/ui/dropdown-menu"

import { DataTable } from "./data-table"
import { DataTableColumnHeader } from "./data-table-column-header"
import { dataTableFeatures } from "./data-table-types"

interface SampleTransaction {
  id: string
  description: string
  client: string
  category: string
  date: string
  amount: number
  status: "completed" | "pending" | "failed"
  type: "in" | "out"
}

const SAMPLE_DATA: SampleTransaction[] = [
  {
    id: "tx-101",
    description: "Mensalidade Plano Enterprise",
    client: "Acme Indústria Ltda",
    category: "Assinaturas SaaS",
    date: "17/11/2026",
    amount: 14850.0,
    status: "completed",
    type: "in",
  },
  {
    id: "tx-102",
    description: "Servidores Cloud AWS",
    client: "Amazon Web Services",
    category: "Infraestrutura",
    date: "16/11/2026",
    amount: -3420.5,
    status: "completed",
    type: "out",
  },
  {
    id: "tx-103",
    description: "Honorários Consultoria Fiscal",
    client: "PwC Brasil",
    category: "Serviços Terceirizados",
    date: "15/11/2026",
    amount: -6200.0,
    status: "pending",
    type: "out",
  },
  {
    id: "tx-104",
    description: "Licenciamento de Software",
    client: "TechNova Soluções",
    category: "Receita de Licenças",
    date: "14/11/2026",
    amount: 8900.0,
    status: "completed",
    type: "in",
  },
  {
    id: "tx-105",
    description: "Reembolso Despesas Viagem",
    client: "Mariana Costa",
    category: "Operacional",
    date: "13/11/2026",
    amount: -840.3,
    status: "failed",
    type: "out",
  },
  {
    id: "tx-106",
    description: "Integração API Open Finance",
    client: "Banco Safra",
    category: "Projetos Especiais",
    date: "12/11/2026",
    amount: 32000.0,
    status: "completed",
    type: "in",
  },
  {
    id: "tx-107",
    description: "Assinatura GitHub Enterprise",
    client: "GitHub Inc",
    category: "Ferramentas Dev",
    date: "11/11/2026",
    amount: -1150.0,
    status: "completed",
    type: "out",
  },
]

const columnHelper = createColumnHelper<typeof dataTableFeatures, SampleTransaction>()

const columns = columnHelper.columns([
  // 1. Checkbox de Seleção
  columnHelper.display({
    id: "select",
    header: ({ table }) => (
      <div className="flex items-center justify-center">
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && "indeterminate")
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Selecionar todas as linhas"
        />
      </div>
    ),
    cell: ({ row }) => (
      <div
        className="flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label="Selecionar linha"
        />
      </div>
    ),
    enableSorting: false,
    enableHiding: false,
  }),

  // 2. Descrição e Cliente
  columnHelper.accessor("description", {
    header: ({ column }) => <DataTableColumnHeader column={column} title="Descrição / Cliente" />,
    cell: ({ row }) => (
      <div className="flex flex-col">
        <span className="font-medium text-foreground text-xs">{row.original.description}</span>
        <span className="text-[11px] text-muted-foreground">{row.original.client}</span>
      </div>
    ),
  }),

  // 3. Categoria
  columnHelper.accessor("category", {
    header: ({ column }) => <DataTableColumnHeader column={column} title="Categoria" />,
    cell: ({ row }) => (
      <Badge variant="outline" className="text-[11px] font-normal border-border/80">
        {row.original.category}
      </Badge>
    ),
  }),

  // 4. Data
  columnHelper.accessor("date", {
    header: ({ column }) => <DataTableColumnHeader column={column} title="Data" />,
    cell: ({ row }) => (
      <span className="text-xs text-muted-foreground font-mono">{row.original.date}</span>
    ),
  }),

  // 5. Status
  columnHelper.accessor("status", {
    header: ({ column }) => <DataTableColumnHeader column={column} title="Status" />,
    cell: ({ row }) => {
      const s = row.original.status
      if (s === "completed") {
        return (
          <Badge variant="secondary" className="gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 border-0">
            <CheckCircle2 className="size-3" />
            Concluída
          </Badge>
        )
      }
      if (s === "pending") {
        return (
          <Badge variant="secondary" className="gap-1 text-[11px] text-amber-600 dark:text-amber-400 bg-amber-500/10 border-0">
            <Clock className="size-3" />
            Pendente
          </Badge>
        )
      }
      return (
        <Badge variant="secondary" className="gap-1 text-[11px] text-rose-600 dark:text-rose-400 bg-rose-500/10 border-0">
          <AlertCircle className="size-3" />
          Falhou
        </Badge>
      )
    },
  }),

  // 6. Valor Monetário (Alinhado à Direita)
  columnHelper.accessor("amount", {
    header: ({ column }) => (
      <div className="text-right">
        <DataTableColumnHeader column={column} title="Valor" className="justify-end -mr-3" />
      </div>
    ),
    cell: ({ row }) => {
      const amount = row.original.amount
      const formatted = new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
      }).format(Math.abs(amount))

      return (
        <div className="text-right">
          <span
            className={`font-semibold text-xs tracking-tight ${
              amount > 0
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-foreground"
            }`}
          >
            {amount > 0 ? `+ ${formatted}` : `- ${formatted}`}
          </span>
        </div>
      )
    },
  }),

  // 7. Ações por Linha
  columnHelper.display({
    id: "actions",
    cell: () => (
      <div className="text-right" onClick={(e) => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-7 text-muted-foreground hover:text-foreground">
              <MoreHorizontal className="size-3.5" />
              <span className="sr-only">Ações</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem className="gap-2 text-xs">
              <Eye className="size-3.5 text-muted-foreground" />
              Ver Detalhes
            </DropdownMenuItem>
            <DropdownMenuItem className="gap-2 text-xs">
              <Pencil className="size-3.5 text-muted-foreground" />
              Editar
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="gap-2 text-xs text-rose-600 dark:text-rose-400">
              <Trash2 className="size-3.5" />
              Excluir
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    ),
    enableSorting: false,
    enableHiding: false,
  }),
])

const meta: Meta<typeof DataTable> = {
  title: "Shadcn/UI/DataTable",
  component: DataTable,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
}

export default meta
type Story = StoryObj<typeof DataTable>

function DefaultStory() {
  const [typeFilter, setTypeFilter] = React.useState("all")

  const filteredData = React.useMemo(() => {
    if (typeFilter === "all") return SAMPLE_DATA
    return SAMPLE_DATA.filter((item) => item.type === typeFilter)
  }, [typeFilter])

  return (
    <DataTable
      title="Lançamentos & Transações"
      description="Gestão unificada de conciliação, contas correntes e recebíveis"
      badgeCount={SAMPLE_DATA.length}
      icon={<Receipt className="size-4" />}
      columns={columns}
      data={filteredData}
      searchKey="description"
      searchPlaceholder="Buscar por descrição ou cliente..."
      enableColumnVisibility
      enablePagination
      pageSize={5}
      toolbarFilters={
        <PillToggle
          size="sm"
          value={typeFilter}
          onChange={setTypeFilter}
          options={[
            { value: "all", label: "Todos" },
            { value: "in", label: "Entradas", activeClassName: "text-emerald-600 dark:text-emerald-400 font-bold" },
            { value: "out", label: "Saídas" },
          ]}
        />
      }
      toolbarActions={
        <>
          <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
            <Download className="size-3.5" />
            <span className="hidden sm:inline">Exportar</span>
          </Button>
          <Button size="sm" className="h-8 gap-1.5 text-xs font-semibold">
            <Plus className="size-3.5" />
            <span>Novo Registro</span>
          </Button>
        </>
      }
      floatingBar={(table) => {
        const selectedRows = table.getFilteredSelectedRowModel().rows
        if (selectedRows.length === 0) return null
        return (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 rounded-xl border border-border/80 bg-background/95 backdrop-blur-md px-4 py-2 shadow-xl">
            <Badge variant="secondary" className="font-mono text-xs">
              {selectedRows.length} selecionado(s)
            </Badge>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1.5">
              <FileSpreadsheet className="size-3.5" />
              Exportar Seleção
            </Button>
            <Button size="sm" variant="destructive" className="h-7 text-xs gap-1.5">
              <Trash2 className="size-3.5" />
              Excluir
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => table.toggleAllRowsSelected(false)}
              className="h-7 text-xs text-muted-foreground"
            >
              Desmarcar
            </Button>
          </div>
        )
      }}
      onRowClick={(item) => {
        console.log("Linha clicada:", item)
      }}
    />
  )
}

export const Default: Story = {
  render: () => <DefaultStory />,
}

export const LoadingState: Story = {
  render: () => (
    <DataTable
      title="Carregando Registros"
      description="Aguarde enquanto os lançamentos são sincronizados..."
      columns={columns}
      data={[]}
      isLoading={true}
      skeletonRows={6}
    />
  ),
}

export const EmptyState: Story = {
  render: () => (
    <DataTable
      title="Auditoria de Processos"
      description="Histórico de conciliação fiscal e aprovações"
      columns={columns}
      data={[]}
      emptyTitle="Nenhum lançamento no período"
      emptyDescription="Não foram identificadas transações para os filtros ou data selecionados."
    />
  ),
}
