export type ProductCategory =
  | "all"
  | "beverages"
  | "food"
  | "bakery"
  | "snacks"
  | "grocery"
  | "pharmacy"

export interface PDVProduct {
  id: string
  sku: string
  ean: string
  name: string
  category: ProductCategory
  price: number
  costPrice?: number
  stock: number
  unit: "un" | "kg" | "l" | "cx"
  imageUrl?: string
  badge?: string
}

export interface PDVCartItem {
  id: string
  productId: string
  sku: string
  ean: string
  name: string
  unitPrice: number
  quantity: number
  unit: "un" | "kg" | "l" | "cx"
  discountAmount: number
  totalAmount: number
}

export type PaymentMethodType =
  | "cash"
  | "pix"
  | "credit_card"
  | "debit_card"
  | "voucher"

export interface PaymentSplit {
  method: PaymentMethodType
  amount: number
  installments?: number
  cardBrand?: string
}

export interface PDVCustomer {
  cpfCnpj: string
  name?: string
  email?: string
}

export type CashMovementType = "sangria" | "suprimento"

export interface CashMovementRecord {
  id: string
  type: CashMovementType
  amount: number
  reason: string
  operator: string
  timestamp: string
}

export interface RegisterStatus {
  registerNumber: string
  operatorName: string
  openedAt: string
  initialCash: number
  currentCashInDrawer: number
  isOnline: boolean
  isFiscalConnected: boolean
  nfceSeries: string
  nextNfceNumber: number
}

export const MOCK_PDV_PRODUCTS: PDVProduct[] = [
  {
    id: "prod-1",
    sku: "BEV-001",
    ean: "7894900010015",
    name: "Coca-Cola Original 350ml Lata",
    category: "beverages",
    price: 6.5,
    stock: 142,
    unit: "un",
    badge: "Mais Vendido",
  },
  {
    id: "prod-2",
    sku: "BEV-002",
    ean: "7894900011555",
    name: "Água Mineral Crystal sem Gás 500ml",
    category: "beverages",
    price: 3.5,
    stock: 210,
    unit: "un",
  },
  {
    id: "prod-3",
    sku: "BEV-003",
    ean: "7891991010832",
    name: "Cerveja Heineken Puro Malte 330ml Long Neck",
    category: "beverages",
    price: 9.9,
    stock: 88,
    unit: "un",
  },
  {
    id: "prod-4",
    sku: "BEV-004",
    ean: "7898215150025",
    name: "Suco Natural One Laranja Integral 900ml",
    category: "beverages",
    price: 11.9,
    stock: 45,
    unit: "un",
  },
  {
    id: "prod-5",
    sku: "FOOD-001",
    ean: "7891000100101",
    name: "Misto Quente Especial no Pão Francês",
    category: "food",
    price: 14.9,
    stock: 99,
    unit: "un",
    badge: "Lanche",
  },
  {
    id: "prod-6",
    sku: "FOOD-002",
    ean: "7891000100202",
    name: "Hambúrguer Artesanal Smash Angus 160g",
    category: "food",
    price: 28.5,
    stock: 35,
    unit: "un",
    badge: "Destaque",
  },
  {
    id: "prod-7",
    sku: "FOOD-003",
    ean: "7891000100303",
    name: "Porção de Batata Frita Rústica com Alecrim 300g",
    category: "food",
    price: 19.9,
    stock: 50,
    unit: "un",
  },
  {
    id: "prod-8",
    sku: "BAK-001",
    ean: "7896000001112",
    name: "Pão de Queijo Mineiro Tradicional 80g",
    category: "bakery",
    price: 5.0,
    stock: 80,
    unit: "un",
    badge: "Forno",
  },
  {
    id: "prod-9",
    sku: "BAK-002",
    ean: "7896000002223",
    name: "Croissant Francês Amanteigado",
    category: "bakery",
    price: 12.0,
    stock: 24,
    unit: "un",
  },
  {
    id: "prod-10",
    sku: "SNK-001",
    ean: "7891079012345",
    name: "Batata Pringles Original 114g",
    category: "snacks",
    price: 14.5,
    stock: 62,
    unit: "un",
  },
  {
    id: "prod-11",
    sku: "SNK-002",
    ean: "7891000055442",
    name: "Chocolate Nestlé KitKat 4 Fingers 41,5g",
    category: "snacks",
    price: 4.8,
    stock: 130,
    unit: "un",
  },
  {
    id: "prod-12",
    sku: "GRO-001",
    ean: "7896004000123",
    name: "Café Especial Torrado e Moído Orfeu 250g",
    category: "grocery",
    price: 26.9,
    stock: 40,
    unit: "un",
  },
  {
    id: "prod-13",
    sku: "GRO-002",
    ean: "7898901234567",
    name: "Azeite de Oliva Extra Virgem Português 500ml",
    category: "grocery",
    price: 42.0,
    stock: 18,
    unit: "un",
  },
  {
    id: "prod-14",
    sku: "BEV-005",
    ean: "7891991000222",
    name: "Energético Red Bull Energy Drink 250ml",
    category: "beverages",
    price: 10.5,
    stock: 75,
    unit: "un",
  },
]

