import { useState, type FormEvent } from "react"
import { Building2, Globe } from "lucide-react"
import { Button } from "../ui/button"
import { Input } from "../ui/input"
import { Label } from "../ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select"
import { type PlanTier, type BillingCycle, type TenantCompany } from "./internal-admin-types"

interface NewTenantDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreateTenant: (tenantData: Partial<TenantCompany>) => void
}

export function NewTenantDialog({
  open,
  onOpenChange,
  onCreateTenant,
}: NewTenantDialogProps) {
  const [name, setName] = useState("")
  const [legalName, setLegalName] = useState("")
  const [document, setDocument] = useState("")
  const [subdomain, setSubdomain] = useState("")
  const [plan, setPlan] = useState<PlanTier>("pro")
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("monthly")
  const [ownerName, setOwnerName] = useState("")
  const [ownerEmail, setOwnerEmail] = useState("")

  // Sugere subdomínio automaticamente a partir do nome
  const handleNameChange = (val: string) => {
    setName(val)
    if (!subdomain || subdomain === name.toLowerCase().replace(/[^a-z0-9]/g, "")) {
      const slug = val
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
      setSubdomain(slug)
    }
  }

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !subdomain.trim() || !ownerEmail.trim()) return

    const planMrrMap: Record<PlanTier, number> = {
      starter: 490.0,
      pro: 1290.0,
      enterprise: 4890.0,
      custom: 7500.0,
    }

    onCreateTenant({
      name: name.trim(),
      legalName: legalName.trim() || name.trim(),
      document: document.trim() || "00.000.000/0001-00",
      subdomain: subdomain.trim().toLowerCase(),
      plan,
      billingCycle,
      mrr: planMrrMap[plan],
      ownerName: ownerName.trim() || "Administrador",
      ownerEmail: ownerEmail.trim().toLowerCase(),
      status: "active",
      createdAt: new Date().toISOString(),
      quota: {
        seatsUsed: 1,
        seatsTotal: plan === "enterprise" ? 50 : plan === "pro" ? 15 : 5,
        storageUsedGb: 1,
        storageTotalGb: plan === "enterprise" ? 500 : plan === "pro" ? 150 : 50,
        apiCallsMonthly: 0,
        apiCallsTotal: plan === "enterprise" ? 1000000 : plan === "pro" ? 300000 : 100000,
      },
      activeModules: plan === "enterprise" ? ["Multi-filiais", "API Connect", "SSO SAML"] : ["Multi-filiais"],
      pendingAlerts: [],
      invoices: [],
    })

    // Limpa estado
    setName("")
    setLegalName("")
    setDocument("")
    setSubdomain("")
    setOwnerName("")
    setOwnerEmail("")
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto overscroll-contain p-6 sm:max-w-xl">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold text-foreground flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              Cadastrar Nova Empresa (Tenant)
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Preencha os dados cadastrais, plano e subdomínio dedicado da nova organização cliente.
            </DialogDescription>
          </DialogHeader>

          {/* Grid de 2 Colunas */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3.5 py-1">
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="tenant-name" className="text-xs font-medium text-foreground">
                Nome Fantasia da Empresa *
              </Label>
              <Input
                id="tenant-name"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="Ex: NovaTech Soluções Digitais"
                className="h-9 w-full text-xs"
                required
                autoFocus
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tenant-legal-name" className="text-xs font-medium text-foreground">
                Razão Social
              </Label>
              <Input
                id="tenant-legal-name"
                value={legalName}
                onChange={(e) => setLegalName(e.target.value)}
                placeholder="Ex: NovaTech Logística Ltda"
                className="h-9 w-full text-xs"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tenant-document" className="text-xs font-medium text-foreground">
                CNPJ da Empresa
              </Label>
              <Input
                id="tenant-document"
                value={document}
                onChange={(e) => setDocument(e.target.value)}
                placeholder="00.000.000/0001-00"
                className="h-9 w-full text-xs font-mono"
              />
            </div>

            {/* Subdomínio com preview */}
            <div className="flex flex-col gap-1.5 sm:col-span-2">
              <Label htmlFor="tenant-subdomain" className="text-xs font-medium text-foreground">
                Subdomínio Dedicado *
              </Label>
              <div className="relative w-full">
                <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <Input
                  id="tenant-subdomain"
                  value={subdomain}
                  onChange={(e) => setSubdomain(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                  placeholder="empresa"
                  className="pl-8 pr-24 h-9 w-full text-xs font-mono"
                  required
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-mono text-muted-foreground pointer-events-none">
                  .atlas.app
                </span>
              </div>
            </div>

            {/* Plano e Ciclo */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tenant-plan" className="text-xs font-medium text-foreground">
                Plano Contratado *
              </Label>
              <Select value={plan} onValueChange={(val) => setPlan(val as PlanTier)}>
                <SelectTrigger id="tenant-plan" className="h-9 w-full text-xs">
                  <SelectValue placeholder="Selecione o plano" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="starter">Starter (R$ 490/mês)</SelectItem>
                  <SelectItem value="pro">Pro (R$ 1.290/mês)</SelectItem>
                  <SelectItem value="enterprise">Enterprise (R$ 4.890/mês)</SelectItem>
                  <SelectItem value="custom">Custom / Corporativo</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tenant-billing" className="text-xs font-medium text-foreground">
                Ciclo de Faturamento *
              </Label>
              <Select value={billingCycle} onValueChange={(val) => setBillingCycle(val as BillingCycle)}>
                <SelectTrigger id="tenant-billing" className="h-9 w-full text-xs">
                  <SelectValue placeholder="Ciclo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">Mensal</SelectItem>
                  <SelectItem value="yearly">Anual (com desconto)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Administrador Responsável */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tenant-owner-name" className="text-xs font-medium text-foreground">
                Nome do Responsável *
              </Label>
              <Input
                id="tenant-owner-name"
                value={ownerName}
                onChange={(e) => setOwnerName(e.target.value)}
                placeholder="Ex: Carlos Silva"
                className="h-9 w-full text-xs"
                required
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tenant-owner-email" className="text-xs font-medium text-foreground">
                E-mail do Administrador *
              </Label>
              <Input
                id="tenant-owner-email"
                type="email"
                value={ownerEmail}
                onChange={(e) => setOwnerEmail(e.target.value)}
                placeholder="admin@empresa.com.br"
                className="h-9 w-full text-xs"
                required
              />
            </div>
          </div>

          <DialogFooter className="mt-4 flex flex-row items-center justify-end gap-3 sm:space-x-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancelar
            </Button>

            <Button
              type="submit"
              disabled={!name.trim() || !subdomain.trim() || !ownerEmail.trim()}
            >
              Criar Tenant
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

