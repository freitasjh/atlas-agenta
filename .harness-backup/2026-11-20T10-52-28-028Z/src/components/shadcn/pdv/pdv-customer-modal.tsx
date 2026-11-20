import { useState } from "react"
import {
  UserCheck,
  UserX,
  CreditCard,
  Mail,
  User,
  CheckCircle2,
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
import type { PDVCustomer } from "./pdv-types"
import { toast } from "sonner"

interface PDVCustomerModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentCustomer: PDVCustomer | null
  onSaveCustomer: (customer: PDVCustomer | null) => void
}

export function PDVCustomerModal({
  open,
  onOpenChange,
  currentCustomer,
  onSaveCustomer,
}: PDVCustomerModalProps) {
  const [cpfCnpj, setCpfCnpj] = useState<string>(currentCustomer?.cpfCnpj || "")
  const [name, setName] = useState<string>(currentCustomer?.name || "")
  const [email, setEmail] = useState<string>(currentCustomer?.email || "")

  const handleCpfMask = (val: string) => {
    // Remove não dígitos
    const clean = val.replace(/\D/g, "").slice(0, 14)
    if (clean.length <= 11) {
      // CPF: 000.000.000-00
      setCpfCnpj(
        clean
          .replace(/(\d{3})(\d)/, "$1.$2")
          .replace(/(\d{3})(\d)/, "$1.$2")
          .replace(/(\d{3})(\d{1,2})$/, "$1-$2")
      )
    } else {
      // CNPJ: 00.000.000/0000-00
      setCpfCnpj(
        clean
          .replace(/(\d{2})(\d)/, "$1.$2")
          .replace(/(\d{3})(\d)/, "$1.$2")
          .replace(/(\d{3})(\d)/, "$1/$2")
          .replace(/(\d{4})(\d{1,2})$/, "$1-$2")
      )
    }
  }

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault()
    const cleanNumbers = cpfCnpj.replace(/\D/g, "")

    if (cleanNumbers.length !== 11 && cleanNumbers.length !== 14) {
      toast.error("Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) válido.")
      return
    }

    onSaveCustomer({
      cpfCnpj,
      name: name.trim() || undefined,
      email: email.trim() || undefined,
    })

    toast.success("Consumidor identificado na NFC-e com sucesso!")
    onOpenChange(false)
  }

  const handleRemove = () => {
    onSaveCustomer(null)
    setCpfCnpj("")
    setName("")
    setEmail("")
    toast.info("Identificação de consumidor removida.")
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-full sm:max-w-[440px] max-h-[92vh] overflow-y-auto overscroll-contain p-5 sm:p-6">
        <DialogHeader className="text-left space-y-1">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <UserCheck className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold">
                CPF na Nota Fiscal (NFC-e)
              </DialogTitle>
              <DialogDescription className="text-xs">
                Identificação do consumidor para créditos e nota premiada [F3]
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSave} className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground block">
              CPF ou CNPJ do Cliente:
            </label>
            <div className="relative">
              <CreditCard className="absolute inset-y-0 left-3 my-auto h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="000.000.000-00"
                value={cpfCnpj}
                onChange={(e) => handleCpfMask(e.target.value)}
                className="pl-9 h-11 text-base font-mono font-bold bg-background border-border/80"
                autoFocus
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground block">
              Nome Completo (Opcional):
            </label>
            <div className="relative">
              <User className="absolute inset-y-0 left-3 my-auto h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Nome do cliente"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="pl-9 h-10 text-xs bg-background border-border/80"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-foreground block">
              E-mail para envio do DANFE NFC-e (Opcional):
            </label>
            <div className="relative">
              <Mail className="absolute inset-y-0 left-3 my-auto h-4 w-4 text-muted-foreground" />
              <Input
                type="email"
                placeholder="cliente@exemplo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="pl-9 h-10 text-xs bg-background border-border/80"
              />
            </div>
          </div>

          <DialogFooter className="border-t border-border/60 pt-3 flex items-center justify-between">
            {currentCustomer ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleRemove}
                className="text-xs text-destructive hover:bg-destructive/10"
              >
                <UserX className="h-3.5 w-3.5 mr-1" />
                Remover CPF
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
                className="text-xs font-semibold"
              >
                Cancelar
              </Button>
            )}

            <Button
              type="submit"
              className="text-xs font-bold gap-1.5 bg-primary text-primary-foreground"
            >
              <CheckCircle2 className="h-4 w-4" />
              <span>Salvar Consumidor</span>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

