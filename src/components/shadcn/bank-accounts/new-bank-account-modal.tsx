import { useState, useRef } from "react"
import {
  Building2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  DollarSign,
  ShieldCheck,
  Zap,
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
import { Input } from "@/components/shadcn/ui/input"
import {
  BANK_INSTITUTIONS,
  type BankAccount,
  type BankAccountType,
  type BankInstitutionCode,
} from "./bank-accounts-types"
import { toast } from "sonner"
import { cn } from "@/lib/cn"

interface NewBankAccountModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAddAccount: (account: BankAccount) => void
}

const INSTITUTION_OPTIONS: { code: BankInstitutionCode; label: string; compe: string }[] = [
  { code: "itau", label: "Itaú Unibanco", compe: "341" },
  { code: "bradesco", label: "Bradesco", compe: "237" },
  { code: "santander", label: "Santander", compe: "033" },
  { code: "bb", label: "Banco do Brasil", compe: "001" },
  { code: "nubank", label: "Nubank PJ", compe: "260" },
  { code: "inter", label: "Inter Empresas", compe: "077" },
  { code: "btg", label: "BTG Pactual Empresas", compe: "208" },
  { code: "caixa", label: "Caixa Econômica", compe: "104" },
  { code: "cora", label: "Cora Conta PJ", compe: "403" },
  { code: "mercadopago", label: "Mercado Pago Gateway", compe: "323" },
  { code: "stripe", label: "Stripe Payments", compe: "---" },
  { code: "cash", label: "Caixa Físico / Cofre", compe: "---" },
]

export function NewBankAccountModal({
  open,
  onOpenChange,
  onAddAccount,
}: NewBankAccountModalProps) {
  const [institution, setInstitution] = useState<BankInstitutionCode>("itau")
  const [accountType, setAccountType] = useState<BankAccountType>("checking")
  const [nickname, setNickname] = useState("")
  const [agency, setAgency] = useState("")
  const [accountNumber, setAccountNumber] = useState("")
  const [accountDigit, setAccountDigit] = useState("")
  const [initialBalance, setInitialBalance] = useState("")
  const [connectionMethod, setConnectionMethod] = useState<"open_finance" | "manual">("open_finance")
  const [isDefault, setIsDefault] = useState(false)

  const carouselRef = useRef<HTMLDivElement>(null)

  const scrollCarousel = (direction: "left" | "right") => {
    if (carouselRef.current) {
      const scrollAmount = direction === "left" ? -280 : 280
      carouselRef.current.scrollBy({ left: scrollAmount, behavior: "smooth" })
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!nickname.trim()) {
      toast.error("Informe um apelido para a conta.")
      return
    }

    const numBalance = parseFloat(initialBalance.replace(".", "").replace(",", ".")) || 0

    const newAcc: BankAccount = {
      id: `acc-${Date.now()}`,
      nickname: nickname.trim(),
      institution,
      type: accountType,
      agency: agency.trim() || "---",
      accountNumber: accountNumber.trim() || "00000",
      accountDigit: accountDigit.trim() || "0",
      currentBalance: numBalance,
      reconciledBalance: numBalance,
      blockedBalance: 0,
      isDefault,
      connectionStatus: connectionMethod === "open_finance" ? "connected" : "manual",
      lastSyncAt: connectionMethod === "open_finance" ? "Conectado agora" : "Manual",
    }

    onAddAccount(newAcc)
    toast.success(`Conta bancária "${newAcc.nickname}" adicionada com sucesso!`)
    onOpenChange(false)

    // Reseta formulário
    setNickname("")
    setAgency("")
    setAccountNumber("")
    setAccountDigit("")
    setInitialBalance("")
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full sm:max-w-2xl max-h-[92vh] flex flex-col p-0 gap-0 overflow-hidden">
        {/* Cabeçalho Fixo do Dialog */}
        <DialogHeader className="p-5 sm:p-6 pb-4 border-b border-border/70 shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20">
              <Building2 className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold text-foreground">
                Cadastrar Nova Conta Bancária
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                Adicione contas correntes, investimentos, carteiras digitais ou caixas físicos da empresa.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Formulário com Scroll Interno Limpo */}
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto overscroll-contain p-5 sm:p-6 space-y-5">
            {/* 1. Instituição Financeira com Carrossel Horizontal e Navegação Suave */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  Instituição Financeira / Banco
                  <span className="text-[11px] font-normal text-muted-foreground">(Selecione abaixo)</span>
                </label>

                {/* Controles de Navegação do Carrossel */}
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => scrollCarousel("left")}
                    className="h-7 w-7 rounded-lg border-border/70 hover:bg-muted"
                  >
                    <span className="sr-only">Rolar para esquerda</span>
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => scrollCarousel("right")}
                    className="h-7 w-7 rounded-lg border-border/70 hover:bg-muted"
                  >
                    <span className="sr-only">Rolar para direita</span>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              {/* Trilho do Carrossel */}
              <div
                ref={carouselRef}
                className="flex items-center gap-2.5 overflow-x-auto pb-1.5 pt-0.5 scrollbar-none snap-x"
                style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
              >
                {INSTITUTION_OPTIONS.map((inst) => {
                  const info = BANK_INSTITUTIONS[inst.code]
                  const isSelected = institution === inst.code
                  return (
                    <button
                      key={inst.code}
                      type="button"
                      onClick={() => {
                        setInstitution(inst.code)
                        if (!nickname || nickname.includes("•")) {
                          setNickname(`${info.name} • Operacional`)
                        }
                      }}
                      className={cn(
                        "group relative flex shrink-0 w-[170px] snap-start items-center gap-3 rounded-xl border p-2.5 text-left transition-all cursor-pointer shadow-xs",
                        isSelected
                          ? "border-primary bg-primary/10 ring-1 ring-primary/30"
                          : "border-border/80 bg-card hover:border-border hover:bg-muted/40"
                      )}
                    >
                      <div
                        className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold border shadow-2xs",
                          info.lightBg
                        )}
                      >
                        {info.iconInitials}
                      </div>
                      <div className="min-w-0 flex-1">
                        <span className="text-xs font-bold truncate block leading-tight text-foreground">
                          {inst.label}
                        </span>
                        <span className="text-[10px] text-muted-foreground font-mono">
                          COMPE: {inst.compe}
                        </span>
                      </div>
                      {isSelected && (
                        <div className="absolute right-2 top-2 h-2 w-2 rounded-full bg-primary" />
                      )}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 2. Grid de 2 Colunas: Tipo de Conta e Apelido */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground block">
                  Tipo de Conta *
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setAccountType("checking")}
                    className={cn(
                      "py-2 px-1.5 rounded-lg border text-xs text-center transition-all truncate",
                      accountType === "checking"
                        ? "border-primary bg-primary/10 text-primary font-bold shadow-2xs ring-1 ring-primary/20"
                        : "border-border/80 bg-card text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Corrente
                  </button>
                  <button
                    type="button"
                    onClick={() => setAccountType("investment")}
                    className={cn(
                      "py-2 px-1.5 rounded-lg border text-xs text-center transition-all truncate",
                      accountType === "investment"
                        ? "border-primary bg-primary/10 text-primary font-bold shadow-2xs ring-1 ring-primary/20"
                        : "border-border/80 bg-card text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Investimento
                  </button>
                  <button
                    type="button"
                    onClick={() => setAccountType("wallet")}
                    className={cn(
                      "py-2 px-1.5 rounded-lg border text-xs text-center transition-all truncate",
                      accountType === "wallet"
                        ? "border-primary bg-primary/10 text-primary font-bold shadow-2xs ring-1 ring-primary/20"
                        : "border-border/80 bg-card text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Carteira
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-foreground block">
                  Apelido da Conta *
                </label>
                <Input
                  type="text"
                  placeholder="Ex: Itaú • Operacional Matriz"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  className="h-9 text-xs w-full"
                  required
                />
              </div>
            </div>

            {/* 3. Grid de Agência, Conta, Dígito e Saldo Inicial */}
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3.5">
              <div className="sm:col-span-3 space-y-1.5">
                <label className="text-xs font-semibold text-foreground block">
                  Agência
                </label>
                <Input
                  type="text"
                  placeholder="0001"
                  value={agency}
                  onChange={(e) => setAgency(e.target.value)}
                  className="h-9 text-xs font-mono tabular-nums w-full"
                />
              </div>
              <div className="sm:col-span-4 space-y-1.5">
                <label className="text-xs font-semibold text-foreground block">
                  Número da Conta
                </label>
                <Input
                  type="text"
                  placeholder="12345"
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value)}
                  className="h-9 text-xs font-mono tabular-nums w-full"
                />
              </div>
              <div className="sm:col-span-2 space-y-1.5">
                <label className="text-xs font-semibold text-foreground block">
                  Dígito
                </label>
                <Input
                  type="text"
                  placeholder="0"
                  maxLength={2}
                  value={accountDigit}
                  onChange={(e) => setAccountDigit(e.target.value)}
                  className="h-9 text-xs font-mono tabular-nums text-center w-full"
                />
              </div>
              <div className="sm:col-span-3 space-y-1.5">
                <label className="text-xs font-semibold text-foreground block">
                  Saldo Inicial (R$)
                </label>
                <div className="relative w-full">
                  <DollarSign className="absolute inset-y-0 left-2.5 my-auto h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    type="text"
                    placeholder="0,00"
                    value={initialBalance}
                    onChange={(e) => setInitialBalance(e.target.value)}
                    className="pl-8 h-9 text-xs font-mono tabular-nums font-bold w-full"
                  />
                </div>
              </div>
            </div>

            {/* 4. Modo de Conexão & Sincronização */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground block">
                Sincronização & Extrato
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setConnectionMethod("open_finance")}
                  className={cn(
                    "p-3 rounded-xl border text-left transition-all cursor-pointer shadow-xs",
                    connectionMethod === "open_finance"
                      ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 ring-1 ring-emerald-500/30"
                      : "border-border/80 bg-card text-muted-foreground hover:text-foreground"
                  )}
                >
                  <div className="flex items-center gap-1.5 text-xs font-bold mb-1">
                    <Zap className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    <span>Open Finance (Automático)</span>
                  </div>
                  <span className="text-[11px] text-muted-foreground block leading-tight">
                    Sincronização diária contínua de extratos e saldos bancários.
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setConnectionMethod("manual")}
                  className={cn(
                    "p-3 rounded-xl border text-left transition-all cursor-pointer shadow-xs",
                    connectionMethod === "manual"
                      ? "border-primary bg-primary/10 text-primary ring-1 ring-primary/30"
                      : "border-border/80 bg-card text-muted-foreground hover:text-foreground"
                  )}
                >
                  <div className="flex items-center gap-1.5 text-xs font-bold mb-1">
                    <ShieldCheck className="h-4 w-4 text-primary" />
                    <span>Manual (Importação OFX)</span>
                  </div>
                  <span className="text-[11px] text-muted-foreground block leading-tight">
                    Importação manual de arquivos de extrato gerados pelo internet banking.
                  </span>
                </button>
              </div>
            </div>

            {/* 5. Conta Principal Checkbox */}
            <div className="flex items-center gap-2.5 pt-0.5">
              <input
                type="checkbox"
                id="isDefault"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary cursor-pointer"
              />
              <label htmlFor="isDefault" className="text-xs font-medium text-foreground cursor-pointer select-none">
                Definir como conta bancária principal da empresa
              </label>
            </div>
          </div>

          {/* Rodapé Fixo (Footer) — Sempre Visível, Sem Scroll Cortando Botões */}
          <DialogFooter className="p-4 sm:px-6 border-t border-border/70 bg-muted/20 shrink-0 flex flex-row items-center justify-end gap-3 sm:space-x-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              className="text-xs h-9 px-4"
            >
              Cancelar
            </Button>

            <Button
              type="submit"
              size="sm"
              className="text-xs font-bold h-9 px-4 gap-1.5 bg-primary text-primary-foreground"
            >
              <CheckCircle2 className="h-4 w-4" />
              <span>Salvar Conta Bancária</span>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
