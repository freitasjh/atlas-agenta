"use client"

import {
  ArrowDownRight,
  ArrowUpRight,
  ArrowLeftRight,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  CreditCard,
  FileText,
  Pencil,
  Trash2,
  User,
  XCircle,
} from "lucide-react"

import { Badge } from "@/components/shadcn/ui/badge"
import { Button } from "@/components/shadcn/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/shadcn/ui/dialog"
import { Separator } from "@/components/shadcn/ui/separator"
import {
  type Transaction,
  formatCurrencyBRL,
  formatDateBR,
  PAYMENT_METHOD_LABELS,
} from "./transaction-types"

interface TransactionDetailDialogProps {
  transaction: Transaction | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onEdit: (transaction: Transaction) => void
  onDelete: (id: string) => void
}

export function TransactionDetailDialog({
  transaction,
  open,
  onOpenChange,
  onEdit,
  onDelete,
}: TransactionDetailDialogProps) {
  if (!transaction) return null

  const isIncome = transaction.type === "income"
  const isExpense = transaction.type === "expense"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center justify-between pr-6">
            <Badge
              variant={
                transaction.status === "completed"
                  ? "default"
                  : transaction.status === "pending"
                    ? "secondary"
                    : "destructive"
              }
              className="gap-1 px-2.5 py-0.5 text-xs font-semibold"
            >
              {transaction.status === "completed" && (
                <CheckCircle2 className="size-3 text-emerald-500" />
              )}
              {transaction.status === "pending" && (
                <Clock className="size-3 text-amber-500" />
              )}
              {transaction.status === "cancelled" && (
                <XCircle className="size-3 text-rose-500" />
              )}
              {transaction.status === "completed"
                ? "Concluída"
                : transaction.status === "pending"
                  ? "Pendente"
                  : "Cancelada"}
            </Badge>

            <span className="text-xs text-muted-foreground">
              ID: {transaction.id}
            </span>
          </div>

          {/* Valor Principal com destaque */}
          <div className="mt-4 flex flex-col items-center justify-center rounded-xl bg-muted/50 py-5">
            <div
              className={`flex items-center gap-1.5 text-3xl font-extrabold tracking-tight ${
                isIncome
                  ? "text-emerald-600 dark:text-emerald-400"
                  : isExpense
                    ? "text-rose-600 dark:text-rose-400"
                    : "text-foreground"
              }`}
            >
              {isIncome && <ArrowUpRight className="size-6" />}
              {isExpense && <ArrowDownRight className="size-6" />}
              {!isIncome && !isExpense && <ArrowLeftRight className="size-6" />}
              {formatCurrencyBRL(transaction.amount)}
            </div>
            <DialogTitle className="mt-2 text-center text-sm font-medium text-foreground">
              {transaction.description}
            </DialogTitle>
            <DialogDescription className="text-center text-xs text-muted-foreground">
              Categoria: {transaction.category}
            </DialogDescription>
          </div>
        </DialogHeader>

        {/* Informações detalhadas */}
        <div className="flex flex-col gap-3 py-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Building2 className="size-3.5" />
              Conta / Caixa
            </span>
            <span className="font-medium text-foreground">
              {transaction.account}
            </span>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <CreditCard className="size-3.5" />
              Meio de Pagamento
            </span>
            <span className="font-medium text-foreground">
              {PAYMENT_METHOD_LABELS[transaction.paymentMethod] ??
                transaction.paymentMethod}
            </span>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Calendar className="size-3.5" />
              Data de Competência
            </span>
            <span className="font-medium text-foreground">
              {formatDateBR(transaction.date)}
            </span>
          </div>

          {transaction.dueDate && (
            <>
              <Separator />
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Clock className="size-3.5" />
                  Data de Vencimento
                </span>
                <span className="font-medium text-foreground">
                  {formatDateBR(transaction.dueDate)}
                </span>
              </div>
            </>
          )}

          {transaction.contactName && (
            <>
              <Separator />
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <User className="size-3.5" />
                  {isIncome ? "Cliente / Pagador" : "Favorecido"}
                </span>
                <span className="font-medium text-foreground">
                  {transaction.contactName}
                </span>
              </div>
            </>
          )}

          {transaction.documentNumber && (
            <>
              <Separator />
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <FileText className="size-3.5" />
                  Nº Documento / NF
                </span>
                <span className="font-mono text-xs font-medium text-foreground">
                  {transaction.documentNumber}
                </span>
              </div>
            </>
          )}

          {transaction.notes && (
            <>
              <Separator />
              <div className="flex flex-col gap-1 rounded-md bg-muted/40 p-2.5">
                <span className="text-[11px] font-semibold text-muted-foreground">
                  Observações:
                </span>
                <p className="text-foreground">{transaction.notes}</p>
              </div>
            </>
          )}
        </div>

        <DialogFooter className="mt-2 flex sm:justify-between">
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => {
              onDelete(transaction.id)
              onOpenChange(false)
            }}
            className="gap-1.5"
          >
            <Trash2 className="size-3.5" />
            Excluir
          </Button>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Fechar
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                onEdit(transaction)
                onOpenChange(false)
              }}
              className="gap-1.5"
            >
              <Pencil className="size-3.5" />
              Editar
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

