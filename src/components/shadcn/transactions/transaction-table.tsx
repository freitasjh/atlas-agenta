"use client"

import { useMemo, useState } from "react"
import {
  ArrowDownRight,
  ArrowUpRight,
  ArrowLeftRight,
  CheckCircle2,
  Download,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
  Eye,
} from "lucide-react"

import { Badge } from "@/components/shadcn/ui/badge"
import { Button } from "@/components/shadcn/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/shadcn/ui/dropdown-menu"
import { Input } from "@/components/shadcn/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/shadcn/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/shadcn/ui/table"
import {
  type Transaction,
  type TransactionStatus,
  formatCurrencyBRL,
  formatDateBR,
  PAYMENT_METHOD_LABELS,
} from "./transaction-types"

interface TransactionTableProps {
  transactions: Transaction[]
  onNewTransaction: () => void
  onSelectTransaction: (transaction: Transaction) => void
  onEditTransaction: (transaction: Transaction) => void
  onDeleteTransaction: (id: string) => void
  onToggleStatus: (id: string, newStatus: TransactionStatus) => void
}

export function TransactionTable({
  transactions,
  onNewTransaction,
  onSelectTransaction,
  onEditTransaction,
  onDeleteTransaction,
  onToggleStatus,
}: TransactionTableProps) {
  const [search, setSearch] = useState("")
  const [typeFilter, setTypeFilter] = useState<string>("all")
  const [statusFilter, setStatusFilter] = useState<string>("all")

  // Filtra transações
  const filtered = useMemo(() => {
    return transactions.filter((tx) => {
      // Filtro de busca textual
      if (search.trim()) {
        const query = search.toLowerCase()
        const matchesDesc = tx.description.toLowerCase().includes(query)
        const matchesContact = tx.contactName?.toLowerCase().includes(query)
        const matchesCategory = tx.category.toLowerCase().includes(query)
        const matchesDoc = tx.documentNumber?.toLowerCase().includes(query)
        if (!matchesDesc && !matchesContact && !matchesCategory && !matchesDoc) {
          return false
        }
      }

      // Filtro de tipo
      if (typeFilter !== "all" && tx.type !== typeFilter) {
        return false
      }

      // Filtro de status
      if (statusFilter !== "all" && tx.status !== statusFilter) {
        return false
      }

      return true
    })
  }, [transactions, search, typeFilter, statusFilter])

  // Exportar CSV simples
  function handleExportCSV() {
    const headers = [
      "ID",
      "Tipo",
      "Descricao",
      "Valor",
      "Categoria",
      "Conta",
      "MeioPagamento",
      "Status",
      "Data",
      "Contato",
    ]
    const rows = filtered.map((t) => [
      t.id,
      t.type,
      `"${t.description.replace(/"/g, '""')}"`,
      t.amount,
      `"${t.category}"`,
      `"${t.account}"`,
      t.paymentMethod,
      t.status,
      t.date,
      `"${t.contactName ?? ""}"`,
    ])

    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers.join(";"), ...rows.map((e) => e.join(";"))].join("\n")

    const encodedUri = encodeURI(csvContent)
    const link = document.createElement("a")
    link.setAttribute("href", encodedUri)
    link.setAttribute("download", `transacoes_${new Date().toISOString().slice(0, 10)}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const hasActiveFilters =
    search.trim() !== "" || typeFilter !== "all" || statusFilter !== "all"

  return (
    <div className="flex flex-col gap-4 px-4 lg:px-6">
      {/* Barra de Filtros e Ações */}
      <search
        aria-label="Buscar e filtrar transações"
        className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="flex flex-1 flex-wrap items-center gap-2">
          {/* Busca */}
          <div className="relative w-full sm:w-auto sm:min-w-[200px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              aria-label="Buscar por descrição, contato ou categoria"
              placeholder="Buscar por descrição, contato..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 text-xs h-9"
            />
            {search && (
              <button
                type="button"
                aria-label="Limpar termo de busca"
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          {/* Filtro por Tipo */}
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[140px] text-xs">
              <SelectValue placeholder="Tipo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os tipos</SelectItem>
              <SelectItem value="income">Receitas</SelectItem>
              <SelectItem value="expense">Despesas</SelectItem>
              <SelectItem value="transfer">Transferências</SelectItem>
            </SelectContent>
          </Select>

          {/* Filtro por Status */}
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[140px] text-xs">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os status</SelectItem>
              <SelectItem value="completed">Concluídas</SelectItem>
              <SelectItem value="pending">Pendentes</SelectItem>
              <SelectItem value="cancelled">Canceladas</SelectItem>
            </SelectContent>
          </Select>

          {/* Limpar Filtros */}
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch("")
                setTypeFilter("all")
                setStatusFilter("all")
              }}
              className="h-8 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
              Limpar
            </Button>
          )}
        </div>

        {/* Botões de Ação Principais */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCSV}
            className="h-8 gap-1.5 text-xs"
            title="Exportar registros filtrados para CSV"
          >
            <Download className="size-3.5" />
            <span className="hidden sm:inline">Exportar</span>
          </Button>

          <Button
            size="sm"
            onClick={onNewTransaction}
            className="h-8 gap-1.5 text-xs font-semibold"
          >
            <Plus className="size-3.5" />
            Nova Transação
          </Button>
        </div>
      </search>

      {/* Tabela de Transações */}
      <div className="overflow-hidden rounded-xl border border-border/70 bg-card shadow-xs">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[48px]"></TableHead>
              <TableHead className="min-w-[150px] sm:min-w-[200px]">Descrição / Contato</TableHead>
              <TableHead className="hidden md:table-cell">Categoria</TableHead>
              <TableHead className="hidden lg:table-cell">Conta & Meio</TableHead>
              <TableHead className="w-[85px] sm:w-[110px]">Data</TableHead>
              <TableHead className="w-[95px] sm:w-[120px]">Status</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead className="w-[48px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="h-32 text-center text-sm text-muted-foreground"
                >
                  Nenhuma transação encontrada com os filtros selecionados.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((tx) => {
                const isIncome = tx.type === "income"
                const isExpense = tx.type === "expense"

                return (
                  <TableRow
                    key={tx.id}
                    className="cursor-pointer transition-colors hover:bg-muted/50"
                    onClick={() => onSelectTransaction(tx)}
                  >
                    {/* Ícone de Tipo */}
                    <TableCell className="pr-0">
                      <div
                        className={`flex size-7 items-center justify-center rounded-md ${
                          isIncome
                            ? "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400"
                            : isExpense
                              ? "bg-rose-500/10 text-rose-600 dark:bg-rose-500/15 dark:text-rose-400"
                              : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {isIncome && <ArrowUpRight className="size-4" />}
                        {isExpense && <ArrowDownRight className="size-4" />}
                        {!isIncome && !isExpense && (
                          <ArrowLeftRight className="size-3.5" />
                        )}
                      </div>
                    </TableCell>

                    {/* Descrição & Contato */}
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium text-foreground">
                          {tx.description}
                        </span>
                        {tx.contactName && (
                          <span className="text-[11px] text-muted-foreground">
                            {tx.contactName}
                          </span>
                        )}
                      </div>
                    </TableCell>

                    {/* Categoria */}
                    <TableCell className="hidden md:table-cell">
                      <Badge
                        variant="secondary"
                        className="font-normal text-[11px]"
                      >
                        {tx.category}
                      </Badge>
                    </TableCell>

                    {/* Conta e Meio */}
                    <TableCell className="hidden lg:table-cell">
                      <div className="flex flex-col text-xs text-muted-foreground">
                        <span>{tx.account}</span>
                        <span className="text-[11px] text-muted-foreground/80">
                          {PAYMENT_METHOD_LABELS[tx.paymentMethod] ??
                            tx.paymentMethod}
                        </span>
                      </div>
                    </TableCell>

                    {/* Data */}
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDateBR(tx.date)}
                    </TableCell>

                    {/* Status */}
                    <TableCell>
                      <Badge
                        variant={
                          tx.status === "completed"
                            ? "default"
                            : tx.status === "pending"
                              ? "secondary"
                              : "destructive"
                        }
                        className="text-[10px] font-medium"
                      >
                        {tx.status === "completed" && "Concluída"}
                        {tx.status === "pending" && "Pendente"}
                        {tx.status === "cancelled" && "Cancelada"}
                      </Badge>
                    </TableCell>

                    {/* Valor */}
                    <TableCell className="text-right">
                      <span
                        className={`text-sm font-semibold tracking-tight ${
                          isIncome
                            ? "text-emerald-600 dark:text-emerald-400"
                            : isExpense
                              ? "text-rose-600 dark:text-rose-400"
                              : "text-foreground"
                        }`}
                      >
                        {isIncome ? "+ " : isExpense ? "- " : ""}
                        {formatCurrencyBRL(tx.amount)}
                      </span>
                    </TableCell>

                    {/* Ações (Dropdown) */}
                    <TableCell
                      className="text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 text-muted-foreground hover:text-foreground"
                          >
                            <MoreHorizontal className="size-4" />
                            <span className="sr-only">Abrir menu</span>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          <DropdownMenuLabel className="text-xs">
                            Ações
                          </DropdownMenuLabel>
                          <DropdownMenuItem
                            onClick={() => onSelectTransaction(tx)}
                            className="gap-2 text-xs"
                          >
                            <Eye className="size-3.5 text-muted-foreground" />
                            Ver Detalhes
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => onEditTransaction(tx)}
                            className="gap-2 text-xs"
                          >
                            <Pencil className="size-3.5 text-muted-foreground" />
                            Editar
                          </DropdownMenuItem>

                          {tx.status === "pending" && (
                            <DropdownMenuItem
                              onClick={() => onToggleStatus(tx.id, "completed")}
                              className="gap-2 text-xs text-emerald-600 dark:text-emerald-400"
                            >
                              <CheckCircle2 className="size-3.5" />
                              Marcar como Paga
                            </DropdownMenuItem>
                          )}

                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => onDeleteTransaction(tx.id)}
                            className="gap-2 text-xs text-rose-600 dark:text-rose-400"
                          >
                            <Trash2 className="size-3.5" />
                            Excluir
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>

        {/* Rodapé com Contador */}
        <div className="flex items-center justify-between border-t border-border/70 px-4 py-2.5 text-xs text-muted-foreground">
          <span>
            Mostrando <strong>{filtered.length}</strong> de{" "}
            <strong>{transactions.length}</strong> transações
          </span>
          <span className="text-[11px]">
            Clique em uma linha para ver o comprovante completo.
          </span>
        </div>
      </div>
    </div>
  )
}
