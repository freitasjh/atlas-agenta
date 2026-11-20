export type CardBrand = "visa" | "mastercard" | "elo" | "amex" | "hipercard" | "unknown"

export type CardTheme = "midnight" | "emerald" | "violet" | "platinum" | "rose_gold"

export interface CreditCardData {
  number: string
  holderName: string
  expiry: string
  cvv: string
  nickname?: string
  isDefault?: boolean
  theme?: CardTheme
}

export interface SavedCardItem {
  id: string
  brand: CardBrand
  last4: string
  holderName: string
  expiryMonth: string
  expiryYear: string
  nickname?: string
  isDefault: boolean
  isExpired: boolean
  theme: CardTheme
  createdAt: string
}

/**
 * Detecta a bandeira do cartão com base no BIN inicial
 */
export function detectCardBrand(number: string): CardBrand {
  const clean = number.replace(/\D/g, "")
  if (!clean) return "unknown"

  // Elo (BINs comuns no Brasil: 401178, 438935, 451416, 457631, 504175, 627780, 636297, 636368, 5067, 4576, 4011)
  if (
    /^(4011(78|79)|431274|438935|451416|457393|457631|457632|504175|627780|636297|636368|506699|5067[0-7][0-9]|509[0-9]{3})/.test(
      clean
    )
  ) {
    return "elo"
  }

  // Hipercard (prefixos 606282 ou 3841)
  if (/^(606282|3841)/.test(clean)) {
    return "hipercard"
  }

  // Visa (começa com 4)
  if (/^4/.test(clean)) {
    return "visa"
  }

  // Mastercard (51 a 55 ou 2221 a 2720)
  if (/^(5[1-5]|222[1-9]|22[3-9]|2[3-6]|27[0-1]|2720)/.test(clean)) {
    return "mastercard"
  }

  // American Express (34 ou 37)
  if (/^3[47]/.test(clean)) {
    return "amex"
  }

  return "unknown"
}

/**
 * Formata o número com espaçamento a cada 4 dígitos (ou 4-6-5 para Amex)
 */
export function formatCardNumber(val: string): string {
  const clean = val.replace(/\D/g, "").slice(0, 16)
  const brand = detectCardBrand(clean)

  if (brand === "amex") {
    // 4 - 6 - 5
    const p1 = clean.slice(0, 4)
    const p2 = clean.slice(4, 10)
    const p3 = clean.slice(10, 15)
    return [p1, p2, p3].filter(Boolean).join(" ")
  }

  // 4 - 4 - 4 - 4
  const matches = clean.match(/.{1,4}/g)
  return matches ? matches.join(" ") : clean
}

/**
 * Formata a data de expiração como MM/AA
 */
export function formatExpiry(val: string): string {
  const clean = val.replace(/\D/g, "").slice(0, 4)
  if (clean.length >= 3) {
    return `${clean.slice(0, 2)}/${clean.slice(2, 4)}`
  }
  return clean
}

/**
 * Validação do Algoritmo de Luhn
 */
export function validateLuhn(numberStr: string): boolean {
  const clean = numberStr.replace(/\D/g, "")
  if (clean.length < 13 || clean.length > 19) return false

  let sum = 0
  let isAlternate = false

  for (let i = clean.length - 1; i >= 0; i--) {
    let digit = parseInt(clean.charAt(i), 10)

    if (isAlternate) {
      digit *= 2
      if (digit > 9) {
        digit -= 9
      }
    }

    sum += digit
    isAlternate = !isAlternate
  }

  return sum % 10 === 0
}

/**
 * Verifica se a data de validade é futura
 */
export function isExpiryValid(expiry: string): boolean {
  if (!/^\d{2}\/\d{2}$/.test(expiry)) return false
  const [mmStr, yyStr] = expiry.split("/")
  const mm = parseInt(mmStr, 10)
  const yy = parseInt(`20${yyStr}`, 10)

  if (mm < 1 || mm > 12) return false

  const now = new Date()
  const currentYear = now.getFullYear()
  const currentMonth = now.getMonth() + 1

  if (yy < currentYear) return false
  if (yy === currentYear && mm < currentMonth) return false
  return true
}

export const MOCK_SAVED_CARDS: SavedCardItem[] = [
  {
    id: "card-01",
    brand: "mastercard",
    last4: "8492",
    holderName: "JOAO SILVA",
    expiryMonth: "08",
    expiryYear: "29",
    nickname: "Cartão Principal Nubank",
    isDefault: true,
    isExpired: false,
    theme: "violet",
    createdAt: "2026-01-10",
  },
  {
    id: "card-02",
    brand: "visa",
    last4: "3104",
    holderName: "JOAO SILVA",
    expiryMonth: "11",
    expiryYear: "28",
    nickname: "Itaú Corporate Black",
    isDefault: false,
    isExpired: false,
    theme: "midnight",
    createdAt: "2026-03-15",
  },
  {
    id: "card-03",
    brand: "elo",
    last4: "7721",
    holderName: "JOAO SILVA",
    expiryMonth: "04",
    expiryYear: "25",
    nickname: "Bradesco Elo Nanquim",
    isDefault: false,
    isExpired: true,
    theme: "emerald",
    createdAt: "2024-04-01",
  },
]

