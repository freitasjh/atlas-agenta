import type { Meta, StoryObj } from "@storybook/react"
import { CardInvoiceHeader } from "./card-invoice-header"
import { MOCK_CARDS_WITH_INVOICES } from "./statement-types"
import { Button } from "@/components/shadcn/ui/button"
import { Split, ShieldCheck } from "lucide-react"

const meta: Meta<typeof CardInvoiceHeader> = {
  title: "Shadcn/Finance/CardInvoiceHeader",
  component: CardInvoiceHeader,
  parameters: {
    layout: "padded",
  },
  tags: ["autodocs"],
}

export default meta
type Story = StoryObj<typeof CardInvoiceHeader>

const sampleCard = MOCK_CARDS_WITH_INVOICES[0] // Nubank Ultravioleta
const sampleInvoice = sampleCard.invoices[0] // Closed invoice

/**
 * 1. Uso passando o objeto `card` e `invoice` completos
 */
export const FromCardAndInvoiceObjects: Story = {
  args: {
    card: sampleCard,
    invoice: sampleInvoice,
    onPayInvoice: () => alert("Disparou modal de pagamento Pix / Boleto"),
    onExportStatement: () => alert("Exportando demonstrativo em PDF"),
  },
}

/**
 * 2. Uso passando apenas parâmetros primitivos simples (qualquer backend / API REST)
 */
export const FromPrimitiveProps: Story = {
  args: {
    cardNickname: "Cartão Operacional Marketing",
    brand: "mastercard",
    last4: "4921",
    theme: "platinum",
    isDefault: true,
    totalAmount: 8450.9,
    dueDate: "20/12/2026",
    closingDate: "13/12/2026",
    period: "Dezembro de 2026",
    status: "closed",
    totalLimit: 30000,
    availableLimit: 21549.1,
    barcode: "23793.38128 60000.123456 12345.678901 1 95080000845090",
    pixCopyPaste: "00020126580014br.gov.bcb.pix0136marketing@empresa.com.br5204000053039865408450.905802BR",
    onPayInvoice: () => alert("Abrir checkout de pagamento"),
    onExportStatement: () => alert("Baixando PDF"),
  },
}

/**
 * 3. Fatura Consolidada (Multicartões)
 */
export const ConsolidatedView: Story = {
  args: {
    isConsolidated: true,
    cards: MOCK_CARDS_WITH_INVOICES,
    period: "Novembro de 2026",
    onPayInvoice: () => alert("Pagar total consolidado"),
    onExportStatement: () => alert("Exportar consolidado"),
  },
}

/**
 * 4. Fatura Paga (Status Paid)
 */
export const PaidInvoice: Story = {
  args: {
    cardNickname: "Cartão Executivo Diretoria",
    brand: "visa",
    last4: "1098",
    theme: "emerald",
    totalAmount: 12400.0,
    dueDate: "05/11/2026",
    closingDate: "28/10/2026",
    period: "Outubro de 2026",
    status: "paid",
    totalLimit: 50000,
    availableLimit: 48000,
    onExportStatement: () => alert("Exportar recibo"),
  },
}

/**
 * 5. Cartão sem Barra de Limite (Adaptive 2-Column Layout)
 */
export const WithoutLimitsBar: Story = {
  args: {
    cardNickname: "Cartão de Débito Corporativo",
    brand: "elo",
    last4: "3312",
    hideLimits: true,
    totalAmount: 2340.5,
    dueDate: "10/11/2026",
    closingDate: "03/11/2026",
    period: "Novembro de 2026",
    status: "open",
    onPayInvoice: () => alert("Pagar Fatura"),
  },
}

/**
 * 6. Ações Customizadas Injetadas pelo Sistema Consumidor
 */
export const CustomActionsSlot: Story = {
  args: {
    cardNickname: "Cartão Frotas & Viagens",
    brand: "amex",
    last4: "7765",
    totalAmount: 5120.0,
    dueDate: "15/11/2026",
    closingDate: "08/11/2026",
    status: "closed",
    totalLimit: 25000,
    availableLimit: 19880,
    actions: (
      <div className="flex flex-col gap-2">
        <Button size="sm" className="bg-primary text-primary-foreground gap-1.5 h-9">
          <ShieldCheck className="size-4" />
          Aprovar Pagamento no ERP
        </Button>
        <Button size="sm" variant="outline" className="gap-1.5 h-9">
          <Split className="size-4" />
          Parcelar em 12x
        </Button>
      </div>
    ),
  },
}

/**
 * 7. Estado de Carregamento (Loading Skeleton)
 */
export const LoadingState: Story = {
  args: {
    isLoading: true,
  },
}
