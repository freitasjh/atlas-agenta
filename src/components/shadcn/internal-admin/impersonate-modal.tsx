import { ShieldAlert, ExternalLink, UserCheck } from "lucide-react"
import { Button } from "../ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog"
import { type TenantCompany } from "./internal-admin-types"

interface ImpersonateModalProps {
  tenant: TenantCompany | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirmImpersonate: (tenant: TenantCompany) => void
}

export function ImpersonateModal({
  tenant,
  open,
  onOpenChange,
  onConfirmImpersonate,
}: ImpersonateModalProps) {
  if (!tenant) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg font-bold text-foreground flex items-center gap-2 text-amber-600 dark:text-amber-400">
            <ShieldAlert className="h-5 w-5" />
            Acesso Impersonado de Super-Admin
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Você está prestes a entrar diretamente no ambiente operacional desta empresa com privilégios de Administrador Geral.
          </DialogDescription>
        </DialogHeader>

        <div className="rounded-lg bg-muted/40 border border-border p-4 space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-foreground text-sm">{tenant.name}</span>
            <span className="font-mono text-muted-foreground">.{tenant.subdomain}.atlas.app</span>
          </div>
          <div className="space-y-1 text-muted-foreground">
            <p>Responsável: <strong className="text-foreground">{tenant.ownerName}</strong> ({tenant.ownerEmail})</p>
            <p>Plano Atual: <strong className="text-foreground uppercase">{tenant.plan}</strong> ({tenant.billingCycle})</p>
          </div>
        </div>

        <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 text-xs text-amber-800 dark:text-amber-300 space-y-1">
          <p className="font-semibold flex items-center gap-1.5">
            <UserCheck className="h-4 w-4" />
            Rastreabilidade e Segurança:
          </p>
          <p className="text-[11px] leading-relaxed">
            Esta sessão será gravada de forma imutável nos logs de auditoria do sistema. A empresa poderá visualizar que uma ação de suporte técnico foi executada por você.
          </p>
        </div>

        <DialogFooter className="gap-3 sm:gap-3 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>

          <Button
            type="button"
            onClick={() => {
              onConfirmImpersonate(tenant)
              onOpenChange(false)
            }}
            className="gap-1.5 bg-amber-600 hover:bg-amber-700 text-white"
          >
            <ExternalLink className="h-4 w-4" />
            Iniciar Sessão Impersonada
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

