import { useState } from "react"
import {
  ArrowDownCircle,
  ArrowUpCircle,
  DollarSign,
  AlertCircle,
  CheckCircle2,
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
import type { CashMovementType, CashMovementRecord } from "./pdv-types"
import { toast } from "sonner"

interface PDVCashMovementModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialType?: CashMovementType
  currentDrawerCash: number
  operatorName: string
  onConfirmMovement: (record: CashMovementRecord) => void
}

export function PDVCashMovementModal({
  open,
  onOpenChange,
  initialType = "sangria",
  currentDrawerCash,
  operatorName,
  onConfirmMovement,
}: PDVCashMovementModalProps) {
  const [movementType, setMovementType] = useState<CashMovementType>(initialType)
  const [amount, setAmount] = useState<string>("")
  const [reason, setReason] = useState<string>("")

  const formatBRL = (val: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(val)
  }

  const numericAmount = parseFloat(amount.replace(",", ".")) || 0

  const projectedDrawerCash =
    movementType === "sangria"
      ? currentDrawerCash - numericAmount
      : currentDrawerCash + numericAmount

  const isInvalidSangria =
    movementType === "sangria" && numericAmount > currentDrawerCash

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (numericAmount <= 0) {
      toast.error("Informe um valor válido maior que zero.")
      return
    }

    if (isInvalidSangria) {
      toast.error("O valor da sangria não pode ser maior que o saldo em gaveta.")
      return
    }

    if (!reason.trim()) {
      toast.error("Por favor, preencha o motivo/justificativa da operação.")
      return
    }

    const record: CashMovementRecord = {
      id: `mov-${Date.now()}`,
      type: movementType,
      amount: numericAmount,
      reason: reason.trim(),
      operator: operatorName,
      timestamp: new Date().toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      }),
    }

    onConfirmMovement(record)
    toast.success(
      `${movementType === "sangria" ? "Sangria" : "Suprimento"} de ${formatBRL(
        numericAmount
      )} registrada e comprovante emitido!`
    )
    onOpenChange(false)
    setAmount("")
    setReason("")
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full sm:max-w-[460px] max-h-[92vh] overflow-y-auto overscroll-contain p-5 sm:p-6">
        <DialogHeader className="text-left space-y-1">
          <div className="flex items-center gap-2">
            <div
              className={`flex h-9 w-9 items-center justify-center rounded-xl ${
                movementType === "sangria"
                  ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                  : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              }`}
            >
              {movementType === "sangria" ? (
                <ArrowUpCircle className="h-5 w-5" />
              ) : (
                <ArrowDownCircle className="h-5 w-5" />
              )}
            </div>
            <div>
              <DialogTitle className="text-base font-bold">
                {movementType === "sangria"
                  ? "Sangria de Caixa (Retirada)"
                  : "Suprimento de Caixa (Entrada)"}
              </DialogTitle>
              <DialogDescription className="text-xs">
                Controle de movimentações de dinheiro físico na gaveta
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Alternador de Tipo */}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <button
            type="button"
            onClick={() => setMovementType("sangria")}
            className={`p-3 rounded-xl border text-left transition-all ${
              movementType === "sangria"
                ? "border-amber-500 bg-amber-500/10 text-amber-700 dark:text-amber-400 font-bold shadow-xs"
                : "border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            <ArrowUpCircle className="h-4 w-4 mb-1 text-amber-600" />
            <span className="text-xs font-bold block">Sangria (Retirada)</span>
            <span className="text-[10px] text-muted-foreground">Envio para o cofre</span>
          </button>

          <button
            type="button"
            onClick={() => setMovementType("suprimento")}
            className={`p-3 rounded-xl border text-left transition-all ${
              movementType === "suprimento"
                ? "border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-bold shadow-xs"
                : "border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            <ArrowDownCircle className="h-4 w-4 mb-1 text-emerald-600" />
            <span className="text-xs font-bold block">Suprimento (Entrada)</span>
            <span className="text-[10px] text-muted-foreground">Adicionar troco</span>
          </button>
        </div>

        {/* Resumo de Saldos */}
        <div className="rounded-xl border border-border/80 bg-muted/40 p-3.5 space-y-1.5 text-xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span>Saldo Atual em Gaveta:</span>
            <span className="font-mono font-bold text-foreground">
              {formatBRL(currentDrawerCash)}
            </span>
          </div>

          <div className="flex items-center justify-between font-semibold">
            <span>Saldo Projetado Após Operação:</span>
            <span
              className={`font-mono tabular-nums font-bold ${
                isInvalidSangria ? "text-destructive" : "text-foreground"
              }`}
            >
              {formatBRL(Math.max(0, projectedDrawerCash))}
            </span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground block">
              Valor da Operação (R$):
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
            {isInvalidSangria && (
              <p className="text-xs text-destructive flex items-center gap-1 font-medium">
                <AlertCircle className="h-3.5 w-3.5" />
                Valor da sangria excede o montante físico disponível na gaveta.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground block">
              Motivo / Justificativa:
            </label>
            <textarea
              placeholder={
                movementType === "sangria"
                  ? "Ex: Retirada de excesso de numerário para o cofre central."
                  : "Ex: Reforço de troco em moedas de R$ 0,50 e notas de R$ 5,00."
              }
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="flex w-full rounded-md border border-border/80 bg-background px-3 py-2 text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none h-20"
              required
            />
          </div>

          <DialogFooter className="border-t border-border/60 pt-3 flex items-center justify-between">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="text-xs font-semibold"
            >
              Cancelar
            </Button>

            <Button
              type="submit"
              disabled={numericAmount <= 0 || isInvalidSangria || !reason.trim()}
              className={`text-xs font-bold gap-1.5 ${
                movementType === "sangria"
                  ? "bg-amber-600 hover:bg-amber-700 text-white"
                  : "bg-emerald-600 hover:bg-emerald-700 text-white"
              }`}
            >
              <CheckCircle2 className="h-4 w-4" />
              <span>Confirmar {movementType === "sangria" ? "Sangria" : "Suprimento"}</span>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
