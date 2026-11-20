import { useState } from "react"
import {
  QrCode,
  Copy,
  Check,
  Download,
  Receipt,
  Zap,
  Clock,
  ExternalLink,
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
import { toast } from "sonner"
import type { CardInvoice } from "./statement-types"

interface PayInvoiceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  invoice: CardInvoice
}

export function PayInvoiceDialog({
  open,
  onOpenChange,
  invoice,
}: PayInvoiceDialogProps) {
  const [copiedPix, setCopiedPix] = useState(false)
  const [copiedBoleto, setCopiedBoleto] = useState(false)

  const formatBRL = (val: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(val)
  }

  const handleCopyPix = async () => {
    try {
      await navigator.clipboard.writeText(invoice.pixCopyPaste)
      setCopiedPix(true)
      toast.success("Código Pix Copia e Cola copiado!")
      setTimeout(() => setCopiedPix(false), 2000)
    } catch {
      toast.error("Não foi possível copiar.")
    }
  }

  const handleCopyBarcode = async () => {
    try {
      await navigator.clipboard.writeText(invoice.barcode)
      setCopiedBoleto(true)
      toast.success("Linha digitável do boleto copiada!")
      setTimeout(() => setCopiedBoleto(false), 2000)
    } catch {
      toast.error("Não foi possível copiar.")
    }
  }

  const handleDownloadPdf = () => {
    toast.success("Download do boleto PDF iniciado!")
  }

  const handleConfirmPaid = () => {
    onOpenChange(false)
    toast.success("Aguardando confirmação bancária", {
      description: "Assim que o banco compensar, seu limite será liberado automaticamente.",
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full sm:max-w-[480px] max-h-[92vh] overflow-y-auto overscroll-contain p-5 sm:p-6">
        {/* Cabeçalho */}
        <DialogHeader className="text-left space-y-1">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <QrCode className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-base font-bold tracking-tight text-foreground truncate">
                Pagar Fatura de {invoice.period}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground truncate">
                Vencimento em {invoice.dueDate} • Fechada em {invoice.closingDate}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Resumo do Valor */}
        <div className="rounded-xl border border-border/80 bg-muted/40 p-3.5 flex items-center justify-between">
          <span className="text-xs font-medium text-muted-foreground">
            Total a pagar:
          </span>
          <span className="font-mono text-2xl font-extrabold tracking-tight text-foreground tabular-nums">
            {formatBRL(invoice.totalAmount)}
          </span>
        </div>

        {/* Abas Pix vs Boleto */}
        <Tabs defaultValue="pix" className="w-full">
          <TabsList className="grid w-full grid-cols-2 h-10 p-1">
            <TabsTrigger value="pix" className="text-xs font-semibold gap-1.5">
              <Zap className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              Pix (Instantâneo)
            </TabsTrigger>
            <TabsTrigger value="boleto" className="text-xs font-semibold gap-1.5">
              <Receipt className="h-3.5 w-3.5 text-muted-foreground" />
              Boleto Bancário
            </TabsTrigger>
          </TabsList>

          {/* ============================================================ */}
          {/* ABA PIX                                                      */}
          {/* ============================================================ */}
          <TabsContent value="pix" className="space-y-4 pt-3 focus-visible:outline-none">
            {/* Bloco do QR Code */}
            <div className="flex flex-col items-center justify-center rounded-xl border border-border/80 bg-card p-4 text-center space-y-3">
              <div className="flex h-44 w-44 items-center justify-center rounded-xl border border-border bg-white p-2.5 shadow-sm">
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(
                    invoice.pixCopyPaste
                  )}`}
                  alt="QR Code Pix"
                  className="h-full w-full object-contain"
                />
              </div>

              <div className="space-y-1">
                <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                  <Zap className="h-3 w-3" />
                  Limite restabelecido na hora
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Aponte a câmera do aplicativo do seu banco para o código acima
                </p>
              </div>
            </div>

            {/* Pix Copia e Cola */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground block">
                Pix Copia e Cola
              </label>
              <div className="flex items-center gap-2 min-w-0">
                <div className="flex-1 min-w-0 rounded-lg border border-border bg-muted/40 px-3 py-2">
                  <p className="font-mono text-xs text-muted-foreground truncate select-all">
                    {invoice.pixCopyPaste}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleCopyPix}
                  className="h-9 px-3 text-xs font-semibold gap-1.5 shrink-0"
                >
                  {copiedPix ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-500" />
                      <span>Copiado!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      <span>Copiar</span>
                    </>
                  )}
                </Button>
              </div>
            </div>
          </TabsContent>

          {/* ============================================================ */}
          {/* ABA BOLETO                                                   */}
          {/* ============================================================ */}
          <TabsContent value="boleto" className="space-y-4 pt-3 focus-visible:outline-none">
            <div className="rounded-xl border border-border/80 bg-muted/30 p-4 space-y-3">
              <div className="flex items-start gap-2.5 text-xs text-muted-foreground">
                <Clock className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                <p className="leading-relaxed">
                  Pagamentos por boleto podem levar até <strong>2 dias úteis</strong> para
                  compensação e liberação do limite do cartão.
                </p>
              </div>

              <div className="space-y-1.5">
                <span className="text-[11px] font-semibold text-muted-foreground block">
                  Linha Digitável:
                </span>
                <div className="rounded-lg border border-border bg-background p-3">
                  <p className="font-mono text-xs font-bold text-foreground select-all break-all leading-relaxed">
                    {invoice.barcode}
                  </p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row items-center gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleCopyBarcode}
                  className="w-full sm:flex-1 text-xs font-semibold gap-1.5 h-9"
                >
                  {copiedBoleto ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-500" />
                      <span>Linha Copiada!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      <span>Copiar Linha</span>
                    </>
                  )}
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadPdf}
                  className="w-full sm:flex-1 text-xs font-semibold gap-1.5 h-9"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Baixar PDF</span>
                </Button>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        {/* Rodapé de Ações */}
        <DialogFooter className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2 border-t border-border/60 pt-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="text-xs font-semibold text-muted-foreground hover:text-foreground"
          >
            Fechar
          </Button>

          <Button
            type="button"
            size="sm"
            onClick={handleConfirmPaid}
            className="text-xs font-semibold gap-1.5 bg-primary text-primary-foreground"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            <span>Já paguei esta fatura</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
