import { useState } from "react"
import {
  Lock,
  DollarSign,
  CreditCard,
  QrCode,
  CheckCircle2,
  Printer,
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
import type { RegisterStatus } from "./pdv-types"
import { toast } from "sonner"

interface PDVCloseRegisterModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  status: RegisterStatus
  totalSalesCash: number
  totalSalesCard: number
  totalSalesPix: number
  onConfirmClose: () => void
}

export function PDVCloseRegisterModal({
  open,
  onOpenChange,
  status,
  totalSalesCash,
  totalSalesCard,
  totalSalesPix,
  onConfirmClose,
}: PDVCloseRegisterModalProps) {
  const [countedCash, setCountedCash] = useState<string>("")
  const [countedCard, setCountedCard] = useState<string>("")
  const [countedPix, setCountedPix] = useState<string>("")
  const [isAudited, setIsAudited] = useState<boolean>(false)

  const formatBRL = (val: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(val)
  }

  const numCountedCash = parseFloat(countedCash.replace(",", ".")) || 0
  const numCountedCard = parseFloat(countedCard.replace(",", ".")) || 0
  const numCountedPix = parseFloat(countedPix.replace(",", ".")) || 0

  const expectedCash = status.currentCashInDrawer
  const cashDifference = numCountedCash - expectedCash

  const handleAudit = () => {
    setIsAudited(true)
  }

  const handleFinalClose = () => {
    onConfirmClose()
    toast.success("Turno encerrado e relatório de fechamento de caixa impresso!")
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full sm:max-w-[500px] max-h-[92vh] overflow-y-auto overscroll-contain p-5 sm:p-6">
        <DialogHeader className="text-left space-y-1">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
              <Lock className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold">
                Fechamento de Caixa • {status.registerNumber}
              </DialogTitle>
              <DialogDescription className="text-xs">
                Conferência cega de valores e encerramento de turno
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Dados do Turno */}
        <div className="rounded-xl border border-border/80 bg-muted/30 p-3.5 space-y-1.5 text-xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span>Operador:</span>
            <strong className="text-foreground">{status.operatorName}</strong>
          </div>
          <div className="flex items-center justify-between text-muted-foreground">
            <span>Abertura do Caixa:</span>
            <span className="font-mono">{status.openedAt}</span>
          </div>
          <div className="flex items-center justify-between text-muted-foreground">
            <span>Fundo Inicial de Troco:</span>
            <span className="font-mono">{formatBRL(status.initialCash)}</span>
          </div>
          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border/60 text-center">
            <div className="rounded-lg bg-background p-1.5">
              <span className="text-[10px] text-muted-foreground block">Vendas Dinheiro</span>
              <span className="font-mono font-bold text-foreground text-xs">{formatBRL(totalSalesCash)}</span>
            </div>
            <div className="rounded-lg bg-background p-1.5">
              <span className="text-[10px] text-muted-foreground block">Vendas Cartão</span>
              <span className="font-mono font-bold text-foreground text-xs">{formatBRL(totalSalesCard)}</span>
            </div>
            <div className="rounded-lg bg-background p-1.5">
              <span className="text-[10px] text-muted-foreground block">Vendas Pix</span>
              <span className="font-mono font-bold text-foreground text-xs">{formatBRL(totalSalesPix)}</span>
            </div>
          </div>
        </div>

        {/* Formulário de Contagem Cega */}
        <div className="space-y-3">
          <span className="text-xs font-semibold text-foreground block">
            Informe os valores contados fisicamente na gaveta:
          </span>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs flex items-center gap-1.5 font-medium min-w-[120px]">
                <DollarSign className="h-4 w-4 text-emerald-600" /> Dinheiro Físico:
              </span>
              <Input
                type="text"
                placeholder="0,00"
                value={countedCash}
                onChange={(e) => setCountedCash(e.target.value)}
                className="h-9 font-mono text-xs text-right w-40"
              />
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-xs flex items-center gap-1.5 font-medium min-w-[120px]">
                <CreditCard className="h-4 w-4 text-amber-600" /> Cartões (Comprovantes):
              </span>
              <Input
                type="text"
                placeholder="0,00"
                value={countedCard}
                onChange={(e) => setCountedCard(e.target.value)}
                className="h-9 font-mono text-xs text-right w-40"
              />
            </div>

            <div className="flex items-center justify-between gap-2">
              <span className="text-xs flex items-center gap-1.5 font-medium min-w-[120px]">
                <QrCode className="h-4 w-4 text-primary" /> Pix (Extrato):
              </span>
              <Input
                type="text"
                placeholder="0,00"
                value={countedPix}
                onChange={(e) => setCountedPix(e.target.value)}
                className="h-9 font-mono text-xs text-right w-40"
              />
            </div>
          </div>
        </div>

        {/* Resultado da Conferência */}
        {isAudited && (
          <div className="rounded-xl border border-border/80 bg-card p-4 space-y-2 text-xs">
            <h4 className="font-bold text-foreground flex items-center gap-1.5">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              Resultado da Conciliação de Caixa
            </h4>

            <div className="space-y-1 text-muted-foreground pt-1">
              <div className="flex items-center justify-between">
                <span>Dinheiro Esperado pelo Sistema:</span>
                <span className="font-mono font-bold text-foreground">
                  {formatBRL(expectedCash)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Dinheiro Informado pelo Operador:</span>
                <span className="font-mono font-bold text-foreground">
                  {formatBRL(numCountedCash)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Cartões Informados:</span>
                <span className="font-mono font-bold text-foreground">
                  {formatBRL(numCountedCard)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Pix Informado:</span>
                <span className="font-mono font-bold text-foreground">
                  {formatBRL(numCountedPix)}
                </span>
              </div>
              <div className="flex items-center justify-between pt-1 border-t border-border/60 font-semibold">
                <span>Diferença / Quebra de Caixa:</span>
                <span
                  className={`font-mono font-extrabold ${
                    Math.abs(cashDifference) < 0.01
                      ? "text-emerald-600 dark:text-emerald-400"
                      : cashDifference > 0
                      ? "text-blue-600"
                      : "text-destructive"
                  }`}
                >
                  {cashDifference > 0 ? `+ ${formatBRL(cashDifference)} (Sobra)` : cashDifference < 0 ? `${formatBRL(cashDifference)} (Falta)` : "R$ 0,00 (Caixa Perfeito)"}
                </span>
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="border-t border-border/60 pt-3 flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="text-xs"
          >
            Voltar
          </Button>

          {!isAudited ? (
            <Button
              type="button"
              onClick={handleAudit}
              disabled={!countedCash}
              className="text-xs font-bold gap-1.5 bg-primary text-primary-foreground"
            >
              <CheckCircle2 className="h-4 w-4" />
              <span>Conferir Valores</span>
            </Button>
          ) : (
            <Button
              type="button"
              onClick={handleFinalClose}
              className="text-xs font-bold gap-1.5 bg-destructive hover:bg-destructive/90 text-destructive-foreground"
            >
              <Printer className="h-4 w-4" />
              <span>Confirmar Fechamento & Imprimir</span>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
