"use client"

import { useState } from "react"
import {
  ArrowLeft,
  ArrowRight,
  Barcode,
  CheckCircle2,
  Copy,
  CreditCard,
  QrCode,
  ShieldCheck,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/shadcn/ui/badge"
import { Button } from "@/components/shadcn/ui/button"
import { Checkbox } from "@/components/shadcn/ui/checkbox"
import { Input } from "@/components/shadcn/ui/input"
import { Label } from "@/components/shadcn/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/shadcn/ui/select"
import {
  type PaymentDetails,
  type PaymentMethodType,
  formatCurrencyBRL,
} from "./checkout-types"

interface PaymentFormProps {
  initialData?: Partial<PaymentDetails>
  orderTotal: number
  onBack: () => void
  onSubmit: (payment: PaymentDetails) => void
}

export function PaymentForm({
  initialData,
  orderTotal,
  onBack,
  onSubmit,
}: PaymentFormProps) {
  const [method, setMethod] = useState<PaymentMethodType>(
    initialData?.method ?? "credit_card"
  )

  // Estados Cartão
  const [cardNumber, setCardNumber] = useState(initialData?.cardNumber ?? "")
  const [cardHolder, setCardHolder] = useState(initialData?.cardHolder ?? "")
  const [cardExpiry, setCardExpiry] = useState(initialData?.cardExpiry ?? "")
  const [cardCvv, setCardCvv] = useState(initialData?.cardCvv ?? "")
  const [installments, setInstallments] = useState(initialData?.installments ?? "1")
  const [saveCard, setSaveCard] = useState(initialData?.saveCard ?? true)

  // Máscara de Cartão (0000 0000 0000 0000)
  function handleCardNumberChange(val: string) {
    const numeric = val.replace(/\D/g, "").slice(0, 16)
    const parts = numeric.match(/[\s\S]{1,4}/g) || []
    setCardNumber(parts.join(" "))
  }

  // Máscara de Validade (MM/AA)
  function handleExpiryChange(val: string) {
    const numeric = val.replace(/\D/g, "").slice(0, 4)
    if (numeric.length > 2) {
      setCardExpiry(`${numeric.slice(0, 2)}/${numeric.slice(2)}`)
    } else {
      setCardExpiry(numeric)
    }
  }

  // Máscara de CVV (3 ou 4 dígitos)
  function handleCvvChange(val: string) {
    const numeric = val.replace(/\D/g, "").slice(0, 4)
    setCardCvv(numeric)
  }

  function handleCopyPixCode() {
    const mockPix = "00020126580014br.gov.bcb.pix0136123e4567-e89b-12d3-a456-4266141740005204000053039865802BR5925ATLAS TECNOLOGIA SA6009SAO PAULO62070503***6304E2CA"
    navigator.clipboard?.writeText(mockPix)
    toast.success("Código Pix Copia e Cola copiado com sucesso!")
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (method === "credit_card") {
      if (cardNumber.replace(/\s/g, "").length < 13) {
        toast.error("Informe um número de cartão de crédito válido.")
        return
      }
      if (!cardHolder.trim()) {
        toast.error("Informe o nome impresso no cartão.")
        return
      }
      if (cardExpiry.length < 5) {
        toast.error("Informe a data de validade completa (MM/AA).")
        return
      }
      if (cardCvv.length < 3) {
        toast.error("Informe o código de segurança (CVV).")
        return
      }
    }

    onSubmit({
      method,
      cardNumber: cardNumber ? `•••• •••• •••• ${cardNumber.slice(-4)}` : undefined,
      cardHolder: cardHolder.trim() || undefined,
      cardExpiry: cardExpiry || undefined,
      cardCvv: cardCvv || undefined,
      installments,
      saveCard,
      pixCode: method === "pix" ? "pix-atlas-0491-auto" : undefined,
      boletoBarcode:
        method === "boleto" ? "34191.79001 01043.510047 91020.150008 1 99240000051890" : undefined,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-6">
      <div className="flex flex-col gap-1 border-b border-border/70 pb-3">
        <h2 className="flex items-center gap-2 text-lg font-bold tracking-tight text-foreground sm:text-xl">
          <CreditCard className="size-5 text-primary" />
          Forma de Pagamento
        </h2>
        <p className="text-xs text-muted-foreground">
          Selecione a modalidade de pagamento desejada. Transação protegida por criptografia de ponta a ponta.
        </p>
      </div>

      {/* Seletor Visual de Métodos de Pagamento */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {/* Opção 1: Cartão de Crédito */}
        <button
          type="button"
          onClick={() => setMethod("credit_card")}
          className={`flex flex-col gap-1.5 rounded-xl border p-4 text-left transition-all ${
            method === "credit_card"
              ? "border-primary bg-primary/5 ring-2 ring-primary/20 shadow-xs"
              : "border-border/70 hover:border-border hover:bg-muted/40"
          }`}
        >
          <div className="flex items-center justify-between">
            <CreditCard
              className={`size-5 ${
                method === "credit_card" ? "text-primary" : "text-muted-foreground"
              }`}
            />
            {method === "credit_card" && (
              <CheckCircle2 className="size-4 text-primary" />
            )}
          </div>
          <span className="text-sm font-semibold text-foreground">
            Cartão de Crédito
          </span>
          <span className="text-[11px] text-muted-foreground">
            Em até 12x sem juros
          </span>
        </button>

        {/* Opção 2: Pix */}
        <button
          type="button"
          onClick={() => setMethod("pix")}
          className={`flex flex-col gap-1.5 rounded-xl border p-4 text-left transition-all ${
            method === "pix"
              ? "border-primary bg-primary/5 ring-2 ring-primary/20 shadow-xs"
              : "border-border/70 hover:border-border hover:bg-muted/40"
          }`}
        >
          <div className="flex items-center justify-between">
            <QrCode
              className={`size-5 ${
                method === "pix" ? "text-primary" : "text-muted-foreground"
              }`}
            />
            <Badge variant="default" className="bg-emerald-600 text-[10px] text-white">
              5% OFF
            </Badge>
          </div>
          <span className="text-sm font-semibold text-foreground">
            Pix Instantâneo
          </span>
          <span className="text-[11px] text-muted-foreground">
            Aprovação em segundos
          </span>
        </button>

        {/* Opção 3: Boleto Bancário */}
        <button
          type="button"
          onClick={() => setMethod("boleto")}
          className={`flex flex-col gap-1.5 rounded-xl border p-4 text-left transition-all ${
            method === "boleto"
              ? "border-primary bg-primary/5 ring-2 ring-primary/20 shadow-xs"
              : "border-border/70 hover:border-border hover:bg-muted/40"
          }`}
        >
          <div className="flex items-center justify-between">
            <Barcode
              className={`size-5 ${
                method === "boleto" ? "text-primary" : "text-muted-foreground"
              }`}
            />
            {method === "boleto" && (
              <CheckCircle2 className="size-4 text-primary" />
            )}
          </div>
          <span className="text-sm font-semibold text-foreground">
            Boleto Bancário
          </span>
          <span className="text-[11px] text-muted-foreground">
            Vencimento em 3 dias
          </span>
        </button>
      </div>

      {/* Painel Condicional: Cartão de Crédito */}
      {method === "credit_card" && (
        <div className="flex flex-col gap-4 rounded-xl border border-border/70 bg-card p-5 shadow-xs">
          {/* Mockup Elegante de Cartão */}
          <div className="relative mx-auto flex h-40 w-full max-w-sm flex-col justify-between rounded-xl bg-linear-to-tr from-zinc-900 to-zinc-800 p-4 text-white shadow-md border border-white/10 dark:from-zinc-950 dark:to-zinc-900">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold tracking-widest text-zinc-400">
                ATLAS PLATINUM
              </span>
              <CreditCard className="size-5 text-zinc-300" />
            </div>

            <div className="font-mono text-base tracking-widest text-zinc-200">
              {cardNumber || "•••• •••• •••• ••••"}
            </div>

            <div className="flex items-end justify-between">
              <div className="flex flex-col">
                <span className="text-[9px] uppercase tracking-wider text-zinc-400">
                  Titular
                </span>
                <span className="text-xs font-semibold uppercase tracking-wider text-zinc-200 truncate max-w-[180px]">
                  {cardHolder || "SEU NOME AQUI"}
                </span>
              </div>
              <div className="flex flex-col text-right">
                <span className="text-[9px] uppercase tracking-wider text-zinc-400">
                  Validade
                </span>
                <span className="font-mono text-xs font-semibold text-zinc-200">
                  {cardExpiry || "MM/AA"}
                </span>
              </div>
            </div>
          </div>

          {/* Grid de Campos do Cartão (Simétrico de 2 Colunas) */}
          <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2 pt-2">
            {/* Número do Cartão (largura total) */}
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="cc-number" className="text-xs font-medium text-foreground">
                Número do Cartão *
              </Label>
              <div className="relative">
                <CreditCard className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <Input
                  id="cc-number"
                  name="cc-number"
                  type="text"
                  autoComplete="cc-number"
                  inputMode="numeric"
                  maxLength={19}
                  placeholder="0000 0000 0000 0000"
                  value={cardNumber}
                  onChange={(e) => handleCardNumberChange(e.target.value)}
                  className="h-10 w-full pl-10 font-mono text-sm"
                  required
                  aria-required="true"
                  autoFocus
                />
              </div>
            </div>

            {/* Nome no Cartão (largura total) */}
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="cc-name" className="text-xs font-medium text-foreground">
                Nome Impresso no Cartão *
              </Label>
              <Input
                id="cc-name"
                name="cc-name"
                type="text"
                autoComplete="cc-name"
                maxLength={50}
                placeholder="Ex: CARLOS E SILVEIRA"
                value={cardHolder}
                onChange={(e) => setCardHolder(e.target.value)}
                className="h-10 w-full uppercase"
                required
                aria-required="true"
              />
            </div>

            {/* Validade */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cc-exp" className="text-xs font-medium text-foreground">
                Validade (MM/AA) *
              </Label>
              <Input
                id="cc-exp"
                name="cc-exp"
                type="text"
                autoComplete="cc-exp"
                inputMode="numeric"
                maxLength={5}
                placeholder="MM/AA"
                value={cardExpiry}
                onChange={(e) => handleExpiryChange(e.target.value)}
                className="h-10 w-full font-mono text-center"
                required
                aria-required="true"
              />
            </div>

            {/* Código CVV */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cc-csc" className="text-xs font-medium text-foreground">
                Código CVV / CVC *
              </Label>
              <Input
                id="cc-csc"
                name="cc-csc"
                type="text"
                autoComplete="cc-csc"
                inputMode="numeric"
                maxLength={4}
                placeholder="123"
                value={cardCvv}
                onChange={(e) => handleCvvChange(e.target.value)}
                className="h-10 w-full font-mono text-center"
                required
                aria-required="true"
              />
            </div>

            {/* Parcelamento (largura total) */}
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="cc-installments" className="text-xs font-medium text-foreground">
                Condição de Parcelamento *
              </Label>
              <Select value={installments} onValueChange={setInstallments}>
                <SelectTrigger id="cc-installments" className="h-10 w-full">
                  <SelectValue placeholder="Selecione as parcelas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">
                    1x de {formatCurrencyBRL(orderTotal)} à vista sem juros
                  </SelectItem>
                  <SelectItem value="2">
                    2x de {formatCurrencyBRL(orderTotal / 2)} sem juros
                  </SelectItem>
                  <SelectItem value="3">
                    3x de {formatCurrencyBRL(orderTotal / 3)} sem juros
                  </SelectItem>
                  <SelectItem value="6">
                    6x de {formatCurrencyBRL(orderTotal / 6)} sem juros
                  </SelectItem>
                  <SelectItem value="12">
                    12x de {formatCurrencyBRL(orderTotal / 12)} sem juros
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Salvar Cartão */}
          <label className="flex items-center gap-2.5 text-xs text-muted-foreground pt-1 cursor-pointer">
            <Checkbox
              checked={saveCard}
              onCheckedChange={(checked) => setSaveCard(Boolean(checked))}
            />
            <span>Salvar este cartão com segurança para pagamentos rápidos futuros.</span>
          </label>
        </div>
      )}

      {/* Painel Condicional: Pix */}
      {method === "pix" && (
        <div className="flex flex-col items-center gap-4 rounded-xl border border-border/70 bg-card p-6 text-center shadow-xs">
          <div className="flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400">
            <ShieldCheck className="size-4" />
            5% de Desconto Aplicado com Pix
          </div>

          <div className="flex size-44 items-center justify-center rounded-2xl border-2 border-border/80 bg-white p-3 shadow-inner dark:bg-zinc-100">
            <QrCode className="size-full text-zinc-900" />
          </div>

          <div className="flex flex-col gap-1 max-w-sm">
            <span className="text-sm font-bold text-foreground">
              Total com Desconto Pix: {formatCurrencyBRL(orderTotal * 0.95)}
            </span>
            <p className="text-xs text-muted-foreground">
              Abra o app do seu banco, escolha <strong>Pix &gt; Ler QR Code</strong> ou copie a chave Pix abaixo.
            </p>
          </div>

          <div className="flex w-full max-w-md items-center gap-2">
            <Input
              readOnly
              value="00020126580014br.gov.bcb.pix0136123e4567..."
              className="h-10 font-mono text-xs text-muted-foreground select-all"
            />
            <Button
              type="button"
              variant="outline"
              onClick={handleCopyPixCode}
              className="h-10 gap-1.5 shrink-0 text-xs font-semibold"
            >
              <Copy className="size-3.5" />
              Copiar
            </Button>
          </div>
        </div>
      )}

      {/* Painel Condicional: Boleto Bancário */}
      {method === "boleto" && (
        <div className="flex flex-col gap-4 rounded-xl border border-border/70 bg-card p-6 shadow-xs">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Barcode className="size-5" />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-sm font-semibold text-foreground">
                Pagamento via Boleto Bancário
              </span>
              <p className="text-xs text-muted-foreground leading-relaxed">
                O boleto será gerado ao concluir o pedido. O prazo de compensação bancária é de até <strong>3 dias úteis</strong> após o pagamento em qualquer agência, lotérica ou aplicativo bancário.
              </p>
            </div>
          </div>

          <div className="rounded-lg bg-muted/60 p-3.5 text-xs text-muted-foreground border border-border/60">
            <strong>Atenção:</strong> Os produtos ou acessos contratados serão liberados assim que a compensação bancária for confirmada pela câmara de liquidação.
          </div>
        </div>
      )}

      {/* Botões de Ação com Espaçamento e Alinhamento Perfeito */}
      <div className="flex items-center justify-between pt-4 border-t border-border/70">
        <Button
          type="button"
          variant="outline"
          onClick={onBack}
          className="gap-2"
        >
          <ArrowLeft className="size-4" />
          Voltar para Endereço
        </Button>

        <Button type="submit" className="gap-2 font-semibold">
          Revisar Pedido
          <ArrowRight className="size-4" />
        </Button>
      </div>
    </form>
  )
}

