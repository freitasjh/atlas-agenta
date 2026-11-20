import { 
  Building2, 
  Plus, 
  Search, 
  Download, 
  RotateCw
} from "lucide-react"
import { Button } from "../ui/button"
import { Input } from "../ui/input"

interface InternalAdminHeaderProps {
  searchQuery: string
  onSearchChange: (query: string) => void
  onOpenNewTenant: () => void
  onExportReport: () => void
  onRefresh: () => void
  isRefreshing?: boolean
}

export function InternalAdminHeader({
  searchQuery,
  onSearchChange,
  onOpenNewTenant,
  onExportReport,
  onRefresh,
  isRefreshing = false,
}: InternalAdminHeaderProps) {
  return (
    <div className="flex flex-col gap-4 border-b border-border/70 pb-5">
      {/* Linha 1: Título e Ações Principais */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary font-bold text-xs">
              <Building2 className="h-4 w-4" />
            </span>
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Super Admin SaaS • Multi-Tenant
            </span>
          </div>
          <h1 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">
            Controle de Empresas & Assinaturas
          </h1>
          <p className="text-xs text-muted-foreground">
            Gestão global de clientes corporativos, alocação de quotas de uso, faturamento e acesso impersonado.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="h-9 px-2.5 text-xs gap-1.5"
            title="Atualizar dados de uso e planos"
          >
            <RotateCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin text-primary" : ""}`} />
            <span className="hidden sm:inline">Sincronizar</span>
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onExportReport}
            className="h-9 px-3 text-xs gap-1.5"
          >
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">Exportar Relatório</span>
          </Button>

          <Button
            type="button"
            size="sm"
            onClick={onOpenNewTenant}
            className="h-9 px-3.5 text-xs gap-1.5 shadow-sm font-medium"
          >
            <Plus className="h-4 w-4" />
            Nova Empresa (Tenant)
          </Button>
        </div>
      </div>

      {/* Linha 2: Busca por Subdomínio / Empresa / CNPJ */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-1">
        <div className="relative w-full sm:max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Buscar por Empresa, subdomínio (.atlas.app), CNPJ ou e-mail..."
            className="pl-8 text-xs h-9 w-full font-mono placeholder:font-sans"
          />
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto text-[11px] text-muted-foreground">
          <span>Pesquisa rápida:</span>
          <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground opacity-100">
            Ctrl + K
          </kbd>
        </div>
      </div>
    </div>
  )
}
