export type CheckoutStep = 1 | 2 | 3 | 4

export interface ShippingAddress {
  fullName: string
  email: string
  phone: string
  cep: string
  street: string
  number: string
  complement?: string
  neighborhood: string
  city: string
  state: string
  saveAddress: boolean
  sameAsBilling: boolean
}

export type PaymentMethodType = "credit_card" | "pix" | "boleto"

export interface PaymentDetails {
  method: PaymentMethodType
  // Cartão de crédito
  cardNumber?: string
  cardHolder?: string
  cardExpiry?: string
  cardCvv?: string
  installments?: string
  saveCard?: boolean
  // Pix
  pixCode?: string
  pixQrCodeUrl?: string
  // Boleto
  boletoBarcode?: string
  boletoDueDate?: string
}

export interface OrderItem {
  id: string
  name: string
  category: string
  price: number
  quantity: number
  description: string
  badge?: string
}

export interface OrderSummaryData {
  items: OrderItem[]
  subtotal: number
  shipping: number
  discount: number
  appliedCoupon?: string
  total: number
}

export const INITIAL_ORDER_ITEMS: OrderItem[] = [
  {
    id: "item-1",
    name: "Plano Atlas Cloud Enterprise",
    category: "Software & Licenciamento",
    price: 349.0,
    quantity: 1,
    description: "Licença anual com suporte 24/7 e SLA de 99.99%",
    badge: "Mais Popular",
  },
  {
    id: "item-2",
    name: "Módulo Adicional: Multi-empresa & Filiais",
    category: "Add-on",
    price: 120.0,
    quantity: 1,
    description: "Gestão unificada para até 5 filiais integradas",
  },
  {
    id: "item-3",
    name: "Pacote de Armazenamento Seguro 500GB",
    category: "Infraestrutura",
    price: 49.9,
    quantity: 1,
    description: "Backups diários automatizados e criptografia AES-256",
  },
]

export const BRAZILIAN_STATES = [
  { uf: "AC", name: "Acre" },
  { uf: "AL", name: "Alagoas" },
  { uf: "AP", name: "Amapá" },
  { uf: "AM", name: "Amazonas" },
  { uf: "BA", name: "Bahia" },
  { uf: "CE", name: "Ceará" },
  { uf: "DF", name: "Distrito Federal" },
  { uf: "ES", name: "Espírito Santo" },
  { uf: "GO", name: "Goiás" },
  { uf: "MA", name: "Maranhão" },
  { uf: "MT", name: "Mato Grosso" },
  { uf: "MS", name: "Mato Grosso do Sul" },
  { uf: "MG", name: "Minas Gerais" },
  { uf: "PA", name: "Pará" },
  { uf: "PB", name: "Paraíba" },
  { uf: "PR", name: "Paraná" },
  { uf: "PE", name: "Pernambuco" },
  { uf: "PI", name: "Piauí" },
  { uf: "RJ", name: "Rio de Janeiro" },
  { uf: "RN", name: "Rio Grande do Norte" },
  { uf: "RS", name: "Rio Grande do Sul" },
  { uf: "RO", name: "Rondônia" },
  { uf: "RR", name: "Roraima" },
  { uf: "SC", name: "Santa Catarina" },
  { uf: "SP", name: "São Paulo" },
  { uf: "SE", name: "Sergipe" },
  { uf: "TO", name: "Tocantins" },
]

export function formatCurrencyBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value)
}

