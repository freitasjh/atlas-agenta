import { useState, useMemo } from "react"
import {
  Banknote,
  QrCode,
  CreditCard,
  Split,
  CheckCircle2,
  Receipt,
  ShieldCheck,
  Zap,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/shadcn/ui/tabs"
import { Input } from "@/components/shadcn/ui/input"
import { Badge } from "@/components/shadcn/ui/badge"
import type { PaymentMethodType, PaymentSplit, PDVCustomer } from "./pdv-types"
import { toast } from "sonner"

interface PDVPaymentModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  totalAmount: number
  customer: PDVCustomer | null
  onPaymentComplete: (splits: PaymentSplit[]) => void
}

const QUICK_BILLS = [10, 20, 50, 100, 200]

export function PDVPaymentModal({
  open,
  onOpenChange,
  totalAmount,
  customer,
  onPaymentComplete,
}: PDVPaymentModalProps) {
  const [activeTab, setActiveTab] = useState<PaymentMethodType | "split">("cash")

  // Estado Dinheiro
  const [cashReceived, setCashReceived] = useState<string>("")

  // Estado Cartão
  const [cardType, setCardType] = useState<"credit" | "debit">("credit")
  const [installments, setInstallments] = useState<number>(1)
  const [cardStatus, setCardStatus] = useState<"idle" | "waiting_pinpad" | "approved">("idle")

  // Estado Split (Múltiplos pagamentos)
  const [splitCash, setSplitCash] = useState<number>(0)
  const [splitPix, setSplitPix] = useState<number>(0)
  const [splitCard, setSplitCard] = useState<number>(0)

  const formatBRL = (val: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(val)
  }

  const numericCashReceived = parseFloat(cashReceived.replace(",", ".")) || 0
  const changeAmount = Math.max(0, numericCashReceived - totalAmount)
  const isCashSufficient = numericCashReceived >= totalAmount

  // Cálculos Split
  const totalSplitRegistered = splitCash + splitPix + splitCard
  const remainingSplit = Math.max(0, totalAmount - totalSplitRegistered)
  const isSplitComplete = Math.abs(remainingSplit) < 0.01

  // Parcelas para Crédito
  const installmentOptions = useMemo(() => {
    const list = []
    for (let i = 1; i <= 6; i++) {
      const val = totalAmount / i
      list.push({
        times: i,
        amount: val,
        label: `${i}x de ${formatBRL(val)} ${i === 1 ? "(à vista)" : "sem juros"}`,
      })
    }
    return list
  }, [totalAmount])

  // Finalizar Pagamento em Dinheiro
  const handleConfirmCash = () => {
    if (!isCashSufficient) {
      toast.error("Valor recebido é menor que o total a pagar.")
      return
    }

    onPaymentComplete([
      {
        method: "cash",
        amount: totalAmount,
      },
    ])
    toast.success("Venda finalizada com sucesso no Dinheiro!")
    onOpenChange(false)
  }

  // Finalizar Pagamento no Pix
  const handleConfirmPix = () => {
    onPaymentComplete([
      {
        method: "pix",
        amount: totalAmount,
      },
    ])
    toast.success("Pagamento Pix confirmado pela instituição bancária!")
    onOpenChange(false)
  }

  // Finalizar Pagamento no Cartão
  const handleConfirmCard = () => {
    setCardStatus("waiting_pinpad")
    setTimeout(() => {
      setCardStatus("approved")
      setTimeout(() => {
        onPaymentComplete([
          {
            method: cardType === "credit" ? "credit_card" : "debit_card",
            amount: totalAmount,
            installments: cardType === "credit" ? installments : 1,
            cardBrand: "Mastercard",
          },
        ])
        toast.success(`Transação TEF ${cardType === "credit" ? "Crédito" : "Débito"} aprovada!`)
        onOpenChange(false)
        setCardStatus("idle")
      }, 700)
    }, 1200)
  }

  // Finalizar Split
  const handleConfirmSplit = () => {
    if (!isSplitComplete) {
      toast.error("O valor total não foi totalmente distribuído.")
      return
    }

    const splits: PaymentSplit[] = []
    if (splitCash > 0) splits.push({ method: "cash", amount: splitCash })
    if (splitPix > 0) splits.push({ method: "pix", amount: splitPix })
    if (splitCard > 0) splits.push({ method: "credit_card", amount: splitCard })

    onPaymentComplete(splits)
    toast.success("Venda dividida finalizada com sucesso!")
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full sm:max-w-[560px] max-h-[92vh] overflow-y-auto overscroll-contain p-5 sm:p-6">
        <DialogHeader className="text-left space-y-1">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <Receipt className="h-5 w-5" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold">
                  Fechamento & Pagamento
                </DialogTitle>
                <DialogDescription className="text-xs">
                  Selecione a forma de pagamento do cliente
                </DialogDescription>
              </div>
            </div>

            {customer && (
              <Badge variant="outline" className="text-[11px] font-mono">
                CPF: {customer.cpfCnpj}
              </Badge>
            )}
          </div>
        </DialogHeader>

        {/* Resumo do Total em Destaque */}
        <div className="rounded-xl border border-border/80 bg-muted/40 p-3.5 flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Total a Cobrar
          </span>
          <span className="font-mono text-2xl font-extrabold tracking-tight text-foreground tabular-nums">
            {formatBRL(totalAmount)}
          </span>
        </div>

        {/* Abas de Métodos de Pagamento */}
        <Tabs
          value={activeTab}
          onValueChange={(val) => setActiveTab(val as PaymentMethodType | "split")}
          className="w-full"
        >
          <TabsList className="grid w-full grid-cols-4 h-10 p-1">
            <TabsTrigger value="cash" className="text-xs font-semibold gap-1">
              <Banknote className="h-3.5 w-3.5" />
              <span>Dinheiro</span>
            </TabsTrigger>
            <TabsTrigger value="pix" className="text-xs font-semibold gap-1">
              <QrCode className="h-3.5 w-3.5" />
              <span>Pix</span>
            </TabsTrigger>
            <TabsTrigger value="credit_card" className="text-xs font-semibold gap-1">
              <CreditCard className="h-3.5 w-3.5" />
              <span>Cartão</span>
            </TabsTrigger>
            <TabsTrigger value="split" className="text-xs font-semibold gap-1">
              <Split className="h-3.5 w-3.5" />
              <span>Dividir</span>
            </TabsTrigger>
          </TabsList>

          {/* ============================================================ */}
          {/* DINHEIRO & CÁLCULO DE TROCO                                  */}
          {/* ============================================================ */}
          <TabsContent value="cash" className="space-y-4 pt-3 focus-visible:outline-none">
            <div className="space-y-2">
              <label className="text-xs font-semibold text-foreground block">
                Valor Recebido do Cliente:
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-sm font-bold text-muted-foreground font-mono">
                  R$
                </span>
                <Input
                  type="text"
                  placeholder="0,00"
                  value={cashReceived}
                  onChange={(e) => setCashReceived(e.target.value)}
                  className="pl-10 h-12 text-lg font-mono font-bold bg-background border-border/80"
                  autoFocus
                />
              </div>

              {/* Botões Rápidos de Notas */}
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setCashReceived(totalAmount.toFixed(2))}
                  className="h-8 text-xs font-semibold"
                >
                  Valor Exato
                </Button>
                {QUICK_BILLS.map((bill) => (
                  <Button
                    key={bill}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setCashReceived(bill.toFixed(2))}
                    className="h-8 text-xs font-mono font-bold"
                  >
                    R$ {bill}
                  </Button>
                ))}
              </div>
            </div>

            {/* Painel do Troco */}
            <div className="rounded-xl border border-border/80 bg-card p-4 space-y-1 text-center">
              <span className="text-xs font-semibold text-muted-foreground block">
                Troco a Devolver
              </span>
              <span
                className={`font-mono text-3xl font-extrabold tabular-nums block ${
                  isCashSufficient
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-muted-foreground/60"
                }`}
              >
                {formatBRL(changeAmount)}
              </span>
              {numericCashReceived > 0 && !isCashSufficient && (
                <p className="text-xs text-destructive font-medium">
                  Faltam {formatBRL(totalAmount - numericCashReceived)}
                </p>
              )}
            </div>

            <Button
              type="button"
              disabled={!isCashSufficient}
              onClick={handleConfirmCash}
              className="w-full h-11 text-xs font-bold gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <CheckCircle2 className="h-4 w-4" />
              <span>Confirmar Pagamento em Dinheiro & Abrir Gaveta</span>
            </Button>
          </TabsContent>

          {/* ============================================================ */}
          {/* PIX DINÂMICO                                                 */}
          {/* ============================================================ */}
          <TabsContent value="pix" className="space-y-4 pt-3 focus-visible:outline-none">
            <div className="flex flex-col items-center justify-center rounded-xl border border-border/80 bg-card p-4 text-center space-y-3">
              <div className="flex h-44 w-44 items-center justify-center rounded-xl border border-border bg-white p-2.5 shadow-sm">
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(
                    `00020126580014br.gov.bcb.pix0136pdv-caixa-${totalAmount}`
                  )}`}
                  alt="QR Code Pix PDV"
                  className="h-full w-full object-contain"
                />
              </div>

              <div className="space-y-1">
                <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                  <Zap className="h-3 w-3" />
                  QR Code Pix Dinâmico • {formatBRL(totalAmount)}
                </div>
                <p className="text-xs text-muted-foreground">
                  Solicite ao cliente escanear o código com o aplicativo do banco.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  navigator.clipboard.writeText(`00020126580014br.gov.bcb.pix0136pdv-${totalAmount}`)
                  toast.success("Chave Pix Copia e Cola copiada!")
                }}
                className="flex-1 text-xs font-semibold h-10"
              >
                Copiar Chave Copia e Cola
              </Button>

              <Button
                type="button"
                onClick={handleConfirmPix}
                className="flex-1 text-xs font-bold h-10 gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                <CheckCircle2 className="h-4 w-4" />
                <span>Simular Confirmação Pix</span>
              </Button>
            </div>
          </TabsContent>

          {/* ============================================================ */}
          {/* CARTÃO TEF / PINPAD                                          */}
          {/* ============================================================ */}
          <TabsContent value="credit_card" className="space-y-4 pt-3 focus-visible:outline-none">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setCardType("credit")}
                className={`p-3 rounded-xl border text-left transition-all ${
                  cardType === "credit"
                    ? "border-primary bg-primary/10 text-primary font-bold shadow-xs"
                    : "border-border bg-card text-foreground"
                }`}
              >
                <CreditCard className="h-4 w-4 mb-1" />
                <span className="text-xs block">Crédito</span>
              </button>

              <button
                type="button"
                onClick={() => setCardType("debit")}
                className={`p-3 rounded-xl border text-left transition-all ${
                  cardType === "debit"
                    ? "border-primary bg-primary/10 text-primary font-bold shadow-xs"
                    : "border-border bg-card text-foreground"
                }`}
              >
                <CreditCard className="h-4 w-4 mb-1" />
                <span className="text-xs block">Débito</span>
              </button>
            </div>

            {cardType === "credit" && (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground block">
                  Número de Parcelas:
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                  {installmentOptions.map((opt) => (
                    <button
                      key={opt.times}
                      type="button"
                      onClick={() => setInstallments(opt.times)}
                      className={`p-2 rounded-lg border text-left text-xs transition-all ${
                        installments === opt.times
                          ? "border-primary bg-primary/10 text-primary font-bold"
                          : "border-border bg-card text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <span className="block font-bold">{opt.times}x de {formatBRL(opt.amount)}</span>
                      <span className="text-[10px] text-muted-foreground">{opt.times === 1 ? "À vista" : "Sem juros"}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-xl border border-border/80 bg-muted/30 p-4 text-center space-y-2">
              <ShieldCheck className="h-6 w-6 text-primary mx-auto" />
              <p className="text-xs font-semibold text-foreground">
                Integração TEF Ativa
              </p>
              <p className="text-[11px] text-muted-foreground">
                Ao clicar em enviar, a cobrança será enviada automaticamente para o Pinpad.
              </p>
            </div>

            <Button
              type="button"
              disabled={cardStatus === "waiting_pinpad"}
              onClick={handleConfirmCard}
              className="w-full h-11 text-xs font-bold gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {cardStatus === "waiting_pinpad" ? (
                <>
                  <CreditCard className="h-4 w-4 animate-bounce" />
                  <span>Aguardando Pinpad...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Enviar para Pinpad TEF ({cardType === "credit" ? `${installments}x Crédito` : "Débito"})</span>
                </>
              )}
            </Button>
          </TabsContent>

          {/* ============================================================ */}
          {/* DIVIDIR PAGAMENTO (SPLIT)                                    */}
          {/* ============================================================ */}
          <TabsContent value="split" className="space-y-4 pt-3 focus-visible:outline-none">
            <div className="space-y-2 text-xs">
              <p className="text-muted-foreground">
                Distribua o valor total de <strong>{formatBRL(totalAmount)}</strong> entre múltiplos métodos:
              </p>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 font-medium">
                    <Banknote className="h-3.5 w-3.5 text-emerald-600" /> Dinheiro:
                  </span>
                  <Input
                    type="number"
                    step="0.01"
                    value={splitCash || ""}
                    onChange={(e) => setSplitCash(parseFloat(e.target.value) || 0)}
                    placeholder="0,00"
                    className="w-36 h-9 font-mono text-xs text-right"
                  />
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 font-medium">
                    <QrCode className="h-3.5 w-3.5 text-primary" /> Pix:
                  </span>
                  <Input
                    type="number"
                    step="0.01"
                    value={splitPix || ""}
                    onChange={(e) => setSplitPix(parseFloat(e.target.value) || 0)}
                    placeholder="0,00"
                    className="w-36 h-9 font-mono text-xs text-right"
                  />
                </div>

                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 font-medium">
                    <CreditCard className="h-3.5 w-3.5 text-amber-600" /> Cartão:
                  </span>
                  <Input
                    type="number"
                    step="0.01"
                    value={splitCard || ""}
                    onChange={(e) => setSplitCard(parseFloat(e.target.value) || 0)}
                    placeholder="0,00"
                    className="w-36 h-9 font-mono text-xs text-right"
                  />
                </div>
              </div>

              {/* Status do Split */}
              <div className="rounded-xl border border-border/80 bg-muted/30 p-3 space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span>Total Distribuído:</span>
                  <span className="font-mono font-bold">{formatBRL(totalSplitRegistered)}</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span>Restante a Distribuir:</span>
                  <span className={`font-mono font-bold ${isSplitComplete ? "text-emerald-600" : "text-destructive"}`}>
                    {formatBRL(remainingSplit)}
                  </span>
                </div>
              </div>
            </div>

            <Button
              type="button"
              disabled={!isSplitComplete}
              onClick={handleConfirmSplit}
              className="w-full h-11 text-xs font-bold gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <CheckCircle2 className="h-4 w-4" />
              <span>Concluir Venda Dividida</span>
            </Button>
          </TabsContent>
        </Tabs>

        <DialogFooter className="border-t border-border/60 pt-3 flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="text-xs font-semibold text-muted-foreground hover:text-foreground"
          >
            Voltar à Venda [ESC]
          </Button>

          <span className="text-[11px] text-muted-foreground">
            Transmissão SEFAZ NFC-e automática ao confirmar
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
