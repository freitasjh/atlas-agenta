import * as React from "react"
import {
  CreditCard,
  QrCode,
  Calendar,
  AlertCircle,
  CheckCircle2,
  Download,
  Receipt,
  Sparkles,
  Star,
  Copy,
} from "lucide-react"
import { Button } from "@/components/shadcn/ui/button"
import { Badge } from "@/components/shadcn/ui/badge"
import { Skeleton } from "@/components/shadcn/ui/skeleton"
import { cn } from "@/lib/cn"
import { toast } from "sonner"
import type { CardInvoice, CardLimitInfo, CardWithInvoices, InvoiceStatus } from "./statement-types"
import type { CardBrand, CardTheme } from "./credit-card-types"

export interface CardInvoiceHeaderProps {
  /** Objeto completo da fatura (opcional se passadas propriedades diretas) */
  invoice?: CardInvoice | null
  /** Objeto completo do cartão (opcional se passadas propriedades diretas) */
  card?: CardWithInvoices | null
  /** Lista de cartões para contexto consolidado */
  cards?: CardWithInvoices[]

  // --- Parâmetros Primitivos Diretos (para qualquer backend ou tela consumidora) ---
  /** Valor total da fatura */
  totalAmount?: number
  /** Data de vencimento da fatura (ex: "10/11/2026") */
  dueDate?: string
  /** Data de fechamento da fatura (ex: "03/11/2026") */
  closingDate?: string
  /** Período de competência da fatura (ex: "Novembro de 2026") */
  period?: string
  /** Status da fatura ("open" | "closed" | "paid" | "future") */
  status?: InvoiceStatus
  /** Linha digitável ou código de barras para pagamento */
  barcode?: string
  /** Código Pix copia e cola */
  pixCopyPaste?: string

  // --- Identidade e Detalhes do Cartão ---
  /** Apelido / Nome do cartão */
  cardNickname?: string
  /** Últimos 4 dígitos do cartão (ex: "8421") */
  last4?: string
  /** Bandeira do cartão */
  brand?: CardBrand
  /** Tema visual do mini-cartão */
  theme?: CardTheme
  /** Indica se é o cartão principal da conta */
  isDefault?: boolean
  /** Modo consolidado (soma de faturas de todos os cartões) */
  isConsolidated?: boolean

  // --- Limites de Crédito ---
  /** Objeto estruturado de limites */
  limits?: CardLimitInfo
  /** Limite total */
  totalLimit?: number
  /** Limite disponível */
  availableLimit?: number
  /** Limite utilizado */
  usedLimit?: number
  /** Ocultar a barra de limite (útil para cartões de débito ou pré-pagos) */
  hideLimits?: boolean

  // --- Formatação e Moeda ---
  /** Código da moeda (padrão: "BRL") */
  currency?: string
  /** Função customizada de formatação monetária */
  formatAmount?: (value: number) => string

  // --- Ações e Callbacks ---
  /** Callback ao clicar em "Pagar Fatura" */
  onPayInvoice?: () => void
  /** Callback ao clicar em "Extrato PDF" */
  onExportStatement?: () => void
  /** Callback ao copiar o código de barras / linha digitável */
  onCopyBarcode?: () => void
  /** Callback ao copiar a chave / QR Code Pix */
  onCopyPix?: () => void
  /** Callback ao visualizar detalhes da fatura */
  onViewDetails?: () => void
  /** Slot aberto para injetar ações customizadas pelo sistema consumidor */
  actions?: React.ReactNode

  // --- Estado de Carregamento e Estilização ---
  /** Exibe estado de carregamento com esqueletos animados */
  isLoading?: boolean
  /** Classes CSS adicionais do container principal */
  className?: string
}

export function CardInvoiceHeader({
  invoice,
  card,
  cards,
  totalAmount,
  dueDate,
  closingDate,
  period,
  status,
  barcode,
  pixCopyPaste,
  cardNickname,
  last4,
  brand,
  theme,
  isDefault,
  isConsolidated = false,
  limits,
  totalLimit,
  availableLimit,
  usedLimit,
  hideLimits = false,
  currency = "BRL",
  formatAmount,
  onPayInvoice,
  onExportStatement,
  onCopyBarcode,
  onCopyPix,
  onViewDetails,
  actions,
  isLoading = false,
  className,
}: CardInvoiceHeaderProps) {
  // 1. Resolução Unificada dos Dados da Fatura
  const resolvedInvoice = invoice ?? card?.invoices?.find((inv) => inv.status === "closed" || inv.status === "open") ?? card?.invoices?.[0]

  const resolvedStatus: InvoiceStatus =
    status ??
    resolvedInvoice?.status ??
    (isConsolidated ? "closed" : "open")

  const resolvedTotalAmount =
    totalAmount ??
    resolvedInvoice?.totalAmount ??
    (isConsolidated && cards
      ? cards.reduce((acc, c) => {
          const inv = c.invoices.find((i) => i.status === "closed" || i.status === "open") || c.invoices[0]
          return acc + (inv?.totalAmount ?? 0)
        }, 0)
      : 0)

  const resolvedDueDate = dueDate ?? resolvedInvoice?.dueDate ?? "A definir"
  const resolvedClosingDate = closingDate ?? resolvedInvoice?.closingDate ?? "A definir"
  const resolvedPeriod = period ?? resolvedInvoice?.period ?? (isConsolidated ? "Fatura Consolidada" : "Fatura Atual")
  const resolvedBarcode = barcode ?? resolvedInvoice?.barcode
  const resolvedPix = pixCopyPaste ?? resolvedInvoice?.pixCopyPaste

  // 2. Resolução da Identidade do Cartão
  const resolvedCardNickname =
    cardNickname ??
    card?.nickname ??
    (isConsolidated ? "Todas as Contas e Cartões" : "Cartão Corporativo")

  const resolvedLast4 = last4 ?? card?.last4
  const resolvedBrand = brand ?? card?.brand
  const resolvedTheme = theme ?? card?.theme ?? "midnight"
  const resolvedIsDefault = isDefault ?? card?.isDefault ?? false

  // 3. Resolução dos Limites de Crédito
  const resolvedTotalLimit =
    totalLimit ??
    limits?.totalLimit ??
    card?.limits?.totalLimit ??
    (isConsolidated && cards ? cards.reduce((acc, c) => acc + (c.limits?.totalLimit ?? 0), 0) : undefined)

  const resolvedUsedLimit =
    usedLimit ??
    limits?.usedLimit ??
    card?.limits?.usedLimit ??
    (isConsolidated && cards ? cards.reduce((acc, c) => acc + (c.limits?.usedLimit ?? 0), 0) : undefined)

  const resolvedAvailableLimit =
    availableLimit ??
    limits?.availableLimit ??
    card?.limits?.availableLimit ??
    (resolvedTotalLimit !== undefined && resolvedUsedLimit !== undefined
      ? Math.max(0, resolvedTotalLimit - resolvedUsedLimit)
      : undefined)

  const hasLimits =
    !hideLimits &&
    resolvedTotalLimit !== undefined &&
    resolvedTotalLimit > 0

  const limitUsagePercent = hasLimits && resolvedTotalLimit && resolvedTotalLimit > 0
    ? Math.min(
        100,
        Math.round(
          ((resolvedUsedLimit ?? (resolvedTotalLimit - (resolvedAvailableLimit ?? 0))) /
            resolvedTotalLimit) *
            100
        )
      )
    : 0

  // 4. Formatador Monetário
  const defaultFormatBRL = (val: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency,
    }).format(val)
  }
  const formatMoney = formatAmount ?? defaultFormatBRL

  // 5. Handlers de Cópia
  const handleCopyBarcode = () => {
    if (resolvedBarcode) {
      navigator.clipboard?.writeText(resolvedBarcode)
      toast.success("Código de barras / Linha digitável copiada com sucesso!")
    }
    onCopyBarcode?.()
    if (!resolvedBarcode && !onCopyBarcode && onPayInvoice) {
      onPayInvoice()
    }
  }

  const handleCopyPix = () => {
    if (resolvedPix) {
      navigator.clipboard?.writeText(resolvedPix)
      toast.success("Código Pix copia e cola copiado!")
    }
    onCopyPix?.()
  }

  // 6. Badge de Status Semântico
  const renderStatusBadge = () => {
    switch (resolvedStatus) {
      case "paid":
        return (
          <Badge
            variant="outline"
            className="border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold gap-1 text-xs"
          >
            <CheckCircle2 className="h-3 w-3" />
            Fatura Paga
          </Badge>
        )
      case "closed":
        return (
          <Badge
            variant="default"
            className="bg-amber-600 hover:bg-amber-700 text-white font-semibold gap-1 text-xs shadow-xs"
          >
            <AlertCircle className="h-3 w-3" />
            Fatura Fechada • Vence {resolvedDueDate}
          </Badge>
        )
      case "open":
        return (
          <Badge
            variant="outline"
            className="border-primary/40 bg-primary/10 text-primary font-semibold gap-1 text-xs"
          >
            <Sparkles className="h-3 w-3" />
            Fatura Atual (Aberta)
          </Badge>
        )
      case "future":
        return (
          <Badge variant="secondary" className="text-muted-foreground font-semibold text-xs">
            Fatura Futura
          </Badge>
        )
      default:
        return (
          <Badge variant="outline" className="text-xs">
            {resolvedStatus}
          </Badge>
        )
    }
  }

  // 7. Loading State
  if (isLoading) {
    return (
      <div
        className={cn(
          "rounded-2xl border border-border/80 bg-card p-5 sm:p-6 shadow-xs text-card-foreground",
          className
        )}
      >
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
          <div className="lg:col-span-5 space-y-3">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-10 w-48" />
            <Skeleton className="h-4 w-56" />
          </div>
          <div className="lg:col-span-4 rounded-xl border border-border/70 bg-muted/30 p-4 space-y-3">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-2 w-full rounded-full" />
            <Skeleton className="h-3 w-28" />
          </div>
          <div className="lg:col-span-3 space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        "rounded-2xl border border-border/80 bg-card p-5 sm:p-6 shadow-xs text-card-foreground transition-all",
        className
      )}
    >
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
        {/* Coluna 1: Identidade, Valor da Fatura e Prazos */}
        <div className={cn("space-y-2.5", hasLimits ? "lg:col-span-5" : "lg:col-span-8")}>
          {/* Identidade do Cartão + Badge de Status */}
          <div className="flex flex-wrap items-center gap-2">
            {renderStatusBadge()}

            <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
              {/* Mini tag de tema ou ícone */}
              {isConsolidated ? (
                <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-primary/10 text-primary text-[11px] font-semibold">
                  <CreditCard className="h-3 w-3" />
                  Consolidado
                </div>
              ) : (
                <div
                  className={cn(
                    "flex h-4 w-6 shrink-0 items-center justify-center rounded border border-white/20 font-mono text-[8px] font-bold text-white shadow-2xs",
                    resolvedTheme === "violet" && "bg-gradient-to-br from-purple-800 to-indigo-950",
                    resolvedTheme === "midnight" && "bg-gradient-to-br from-neutral-800 to-neutral-950",
                    resolvedTheme === "emerald" && "bg-gradient-to-br from-emerald-800 to-teal-950",
                    resolvedTheme === "platinum" && "bg-gradient-to-br from-slate-600 to-slate-900",
                    resolvedTheme === "rose_gold" && "bg-gradient-to-br from-rose-700 to-pink-950"
                  )}
                >
                  ••••
                </div>
              )}

              <span className="font-semibold text-foreground truncate max-w-[180px]">
                {resolvedCardNickname}
              </span>

              {resolvedLast4 && (
                <span className="font-mono text-muted-foreground/80 text-[11px]">
                  (final {resolvedLast4})
                </span>
              )}

              {resolvedBrand && (
                <span className="uppercase text-[10px] font-bold px-1.5 py-0.2 rounded bg-muted text-muted-foreground">
                  {resolvedBrand}
                </span>
              )}

              {resolvedIsDefault && (
                <span title="Cartão Padrão Principal">
                  <Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500 shrink-0" />
                </span>
              )}
            </div>
          </div>

          {/* Valor Principal da Fatura */}
          <div>
            <span className="text-xs text-muted-foreground block font-medium">
              Total da Fatura • {resolvedPeriod}
            </span>
            <span className="font-mono text-3xl sm:text-4xl font-extrabold tracking-tight text-foreground block">
              {formatMoney(resolvedTotalAmount)}
            </span>
          </div>

          {/* Datas de Fechamento e Vencimento */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground pt-0.5">
            <span className="flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5 text-primary" />
              Fechamento: <strong className="text-foreground">{resolvedClosingDate}</strong>
            </span>
            <span className="flex items-center gap-1">
              Vencimento: <strong className="text-foreground">{resolvedDueDate}</strong>
            </span>
            {onViewDetails && (
              <button
                type="button"
                onClick={onViewDetails}
                className="text-primary hover:underline font-semibold ml-auto"
              >
                Ver detalhes
              </button>
            )}
          </div>
        </div>

        {/* Coluna 2: Barra de Limite de Crédito Utilizado (quando aplicável) */}
        {hasLimits && (
          <div className="lg:col-span-4 rounded-xl border border-border/70 bg-muted/30 p-4 space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-muted-foreground flex items-center gap-1">
                <CreditCard className="h-3.5 w-3.5 text-primary" />
                Limite Disponível:
              </span>
              <span className="font-mono font-bold text-foreground">
                {formatMoney(resolvedAvailableLimit ?? 0)}
              </span>
            </div>

            {/* Barra de progresso do limite */}
            <div className="space-y-1">
              <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-500",
                    limitUsagePercent > 85
                      ? "bg-destructive"
                      : limitUsagePercent > 60
                      ? "bg-amber-500"
                      : "bg-primary"
                  )}
                  style={{ width: `${limitUsagePercent}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                <span>{limitUsagePercent}% utilizado</span>
                {resolvedTotalLimit !== undefined && (
                  <span>Limite total: {formatMoney(resolvedTotalLimit)}</span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Coluna 3: Ações de Pagamento e Exportação */}
        <div
          className={cn(
            "flex flex-col sm:flex-row justify-center gap-2",
            hasLimits ? "lg:col-span-3 lg:flex-col" : "lg:col-span-4 lg:flex-col"
          )}
        >
          {actions ? (
            actions
          ) : (
            <>
              {resolvedStatus !== "paid" && onPayInvoice && (
                <Button
                  type="button"
                  onClick={onPayInvoice}
                  className="h-10 text-xs font-semibold gap-2 shadow-xs bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer"
                >
                  <QrCode className="h-4 w-4" />
                  <span>Pagar Fatura (Pix / Boleto)</span>
                </Button>
              )}

              <div className="flex items-center gap-2">
                {onExportStatement && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onExportStatement}
                    className="flex-1 text-xs font-semibold gap-1.5 h-9 cursor-pointer"
                    title="Exportar demonstrativo detalhado da fatura em PDF"
                  >
                    <Download className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>Extrato PDF</span>
                  </Button>
                )}

                {(resolvedBarcode || onCopyBarcode || onPayInvoice) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleCopyBarcode}
                    className="flex-1 text-xs font-semibold gap-1 text-muted-foreground hover:text-foreground h-9 cursor-pointer"
                    title={resolvedBarcode ? "Copiar linha digitável do boleto" : "Ver opções de pagamento"}
                  >
                    {resolvedBarcode ? (
                      <Copy className="h-3.5 w-3.5" />
                    ) : (
                      <Receipt className="h-3.5 w-3.5" />
                    )}
                    <span>Linha Digitável</span>
                  </Button>
                )}

                {resolvedPix && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleCopyPix}
                    className="flex-1 text-xs font-semibold gap-1 text-muted-foreground hover:text-foreground h-9 cursor-pointer"
                    title="Copiar código Pix Copia e Cola"
                  >
                    <QrCode className="h-3.5 w-3.5 text-emerald-600" />
                    <span>Copiar Pix</span>
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
