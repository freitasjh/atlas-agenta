import type { CardBrand, CardTheme } from "./credit-card-types"

export type InvoiceStatus = "open" | "closed" | "paid" | "future"

export interface CardLimitInfo {
  totalLimit: number
  usedLimit: number
  availableLimit: number
}

export interface CardInvoice {
  id: string
  cardId: string
  period: string // e.g. "Novembro 2026"
  periodCode: string // e.g. "2026-11"
  status: InvoiceStatus
  closingDate: string // e.g. "03/11/2026"
  dueDate: string // e.g. "10/11/2026"
  totalAmount: number
  minimumPayment: number
  barcode: string
  pixCopyPaste: string
  qrCodeUrl?: string
}

export interface CardExpenseItem {
  id: string
  cardId: string
  invoiceId: string
  merchantName: string
  category: "Transporte" | "Infraestrutura" | "Alimentação" | "E-commerce" | "Software" | "Saúde" | "Serviços"
  date: string // "2026-11-12"
  time: string // "14:32"
  amount: number // valor negativo para despesa, positivo para estorno
  installments?: {
    current: number
    total: number
  }
  status: "cleared" | "pending"
  location?: string
  receiptUrl?: string
  notes?: string
}

export interface CardWithInvoices {
  id: string
  nickname: string
  brand: CardBrand
  last4: string
  holderName: string
  theme: CardTheme
  isDefault: boolean
  limits: CardLimitInfo
  invoices: CardInvoice[]
}

export const MOCK_CARDS_WITH_INVOICES: CardWithInvoices[] = [
  {
    id: "card-01",
    nickname: "Nubank Ultravioleta",
    brand: "mastercard",
    last4: "8492",
    holderName: "JOAO SILVA",
    theme: "violet",
    isDefault: true,
    limits: {
      totalLimit: 30000,
      usedLimit: 4890.5,
      availableLimit: 25109.5,
    },
    invoices: [
      {
        id: "inv-2026-10",
        cardId: "card-01",
        period: "Outubro 2026",
        periodCode: "2026-10",
        status: "paid",
        closingDate: "03/10/2026",
        dueDate: "10/10/2026",
        totalAmount: 3420.8,
        minimumPayment: 513.12,
        barcode: "34191.79001 01043.510047 91020.150008 5 95080000342080",
        pixCopyPaste: "00020126580014br.gov.bcb.pix0136123e4567-e89b-12d3-a456-42661417400052040000530398654053420.805802BR5915Atlas Pagamentos6009Sao Paulo62070503***6304ABCD",
      },
      {
        id: "inv-2026-11",
        cardId: "card-01",
        period: "Novembro 2026",
        periodCode: "2026-11",
        status: "closed",
        closingDate: "03/11/2026",
        dueDate: "10/11/2026",
        totalAmount: 4890.5,
        minimumPayment: 733.58,
        barcode: "34191.79001 01043.510047 91020.150008 5 95080000489050",
        pixCopyPaste: "00020126580014br.gov.bcb.pix0136123e4567-e89b-12d3-a456-42661417400052040000530398654054890.505802BR5915Atlas Pagamentos6009Sao Paulo62070503***6304EFEF",
      },
      {
        id: "inv-2026-12",
        cardId: "card-01",
        period: "Dezembro 2026",
        periodCode: "2026-12",
        status: "open",
        closingDate: "03/12/2026",
        dueDate: "10/12/2026",
        totalAmount: 1850.2,
        minimumPayment: 277.53,
        barcode: "34191.79001 01043.510047 91020.150008 5 95080000185020",
        pixCopyPaste: "00020126580014br.gov.bcb.pix0136123e4567-e89b-12d3-a456-42661417400052040000530398654051850.205802BR5915Atlas Pagamentos6009Sao Paulo62070503***63049988",
      },
    ],
  },
  {
    id: "card-02",
    nickname: "Itaú Corporate Black",
    brand: "visa",
    last4: "3104",
    holderName: "JOAO SILVA",
    theme: "midnight",
    isDefault: false,
    limits: {
      totalLimit: 60000,
      usedLimit: 12450.0,
      availableLimit: 47550.0,
    },
    invoices: [
      {
        id: "inv-itau-2026-11",
        cardId: "card-02",
        period: "Novembro 2026",
        periodCode: "2026-11",
        status: "open",
        closingDate: "15/11/2026",
        dueDate: "22/11/2026",
        totalAmount: 12450.0,
        minimumPayment: 1867.5,
        barcode: "34191.79001 01043.510047 91020.150008 5 95080001245000",
        pixCopyPaste: "00020126580014br.gov.bcb.pix0136123e4567-e89b-12d3-a456-4266141740005204000053039865412450.005802BR5915Itau Unibanco6009Sao Paulo62070503***63041234",
      },
    ],
  },
  {
    id: "card-03",
    nickname: "Bradesco Elo Nanquim PJ",
    brand: "elo",
    last4: "9041",
    holderName: "JOAO SILVA",
    theme: "platinum",
    isDefault: false,
    limits: {
      totalLimit: 45000,
      usedLimit: 8230.0,
      availableLimit: 36770.0,
    },
    invoices: [
      {
        id: "inv-brad-2026-11",
        cardId: "card-03",
        period: "Novembro 2026",
        periodCode: "2026-11",
        status: "closed",
        closingDate: "10/11/2026",
        dueDate: "17/11/2026",
        totalAmount: 8230.0,
        minimumPayment: 1234.5,
        barcode: "23791.79001 01043.510047 91020.150008 5 95080000823000",
        pixCopyPaste: "00020126580014br.gov.bcb.pix0136...",
      },
    ],
  },
  {
    id: "card-04",
    nickname: "BTG Pactual Corporate Black",
    brand: "mastercard",
    last4: "5521",
    holderName: "JOAO SILVA",
    theme: "midnight",
    isDefault: false,
    limits: {
      totalLimit: 80000,
      usedLimit: 24500.0,
      availableLimit: 55500.0,
    },
    invoices: [
      {
        id: "inv-btg-2026-11",
        cardId: "card-04",
        period: "Novembro 2026",
        periodCode: "2026-11",
        status: "open",
        closingDate: "20/11/2026",
        dueDate: "27/11/2026",
        totalAmount: 24500.0,
        minimumPayment: 3675.0,
        barcode: "20891.79001 01043.510047 91020.150008 5 95080002450000",
        pixCopyPaste: "00020126580014br.gov.bcb.pix0136...",
      },
    ],
  },
  {
    id: "card-05",
    nickname: "C6 Business Carbon",
    brand: "mastercard",
    last4: "7130",
    holderName: "JOAO SILVA",
    theme: "emerald",
    isDefault: false,
    limits: {
      totalLimit: 35000,
      usedLimit: 3150.0,
      availableLimit: 31850.0,
    },
    invoices: [
      {
        id: "inv-c6-2026-11",
        cardId: "card-05",
        period: "Novembro 2026",
        periodCode: "2026-11",
        status: "open",
        closingDate: "25/11/2026",
        dueDate: "02/12/2026",
        totalAmount: 3150.0,
        minimumPayment: 472.5,
        barcode: "33691.79001 01043.510047 91020.150008 5 95080000315000",
        pixCopyPaste: "00020126580014br.gov.bcb.pix0136...",
      },
    ],
  },
]

export const MOCK_CARD_EXPENSES: CardExpenseItem[] = [
  {
    id: "exp-01",
    cardId: "card-01",
    invoiceId: "inv-2026-11",
    merchantName: "Amazon Web Services",
    category: "Infraestrutura",
    date: "2026-11-12",
    time: "10:14",
    amount: -840.5,
    status: "cleared",
    location: "São Paulo, SP",
    notes: "Fatura de servidores cloud e CDN CloudFront",
  },
  {
    id: "exp-02",
    cardId: "card-01",
    invoiceId: "inv-2026-11",
    merchantName: "Apple Store Online",
    category: "E-commerce",
    date: "2026-11-11",
    time: "16:45",
    amount: -1299.0,
    installments: { current: 2, total: 6 },
    status: "cleared",
    location: "Internet",
    notes: "Acessórios para equipe de design",
  },
  {
    id: "exp-03",
    cardId: "card-01",
    invoiceId: "inv-2026-11",
    merchantName: "Uber *Viagem",
    category: "Transporte",
    date: "2026-11-10",
    time: "18:22",
    amount: -48.9,
    status: "cleared",
    location: "São Paulo, SP",
  },
  {
    id: "exp-04",
    cardId: "card-01",
    invoiceId: "inv-2026-11",
    merchantName: "Restaurante Fasano",
    category: "Alimentação",
    date: "2026-11-08",
    time: "20:30",
    amount: -650.0,
    status: "cleared",
    location: "Itaim Bibi, SP",
    notes: "Jantar corporativo de alinhamento trimestral",
  },
  {
    id: "exp-05",
    cardId: "card-01",
    invoiceId: "inv-2026-11",
    merchantName: "GitHub Enterprise",
    category: "Software",
    date: "2026-11-05",
    time: "09:00",
    amount: -420.0,
    status: "cleared",
    location: "San Francisco, US",
  },
  {
    id: "exp-06",
    cardId: "card-01",
    invoiceId: "inv-2026-11",
    merchantName: "Estorno Voo Cancelado LATAM",
    category: "Transporte",
    date: "2026-11-04",
    time: "11:15",
    amount: 380.0, // Crédito / Estorno
    status: "cleared",
    location: "São Paulo, SP",
    notes: "Reembolso automático aprovado",
  },
  {
    id: "exp-07",
    cardId: "card-01",
    invoiceId: "inv-2026-11",
    merchantName: "Starbucks Coffee Faria Lima",
    category: "Alimentação",
    date: "2026-11-03",
    time: "08:12",
    amount: -32.5,
    status: "cleared",
    location: "São Paulo, SP",
  },
  {
    id: "exp-08",
    cardId: "card-01",
    invoiceId: "inv-2026-11",
    merchantName: "Posto Shell Pinheiros",
    category: "Transporte",
    date: "2026-11-02",
    time: "19:04",
    amount: -220.0,
    status: "cleared",
    location: "São Paulo, SP",
  },
]

