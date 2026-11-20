import { cn } from "@/lib/cn"
import { Wifi } from "lucide-react"
import {
  detectCardBrand,
  type CardBrand,
  type CardTheme,
} from "./credit-card-types"

export interface InteractiveCreditCardProps {
  number: string
  holderName: string
  expiry: string
  cvv: string
  isFlipped?: boolean
  theme?: CardTheme
  brand?: CardBrand
  className?: string
}

export function InteractiveCreditCard({
  number,
  holderName,
  expiry,
  cvv,
  isFlipped = false,
  theme = "midnight",
  brand: forcedBrand,
  className,
}: InteractiveCreditCardProps) {
  const detectedBrand = forcedBrand || detectCardBrand(number)

  // Mascara número: se vazio ou incompleto, exibe placeholders '•••• •••• •••• ••••'
  const displayCardNumber = () => {
    if (!number.trim()) {
      return "•••• •••• •••• ••••"
    }
    const clean = number.replace(/\D/g, "")
    // Se for menos de 16 caracteres, preenche com bullet dots
    const padded = clean.padEnd(16, "•")
    const matches = padded.match(/.{1,4}/g)
    return matches ? matches.join(" ") : padded
  }

  const displayHolder = holderName.trim()
    ? holderName.toUpperCase()
    : "NOME DO TITULAR"

  const displayExpiry = expiry.trim() ? expiry : "MM/AA"
  const displayCvv = cvv.trim() ? cvv : "•••"

  // Estilos de gradiente por tema
  const themeGradients: Record<CardTheme, string> = {
    midnight: "from-neutral-900 via-neutral-800 to-black text-white border-neutral-700/60",
    emerald: "from-emerald-950 via-emerald-900 to-neutral-950 text-white border-emerald-700/60",
    violet: "from-violet-950 via-purple-900 to-neutral-950 text-white border-purple-700/60",
    platinum: "from-slate-700 via-neutral-600 to-slate-800 text-white border-slate-500/60",
    rose_gold: "from-rose-950 via-rose-900 to-neutral-900 text-white border-rose-700/60",
  }

  // Render do Logo da Bandeira
  const renderBrandLogo = () => {
    switch (detectedBrand) {
      case "visa":
        return (
          <span className="font-sans font-black italic tracking-tighter text-xl text-white select-none">
            VISA
          </span>
        )
      case "mastercard":
        return (
          <div className="flex items-center -space-x-2 select-none">
            <div className="h-6 w-6 rounded-full bg-red-600 opacity-90 shadow-xs" />
            <div className="h-6 w-6 rounded-full bg-amber-500 opacity-90 shadow-xs" />
          </div>
        )
      case "elo":
        return (
          <div className="flex items-center gap-1 select-none font-bold text-lg tracking-tight">
            <span className="text-amber-400">e</span>
            <span className="text-cyan-400">l</span>
            <span className="text-red-500">o</span>
          </div>
        )
      case "amex":
        return (
          <div className="rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-extrabold tracking-widest text-white uppercase select-none">
            AMEX
          </div>
        )
      case "hipercard":
        return (
          <div className="rounded bg-red-700 px-1.5 py-0.5 text-[10px] font-bold text-white uppercase select-none">
            HIPER
          </div>
        )
      default:
        return (
          <div className="h-6 w-10 rounded border border-white/20 bg-white/10 flex items-center justify-center text-[9px] font-mono text-white/70">
            CARD
          </div>
        )
    }
  }

  return (
    <div
      className={cn(
        "relative w-full max-w-[340px] sm:max-w-[380px] aspect-[1.586/1] mx-auto select-none",
        "perspective-[1000px]",
        className
      )}
    >
      {/* Container de rotação 3D */}
      <div
        className={cn(
          "relative h-full w-full rounded-2xl shadow-xl transition-transform duration-500",
          "transform-style-preserve-3d",
          isFlipped ? "rotate-y-180" : "rotate-y-0"
        )}
      >
        {/* ============================================================ */}
        {/* FRENTE DO CARTÃO                                             */}
        {/* ============================================================ */}
        <div
          className={cn(
            "absolute inset-0 flex flex-col justify-between p-5 sm:p-6 rounded-2xl border shadow-lg overflow-hidden",
            "bg-gradient-to-br backface-hidden",
            themeGradients[theme]
          )}
        >
          {/* Reflexo luminoso decorativo */}
          <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-white/10 blur-2xl" />

          {/* Topo da Frente: Chip EMV + Contactless + Logo da Bandeira */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* Chip metálico dourado */}
              <div className="relative h-7 w-9 sm:h-8 sm:w-11 rounded-md bg-gradient-to-br from-amber-200 via-amber-400 to-yellow-600 shadow-inner overflow-hidden border border-amber-600/40">
                {/* Linhas de circuito do chip */}
                <div className="absolute inset-x-1 top-2.5 h-px bg-amber-800/40" />
                <div className="absolute inset-x-1 bottom-2.5 h-px bg-amber-800/40" />
                <div className="absolute inset-y-1 left-3 w-px bg-amber-800/40" />
              </div>

              {/* Ícone de Contactless */}
              <Wifi className="h-4 w-4 rotate-90 text-white/80 opacity-80" />
            </div>

            {/* Logo da Bandeira */}
            <div>{renderBrandLogo()}</div>
          </div>

          {/* Centro: Número do Cartão */}
          <div className="my-auto py-1">
            <div className="font-mono text-base sm:text-xl font-bold tracking-[0.18em] text-white/95 drop-shadow-sm truncate">
              {displayCardNumber()}
            </div>
          </div>

          {/* Rodapé da Frente: Titular e Validade */}
          <div className="flex items-end justify-between pt-1">
            <div className="max-w-[70%]">
              <span className="block text-[9px] font-semibold tracking-wider text-white/60 uppercase">
                Titular do Cartão
              </span>
              <span className="block font-mono text-xs sm:text-sm font-bold text-white tracking-wider truncate">
                {displayHolder}
              </span>
            </div>

            <div className="text-right">
              <span className="block text-[9px] font-semibold tracking-wider text-white/60 uppercase">
                Validade
              </span>
              <span className="block font-mono text-xs sm:text-sm font-bold text-white tracking-wider">
                {displayExpiry}
              </span>
            </div>
          </div>
        </div>

        {/* ============================================================ */}
        {/* VERSO DO CARTÃO (Giro 180deg)                                 */}
        {/* ============================================================ */}
        <div
          className={cn(
            "absolute inset-0 flex flex-col justify-between py-5 sm:py-6 rounded-2xl border shadow-lg overflow-hidden",
            "bg-gradient-to-br rotate-y-180 backface-hidden",
            themeGradients[theme]
          )}
        >
          {/* Tarja magnética escura */}
          <div className="h-10 sm:h-11 w-full bg-black/90 shadow-inner -mt-1" />

          {/* Painel de Assinatura e CVV */}
          <div className="px-5 sm:px-6 space-y-1">
            <div className="flex items-center justify-between text-[9px] text-white/70 font-semibold uppercase">
              <span>Assinatura Autorizada</span>
              <span>Código CVV</span>
            </div>

            <div className="flex items-center rounded bg-neutral-200 overflow-hidden shadow-inner h-8">
              {/* Padrão de segurança de assinatura */}
              <div className="flex-1 h-full bg-gradient-to-r from-neutral-200 via-neutral-100 to-neutral-200 opacity-90 px-3 flex items-center">
                <span className="text-[10px] font-serif italic text-neutral-500 select-none">
                  Assinatura não necessária
                </span>
              </div>

              {/* Caixa do Código de Segurança */}
              <div className="w-14 h-full bg-white flex items-center justify-center border-l border-neutral-300 font-mono text-xs font-bold text-neutral-900 tracking-wider">
                {displayCvv}
              </div>
            </div>
          </div>

          {/* Rodapé do Verso: Info & Brand */}
          <div className="px-5 sm:px-6 flex items-center justify-between text-[9px] text-white/60">
            <p className="max-w-[70%] leading-tight text-[8px] sm:text-[9px]">
              Este cartão é pessoal e intransferível. O uso deste cartão está sujeito aos termos do emissor.
            </p>
            <div className="scale-75 origin-right">{renderBrandLogo()}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

