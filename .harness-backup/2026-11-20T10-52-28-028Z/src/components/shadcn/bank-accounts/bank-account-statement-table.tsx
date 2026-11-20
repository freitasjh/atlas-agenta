import { useState } from "react"
import {
  Search,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  Download,
  Paperclip,
  Check,
} from "lucide-react"
import { Input } from "@/components/shadcn/ui/input"
import { Button } from "@/components/shadcn/ui/button"
import { Badge } from "@/components/shadcn/ui/badge"
import { PillToggle } from "@/components/shadcn/ui/pill-toggle"
import { MonthYearPicker } from "@/components/shadcn/ui/month-year-picker"
import type {
  BankStatementTransaction,
  BankAccount,
  ReconciliationStatus,
} from "./bank-accounts-types"
import { toast } from "sonner"

interface BankAccountStatementTableProps {
  account: BankAccount | null
  transactions: BankStatementTransaction[]
  onReconcileTransaction?: (txId: string) => void
  onExportStatement?: (format: "csv" | "pdf" | "ofx") => void
}

export function BankAccountStatementTable({
  account,
  transactions,
  onReconcileTransaction,
  onExportStatement,
}: BankAccountStatementTableProps) {
  const [searchTerm, setSearchTerm] = useState("")
  const [statusFilter, setStatusFilter] = useState<"all" | ReconciliationStatus>("all")
  const [typeFilter, setTypeFilter] = useState<"all" | "in" | "out">("all")

  const formatBRL = (val: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(val)
  }

  // Filtragem de transações
  const filtered = transactions.filter((tx) => {
    if (account && tx.accountId !== account.id) {
      return false
    }

    if (statusFilter !== "all" && tx.reconciliationStatus !== statusFilter) {
      return false
    }

    if (typeFilter === "in" && (tx.type !== "credit" && tx.type !== "transfer_in")) {
      return false
    }
    if (typeFilter === "out" && (tx.type !== "debit" && tx.type !== "transfer_out")) {
      return false
    }

    const term = searchTerm.toLowerCase().trim()
    if (!term) return true

    return (
      tx.description.toLowerCase().includes(term) ||
      tx.category.toLowerCase().includes(term) ||
      (tx.counterparty && tx.counterparty.toLowerCase().includes(term)) ||
      (tx.documentNumber && tx.documentNumber.toLowerCase().includes(term))
    )
  })

  const reconciliationBadge = (status: ReconciliationStatus) => {
    switch (status) {
      case "reconciled":
        return (
          <Badge
            variant="outline"
            className="border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[10px] font-semibold gap-1"
          >
            <CheckCircle2 className="h-3 w-3" />
            Conciliado
          </Badge>
        )
      case "pending":
        return (
          <Badge
            variant="outline"
            className="border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] font-semibold gap-1"
          >
            <Clock className="h-3 w-3" />
            Pendente
          </Badge>
        )
      case "divergent":
        return (
          <Badge
            variant="outline"
            className="border-destructive/40 bg-destructive/10 text-destructive text-[10px] font-semibold gap-1"
          >
            <AlertTriangle className="h-3 w-3" />
            Divergente
          </Badge>
        )
    }
  }

  const transactionIcon = (type: BankStatementTransaction["type"]) => {
    switch (type) {
      case "credit":
        return (
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 shrink-0">
            <ArrowDownLeft className="h-4 w-4" />
          </div>
        )
      case "debit":
        return (
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted text-muted-foreground shrink-0">
            <ArrowUpRight className="h-4 w-4" />
          </div>
        )
      case "transfer_in":
      case "transfer_out":
        return (
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
            <ArrowLeftRight className="h-4 w-4" />
          </div>
        )
    }
  }

  const handleReconcile = (txId: string) => {
    onReconcileTransaction?.(txId)
    toast.success("Lançamento conciliado com a fatura do sistema!")
  }

  return (
    <div className="rounded-2xl border border-border/80 bg-card text-card-foreground shadow-xs overflow-hidden">
      {/* Cabeçalho do Extrato */}
      <div className="p-4 sm:p-5 border-b border-border/70 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-muted/20">
        <div>
          <h2 className="text-base font-bold text-foreground">
            {account ? `Extrato • ${account.nickname}` : "Extrato Consolidado de Todas as Contas"}
          </h2>
          <p className="text-xs text-muted-foreground">
            Movimentações bancárias conciliadas e pendentes de conferência
          </p>
        </div>

        {/* Filtro Mês/Ano + Botões de Exportação */}
        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <MonthYearPicker
            defaultValue="2026-11"
            size="sm"
            onChange={(val) => toast.info(`Filtrando extrato para ${val.label}`)}
          />

          <div className="h-6 w-px bg-border/70 hidden sm:block" />

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onExportStatement?.("csv")}
            className="h-8 text-xs font-semibold gap-1"
          >
            <Download className="h-3 w-3" />
            <span>CSV</span>
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onExportStatement?.("ofx")}
            className="h-8 text-xs font-semibold gap-1"
          >
            <Download className="h-3 w-3" />
            <span>OFX</span>
          </Button>
        </div>
      </div>

      {/* Barra de Filtros e Busca */}
      <div className="p-4 border-b border-border/60 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-72">
          <Search className="absolute inset-y-0 left-3 my-auto h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Buscar por descrição, documento..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-9 h-9 text-xs bg-background border-border/80"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
          {/* Filtro de Tipo */}
          <PillToggle
            value={typeFilter}
            onChange={(val) => setTypeFilter(val as "all" | "in" | "out")}
            size="sm"
            aria-label="Filtro de tipo de transação"
            options={[
              { value: "all", label: "Todos" },
              {
                value: "in",
                label: "Entradas",
                activeClassName: "text-emerald-600 dark:text-emerald-400 font-bold",
              },
              {
                value: "out",
                label: "Saídas",
              },
            ]}
          />

          {/* Filtro de Conciliação */}
          <PillToggle
            value={statusFilter}
            onChange={(val) => setStatusFilter(val as "all" | ReconciliationStatus)}
            size="sm"
            aria-label="Filtro de status de conciliação"
            options={[
              { value: "all", label: "Status: Todos" },
              {
                value: "reconciled",
                label: "Conciliados",
                activeClassName: "text-emerald-600 dark:text-emerald-400 font-bold",
              },
              {
                value: "pending",
                label: "Pendentes",
                activeClassName: "text-amber-600 dark:text-amber-400 font-bold",
              },
            ]}
          />
        </div>
      </div>

      {/* Tabela de Lançamentos */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-border/70 bg-muted/30 text-muted-foreground font-semibold">
            <tr>
              <th className="py-3 px-4">Data</th>
              <th className="py-3 px-4">Descrição & Categoria</th>
              <th className="py-3 px-4 hidden md:table-cell">Contraparte</th>
              <th className="py-3 px-4 hidden sm:table-cell">Documento</th>
              <th className="py-3 px-4 text-right">Valor</th>
              <th className="py-3 px-4 text-center">Status</th>
              <th className="py-3 px-4 text-right">Ação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-muted-foreground">
                  Nenhuma movimentação bancária encontrada para os filtros selecionados.
                </td>
              </tr>
            ) : (
              filtered.map((tx) => {
                const isCredit = tx.type === "credit" || tx.type === "transfer_in"
                return (
                  <tr key={tx.id} className="hover:bg-muted/30 transition-colors">
                    {/* Data */}
                    <td className="py-3 px-4 font-mono text-muted-foreground whitespace-nowrap">
                      {tx.date}
                    </td>

                    {/* Descrição & Categoria */}
                    <td className="py-3 px-4 min-w-[200px]">
                      <div className="flex items-center gap-2.5">
                        {transactionIcon(tx.type)}
                        <div className="min-w-0">
                          <p className="font-bold text-foreground truncate">
                            {tx.description}
                          </p>
                          <span className="text-[10px] text-muted-foreground block truncate">
                            {tx.category}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Contraparte */}
                    <td className="py-3 px-4 hidden md:table-cell text-muted-foreground truncate max-w-[160px]">
                      {tx.counterparty || "---"}
                    </td>

                    {/* Documento */}
                    <td className="py-3 px-4 hidden sm:table-cell font-mono text-[11px] text-muted-foreground">
                      <div className="flex items-center gap-1">
                        {tx.hasAttachment && (
                          <span title="Possui comprovante anexado">
                            <Paperclip className="h-3 w-3 text-primary shrink-0" />
                          </span>
                        )}
                        <span>{tx.documentNumber || "---"}</span>
                      </div>
                    </td>

                    {/* Valor */}
                    <td className="py-3 px-4 font-mono font-extrabold text-right tabular-nums whitespace-nowrap">
                      <span
                        className={
                          isCredit
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-foreground"
                        }
                      >
                        {isCredit ? `+ ${formatBRL(tx.amount)}` : formatBRL(tx.amount)}
                      </span>
                    </td>

                    {/* Status de Conciliação */}
                    <td className="py-3 px-4 text-center whitespace-nowrap">
                      {reconciliationBadge(tx.reconciliationStatus)}
                    </td>

                    {/* Ação */}
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      {tx.reconciliationStatus === "pending" ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handleReconcile(tx.id)}
                          className="h-7 text-[11px] font-semibold gap-1 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-500/10 border-emerald-500/30"
                        >
                          <Check className="h-3 w-3" />
                          <span>Conciliar</span>
                        </Button>
                      ) : (
                        <span className="text-[11px] text-muted-foreground font-mono">
                          OK
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
