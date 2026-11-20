import { Printer, CheckCircle2, Send, QrCode } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/shadcn/ui/dialog"
import { Button } from "@/components/shadcn/ui/button"
import type { PDVCartItem, PaymentSplit, PDVCustomer } from "./pdv-types"
import { toast } from "sonner"

interface PDVReceiptModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  saleNumber: string
  items: PDVCartItem[]
  splits: PaymentSplit[]
  customer: PDVCustomer | null
  nfceNumber: number
  series: string
  createdAt?: string
  onNewSale: () => void
}

export function PDVReceiptModal({
  open,
  onOpenChange,
  saleNumber,
  items,
  splits,
  customer,
  nfceNumber,
  series,
  createdAt = "17/11/2026, 13:30:00",
  onNewSale,
}: PDVReceiptModalProps) {
  const formatBRL = (val: number) => {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: "BRL",
    }).format(val)
  }

  const subtotal = items.reduce((acc, item) => acc + item.totalAmount, 0)
  const totalAmount = splits.reduce((acc, split) => acc + split.amount, 0) || subtotal

  const handlePrint = () => {
    toast.success("Comando enviado para impressora térmica de 80mm!")
  }

  const handleShare = () => {
    toast.success("Link do DANFE NFC-e enviado ao cliente via WhatsApp/E-mail!")
  }

  const handleDone = () => {
    onOpenChange(false)
    onNewSale()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full sm:max-w-[440px] max-h-[92vh] overflow-y-auto overscroll-contain p-5 sm:p-6">
        <DialogHeader className="text-left space-y-1">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold">
                Venda Finalizada com Sucesso!
              </DialogTitle>
              <span className="text-xs text-muted-foreground block">
                DANFE NFC-e emitida e transmitida à SEFAZ
              </span>
            </div>
          </div>
        </DialogHeader>

        {/* Visualizador de Bobina Térmica 80mm */}
        <div className="rounded-xl border border-dashed border-border bg-white text-neutral-900 p-4 font-mono text-[11px] shadow-sm space-y-2 select-all leading-tight">
          <div className="text-center pb-2 border-b border-dashed border-neutral-300 space-y-0.5">
            <p className="font-bold text-xs uppercase">ATLAS VAREJO & COMÉRCIO LTDA</p>
            <p className="text-[10px]">CNPJ: 12.345.678/0001-90 • IE: 123.456.789.111</p>
            <p className="text-[10px]">Av. Paulista, 1000 - Bela Vista - São Paulo/SP</p>
            <p className="font-bold pt-1">
              DANFE NFC-e - Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica
            </p>
          </div>

          <div className="space-y-0.5 text-[10px] pb-1 border-b border-dashed border-neutral-300">
            <div className="flex justify-between">
              <span>NFC-e Nº: {String(nfceNumber).padStart(6, "0")}</span>
              <span>Série: {series}</span>
            </div>
            <div className="flex justify-between">
              <span>Emissão: {createdAt}</span>
              <span>Cupom: {saleNumber}</span>
            </div>
          </div>

          {/* Lista de Itens */}
          <div className="py-1 border-b border-dashed border-neutral-300 space-y-1">
            <div className="flex justify-between font-bold text-[10px]">
              <span># CÓDIGO DESCRIÇÃO QTD UN VL UNIT</span>
              <span>TOTAL</span>
            </div>
            {items.map((it, idx) => (
              <div key={it.id} className="space-y-0.5">
                <div className="flex justify-between">
                  <span className="truncate pr-1">
                    {String(idx + 1).padStart(2, "0")} {it.sku} {it.name}
                  </span>
                  <span className="font-bold shrink-0">{formatBRL(it.totalAmount)}</span>
                </div>
                <div className="text-[9px] text-neutral-600 pl-3">
                  {it.quantity} {it.unit} x {formatBRL(it.unitPrice)}
                </div>
              </div>
            ))}
          </div>

          {/* Totais */}
          <div className="py-1 border-b border-dashed border-neutral-300 space-y-0.5">
            <div className="flex justify-between">
              <span>Qtd. Total de Itens:</span>
              <span>{items.reduce((acc, it) => acc + it.quantity, 0)}</span>
            </div>
            <div className="flex justify-between font-bold text-xs pt-0.5">
              <span>VALOR TOTAL R$:</span>
              <span>{formatBRL(totalAmount)}</span>
            </div>
          </div>

          {/* Formas de Pagamento */}
          <div className="py-1 border-b border-dashed border-neutral-300 space-y-0.5">
            <span className="font-bold block text-[10px]">FORMA DE PAGAMENTO</span>
            {splits.map((s, idx) => (
              <div key={idx} className="flex justify-between">
                <span className="uppercase">
                  {s.method === "cash"
                    ? "Dinheiro"
                    : s.method === "pix"
                    ? "Pix Dinâmico"
                    : s.method === "credit_card"
                    ? `Cartão Crédito (${s.installments || 1}x)`
                    : "Cartão Débito"}
                </span>
                <span className="font-bold">{formatBRL(s.amount)}</span>
              </div>
            ))}
          </div>

          {/* Identificação do Consumidor */}
          <div className="py-1 border-b border-dashed border-neutral-300 text-[10px]">
            <p>
              CONSUMIDOR:{" "}
              {customer
                ? `CPF: ${customer.cpfCnpj} ${customer.name ? `- ${customer.name}` : ""}`
                : "NÃO IDENTIFICADO"}
            </p>
          </div>

          {/* QR Code SEFAZ e Chave de Acesso */}
          <div className="text-center pt-2 space-y-1">
            <div className="mx-auto flex h-24 w-24 items-center justify-center border border-neutral-300 p-1">
              <QrCode className="h-full w-full text-neutral-800" />
            </div>
            <p className="text-[9px] text-neutral-600">
              Consulte pela Chave de Acesso em http://www.fazenda.sp.gov.br/nfce
            </p>
            <p className="text-[9px] font-mono break-all font-bold">
              3526 1112 3456 7800 0190 6500 1000 0482 9110 9876 5432
            </p>
            <p className="text-[9px] text-neutral-600">Protocolo de Autorização: 135260009876543</p>
          </div>
        </div>

        <DialogFooter className="border-t border-border/60 pt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handlePrint}
              className="text-xs font-semibold gap-1"
            >
              <Printer className="h-3.5 w-3.5" />
              <span>Imprimir</span>
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleShare}
              className="text-xs font-semibold gap-1"
            >
              <Send className="h-3.5 w-3.5" />
              <span>WhatsApp</span>
            </Button>
          </div>

          <Button
            type="button"
            onClick={handleDone}
            className="text-xs font-bold gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            <span>Iniciar Próxima Venda</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
