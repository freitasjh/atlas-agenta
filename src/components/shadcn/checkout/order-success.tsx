import { useState } from "react"
import { 
  CheckCircle2, 
  Package, 
  Mail, 
  ArrowRight, 
  RotateCcw, 
  Printer, 
  FileCheck, 
  Copy
} from "lucide-react"
import { Button } from "../ui/button"
import { Badge } from "../ui/badge"
import { Separator } from "../ui/separator"
import { 
  type ShippingAddress, 
  type PaymentDetails, 
  formatCurrencyBRL 
} from "./checkout-types"

interface OrderSuccessProps {
  orderNumber: string
  address: ShippingAddress
  payment: PaymentDetails
  totalAmount: number
  onReset: () => void
  onTrackOrder?: () => void
}

export function OrderSuccess({
  orderNumber,
  address,
  payment,
  totalAmount,
  onReset,
  onTrackOrder,
}: OrderSuccessProps) {
  const [copied, setCopied] = useState(false)

  const handleCopyOrderNumber = () => {
    navigator.clipboard.writeText(orderNumber)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="rounded-xl border border-border bg-card p-6 md:p-8 space-y-8 text-center max-w-2xl mx-auto shadow-sm">
      {/* Ícone de Sucesso */}
      <div className="flex flex-col items-center space-y-3">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 animate-in zoom-in-50 duration-300">
          <CheckCircle2 className="h-9 w-9" />
        </div>

        <div className="space-y-1">
          <h2 className="text-2xl font-bold tracking-tight text-foreground">
            Pedido Confirmado com Sucesso!
          </h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Obrigado pela sua compra. Enviamos a confirmação detalhada e a Nota Fiscal para{" "}
            <strong className="text-foreground">{address.email || "seu e-mail"}</strong>.
          </p>
        </div>
      </div>

      {/* Box com Identificador do Pedido */}
      <div className="rounded-lg bg-muted/40 border border-border p-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-left">
        <div>
          <span className="text-xs text-muted-foreground block">Código do Pedido</span>
          <span className="text-lg font-mono font-bold tracking-wider text-foreground">
            {orderNumber}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCopyOrderNumber}
            className="h-8 text-xs gap-1.5"
          >
            <Copy className="h-3.5 w-3.5" />
            {copied ? "Copiado!" : "Copiar Código"}
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => window.print()}
            className="h-8 text-xs gap-1.5"
          >
            <Printer className="h-3.5 w-3.5" />
            Imprimir
          </Button>
        </div>
      </div>

      {/* Resumo de Entrega e Pagamento */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-left text-xs">
        <div className="rounded-lg border border-border p-4 space-y-2">
          <div className="flex items-center gap-1.5 font-medium text-foreground text-sm">
            <Package className="h-4 w-4 text-primary" />
            <span>Previsão de Ativação / Envio</span>
          </div>
          <p className="text-muted-foreground">
            {payment.method === "pix" || payment.method === "credit_card"
              ? "Ativação instantânea em até 5 minutos após a confirmação bancária."
              : "Liberação em até 1 dia útil após a compensação do boleto bancário."}
          </p>
          <p className="text-muted-foreground pt-1">
            Entrega vinculada ao endereço: <br />
            <strong className="text-foreground">
              {address.city || "São Paulo"} - {address.state || "SP"}, CEP {address.cep || "01310-100"}
            </strong>
          </p>
        </div>

        <div className="rounded-lg border border-border p-4 space-y-2">
          <div className="flex items-center gap-1.5 font-medium text-foreground text-sm">
            <FileCheck className="h-4 w-4 text-emerald-500" />
            <span>Status do Pagamento</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20 text-xs">
              {payment.method === "pix" && "Aguardando Confirmação Pix"}
              {payment.method === "credit_card" && "Pagamento Autorizado"}
              {payment.method === "boleto" && "Aguardando Pagamento do Boleto"}
            </Badge>
          </div>
          <p className="text-muted-foreground">
            Valor Total Faturado: <strong className="text-foreground">{formatCurrencyBRL(totalAmount)}</strong>
          </p>
          <p className="text-muted-foreground">
            Método: <strong className="text-foreground">
              {payment.method === "pix" ? "Pix Instantâneo" : payment.method === "credit_card" ? "Cartão de Crédito" : "Boleto Bancário"}
            </strong>
          </p>
        </div>
      </div>

      {/* Dica de acompanhamento */}
      <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground pt-2">
        <Mail className="h-4 w-4 text-primary shrink-0" />
        <span>Você receberá notificações por e-mail a cada atualização de status do seu pedido.</span>
      </div>

      <Separator />

      {/* Ações Finais */}
      <div className="flex flex-col-reverse sm:flex-row items-center justify-center gap-3 pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={onReset}
          className="w-full sm:w-auto gap-2"
        >
          <RotateCcw className="h-4 w-4" />
          Realizar Novo Pedido
        </Button>

        {onTrackOrder && (
          <Button
            type="button"
            onClick={onTrackOrder}
            className="w-full sm:w-auto gap-2"
          >
            Acompanhar no Painel
            <ArrowRight className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  )
}
