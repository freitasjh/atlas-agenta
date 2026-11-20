"use client"

import * as React from "react"
import { toast } from "sonner"
import {
  CreditCard,
  QrCode,
  FileText,
  Sparkles,
  ShieldCheck,
  Check,
  Building,
  User,
  Mail,
  Phone,
} from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/shadcn/ui/dialog"
import { Button } from "@/components/shadcn/ui/button"
import { Input } from "@/components/shadcn/ui/input"
import { Label } from "@/components/shadcn/ui/label"
import { cn } from "@/lib/cn"
import type { BillingPeriod, PricingPlan } from "./pricing-types"

interface PlanSubscribeDialogProps {
  plan: PricingPlan | null
  billing: BillingPeriod
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

type PaymentMethod = "credit-card" | "pix" | "invoice"

export function PlanSubscribeDialog({
  plan,
  billing,
  open,
  onOpenChange,
  onSuccess,
}: PlanSubscribeDialogProps) {
  const [fullName, setFullName] = React.useState("")
  const [companyName, setCompanyName] = React.useState("")
  const [email, setEmail] = React.useState("")
  const [phone, setPhone] = React.useState("")
  const [paymentMethod, setPaymentMethod] = React.useState<PaymentMethod>("credit-card")
  const [isSubmitting, setIsSubmitting] = React.useState(false)

  if (!plan) return null

  const isAnnual = billing === "annually"
  const price = isAnnual ? plan.priceAnnually : plan.priceMonthly
  const annualTotal = plan.priceAnnually * 12
  const savings = (plan.priceMonthly - plan.priceAnnually) * 12

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!fullName || !email || !companyName) return

    setIsSubmitting(true)

    setTimeout(() => {
      setIsSubmitting(false)
      onOpenChange(false)
      toast.success(`Plano ${plan.name} ativado com sucesso!`, {
        description: `Ambiente configurado para ${companyName}. Enviamos as credenciais para ${email}.`,
      })
      onSuccess?.()
    }, 800)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <div className="flex items-center gap-2 text-primary">
            <Sparkles className="h-4 w-4" />
            <span className="text-xs font-semibold uppercase tracking-wider">
              Contratação de Assinatura
            </span>
          </div>
          <DialogTitle className="text-xl font-bold text-foreground">
            Plano {plan.name} ({isAnnual ? "Anual • Economia de 20%" : "Mensal"})
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Preencha os dados da sua organização para ativar sua conta e liberar o acesso imediato.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {/* Card Resumo do Plano */}
          <div className="relative rounded-xl border border-primary/30 bg-primary/5 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-foreground text-sm">{plan.name}</span>
                <span className="rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                  {plan.limitLabel}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {plan.description}
              </p>
              {isAnnual && (
                <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium mt-1 flex items-center gap-1">
                  <Check className="h-3 w-3" /> Economia anual de R$ {savings},00
                </p>
              )}
            </div>

            <div className="text-right sm:border-l sm:border-border/60 sm:pl-4 shrink-0">
              <span className="text-[10px] text-muted-foreground block">Valor do Plano</span>
              <span className="font-mono text-2xl font-extrabold text-foreground tabular-nums">
                R$ {price}
              </span>
              <span className="text-[10px] text-muted-foreground block">
                /mês {isAnnual && `(R$ ${annualTotal}/ano)`}
              </span>
            </div>
          </div>

          {/* Dados do Responsável e Empresa */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="sub-name" className="text-xs font-medium text-foreground">
                Nome do Responsável *
              </Label>
              <div className="relative">
                <User className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="sub-name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Dra. Roberta Guimarães"
                  className="pl-9 h-9 text-xs"
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sub-company" className="text-xs font-medium text-foreground">
                Nome da Empresa ou Clínica *
              </Label>
              <div className="relative">
                <Building className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="sub-company"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="Clínica Guimarães & Saúde"
                  className="pl-9 h-9 text-xs"
                  required
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="sub-email" className="text-xs font-medium text-foreground">
                E-mail Corporativo *
              </Label>
              <div className="relative">
                <Mail className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="sub-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="roberta@clinica.com.br"
                  className="pl-9 h-9 text-xs"
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="sub-phone" className="text-xs font-medium text-foreground">
                Telefone / WhatsApp *
              </Label>
              <div className="relative">
                <Phone className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  id="sub-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(11) 98765-4321"
                  className="pl-9 h-9 text-xs font-mono"
                  required
                />
              </div>
            </div>
          </div>

          {/* Formas de Pagamento */}
          <div className="space-y-2 pt-1">
            <Label className="text-xs font-medium text-foreground">
              Forma de Pagamento Preferida
            </Label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setPaymentMethod("credit-card")}
                className={cn(
                  "flex flex-col items-center justify-center rounded-xl border p-2.5 text-center transition-all cursor-pointer",
                  paymentMethod === "credit-card"
                    ? "border-primary bg-primary/5 text-primary ring-2 ring-primary/20 font-semibold"
                    : "border-border/70 bg-card text-muted-foreground hover:border-foreground/30"
                )}
              >
                <CreditCard className="h-4 w-4 mb-1" />
                <span className="text-[11px]">Cartão de Crédito</span>
              </button>

              <button
                type="button"
                onClick={() => setPaymentMethod("pix")}
                className={cn(
                  "flex flex-col items-center justify-center rounded-xl border p-2.5 text-center transition-all cursor-pointer",
                  paymentMethod === "pix"
                    ? "border-primary bg-primary/5 text-primary ring-2 ring-primary/20 font-semibold"
                    : "border-border/70 bg-card text-muted-foreground hover:border-foreground/30"
                )}
              >
                <QrCode className="h-4 w-4 mb-1 text-emerald-500" />
                <span className="text-[11px]">PIX Instantâneo</span>
              </button>

              <button
                type="button"
                onClick={() => setPaymentMethod("invoice")}
                className={cn(
                  "flex flex-col items-center justify-center rounded-xl border p-2.5 text-center transition-all cursor-pointer",
                  paymentMethod === "invoice"
                    ? "border-primary bg-primary/5 text-primary ring-2 ring-primary/20 font-semibold"
                    : "border-border/70 bg-card text-muted-foreground hover:border-foreground/30"
                )}
              >
                <FileText className="h-4 w-4 mb-1" />
                <span className="text-[11px]">Boleto / Faturado</span>
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/30 p-2.5 text-[11px] text-muted-foreground">
            <ShieldCheck className="h-4 w-4 text-emerald-500 shrink-0" />
            <span>
              Período de teste gratuito por 14 dias. A primeira cobrança só ocorrerá após o término do período de avaliação.
            </span>
          </div>

          <DialogFooter className="gap-2 pt-2 border-t border-border/70">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>

            <Button
              type="submit"
              size="sm"
              disabled={isSubmitting}
              className="gap-1.5"
            >
              {isSubmitting ? (
                <span>Ativando Ambiente...</span>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>Confirmar & Iniciar Teste</span>
                </>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
