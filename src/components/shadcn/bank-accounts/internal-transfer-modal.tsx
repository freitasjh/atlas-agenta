import { useState } from "react"
import {
  ArrowLeftRight,
  DollarSign,
  Calendar,
  CheckCircle2,
  AlertCircle,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/shadcn/ui/dialog"
import { Button } from "@/components/shadcn/ui/button"
import { Input } from "@/components/shadcn/ui/input"
import type { BankAccount } from "./bank-accounts-types"
import { toast } from "sonner"

interface InternalTransferModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  accounts: BankAccount[]
  initialSourceAccountId?: string
  onExecuteTransfer: (
    sourceAccountId: string,
    targetAccountId: string,
    amount: number,
    description: string
  ) => void
}

export function InternalTransferModal({
  open,
  onOpenChange,
  accounts,
  initialSourceAccountId,
  onExecuteTransfer,
}: InternalTransferModalProps) {
  const [sourceId, setSourceId] = useState(
    initialSourceAccountId || accounts[0]?.id || ""
  )
  const [targetId, setTargetId] = useState(
    accounts.find((a) => a.id !== sourceId)?.id || ""
  )
  const [amount, setAmount] = useState("")
  const [date, setDate] = useState(new Date().toISOString().split("T")[0])
  const [description, setDescription] = useState("Transferência interna entre contas")

  const formatBRL = (val: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(val)
  }

  const sourceAccount = accounts.find((a) => a.id === sourceId)
  const targetAccount = accounts.find((a) => a.id === targetId)

  const numAmount = parseFloat(amount.replace(",", ".")) || 0
  const isInsufficient = sourceAccount ? numAmount > sourceAccount.currentBalance : false

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!sourceId || !targetId || sourceId === targetId) {
      toast.error("Selecione contas de origem e destino diferentes.")
      return
    }

    if (numAmount <= 0) {
      toast.error("Informe um valor válido maior que zero.")
      return
    }

    if (isInsufficient) {
      toast.error("Saldo insuficiente na conta de origem.")
      return
    }

    onExecuteTransfer(sourceId, targetId, numAmount, description)
    toast.success(
      `Transferência de ${formatBRL(numAmount)} entre contas realizada com sucesso!`
    )
    onOpenChange(false)
    setAmount("")
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full sm:max-w-[480px] max-h-[92vh] overflow-y-auto overscroll-contain p-5 sm:p-6">
        <DialogHeader className="text-left space-y-1">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <ArrowLeftRight className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold">
                Transferência Entre Contas
              </DialogTitle>
              <DialogDescription className="text-xs">
                Movimente recursos internos sem alterar o resultado operacional líquido
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          {/* Conta de Origem */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <label className="font-semibold text-foreground">
                Conta de Origem (Saída):
              </label>
              {sourceAccount && (
                <span className="text-[11px] text-muted-foreground font-mono">
                  Saldo: {formatBRL(sourceAccount.currentBalance)}
                </span>
              )}
            </div>
            <select
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value)}
              className="flex w-full h-10 rounded-md border border-border/80 bg-background px-3 py-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id} disabled={acc.id === targetId}>
                  {acc.nickname} • Saldo: {formatBRL(acc.currentBalance)}
                </option>
              ))}
            </select>
          </div>

          {/* Conta de Destino */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <label className="font-semibold text-foreground">
                Conta de Destino (Entrada):
              </label>
              {targetAccount && (
                <span className="text-[11px] text-muted-foreground font-mono">
                  Saldo Atual: {formatBRL(targetAccount.currentBalance)}
                </span>
              )}
            </div>
            <select
              value={targetId}
              onChange={(e) => setTargetId(e.target.value)}
              className="flex w-full h-10 rounded-md border border-border/80 bg-background px-3 py-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              {accounts.map((acc) => (
                <option key={acc.id} value={acc.id} disabled={acc.id === sourceId}>
                  {acc.nickname} • Saldo: {formatBRL(acc.currentBalance)}
                </option>
              ))}
            </select>
          </div>

          {/* Valor */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground block">
              Valor da Transferência (R$):
            </label>
            <div className="relative">
              <DollarSign className="absolute inset-y-0 left-3 my-auto h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="0,00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="pl-9 h-11 text-base font-mono font-bold bg-background border-border/80"
                autoFocus
              />
            </div>
            {isInsufficient && (
              <p className="text-xs text-destructive flex items-center gap-1 font-medium">
                <AlertCircle className="h-3.5 w-3.5" />
                Valor excede o saldo disponível na conta de origem.
              </p>
            )}
          </div>

          {/* Data e Descrição */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground block">
                Data:
              </label>
              <div className="relative">
                <Calendar className="absolute inset-y-0 left-3 my-auto h-4 w-4 text-muted-foreground" />
                <Input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="pl-9 h-10 text-xs bg-background border-border/80"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground block">
                Identificador / Motivo:
              </label>
              <Input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Ex: Aporte para folha"
                className="h-10 text-xs bg-background border-border/80"
              />
            </div>
          </div>

          <DialogFooter className="border-t border-border/60 pt-3 flex items-center justify-between">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="text-xs"
            >
              Cancelar
            </Button>

            <Button
              type="submit"
              disabled={numAmount <= 0 || isInsufficient || sourceId === targetId}
              className="text-xs font-bold gap-1.5 bg-primary text-primary-foreground"
            >
              <CheckCircle2 className="h-4 w-4" />
              <span>Confirmar Transferência</span>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

