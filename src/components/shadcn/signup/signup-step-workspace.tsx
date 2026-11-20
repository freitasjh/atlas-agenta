import { useState } from "react"
import { ArrowLeft, ArrowRight, Users, Briefcase } from "lucide-react"
import { Button } from "@/components/shadcn/ui/button"
import { Input } from "@/components/shadcn/ui/input"
import { Label } from "@/components/shadcn/ui/label"
import { cn } from "@/lib/cn"
import type { SignupWorkspaceData, TeamSize, UserRole } from "./signup-types"

interface SignupStepWorkspaceProps {
  initialData: SignupWorkspaceData
  onNext: (data: SignupWorkspaceData) => void
  onBack: () => void
}

export function SignupStepWorkspace({
  initialData,
  onNext,
  onBack,
}: SignupStepWorkspaceProps) {
  const [companyName, setCompanyName] = useState(initialData.companyName)
  const [workspaceSlug, setWorkspaceSlug] = useState(initialData.workspaceSlug)
  const [teamSize, setTeamSize] = useState<TeamSize>(initialData.teamSize || "2-10")
  const [role, setRole] = useState<UserRole>(initialData.role || "engineering")

  const handleCompanyNameChange = (val: string) => {
    setCompanyName(val)
    // Gera slug limpo
    const generatedSlug = val
      .toLowerCase()
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 24)
    setWorkspaceSlug(generatedSlug)
  }

  const teamSizeOptions: { value: TeamSize; label: string; desc: string }[] = [
    { value: "solo", label: "Apenas eu", desc: "Uso individual" },
    { value: "2-10", label: "2 a 10", desc: "Pequena equipe" },
    { value: "11-50", label: "11 a 50", desc: "Time em crescimento" },
    { value: "51-200", label: "51 a 200", desc: "Média empresa" },
    { value: "200+", label: "200+", desc: "Corporativo" },
  ]

  const roleOptions: { value: UserRole; label: string }[] = [
    { value: "engineering", label: "Engenharia / Desenvolvimento" },
    { value: "product", label: "Produto / Inovação" },
    { value: "design", label: "Design / UX" },
    { value: "marketing_sales", label: "Vendas / Marketing" },
    { value: "operations", label: "Operações / Projetos" },
    { value: "finance_exec", label: "Financeiro / Diretoria" },
    { value: "other", label: "Outro" },
  ]

  const isFormValid = companyName.trim().length >= 2 && workspaceSlug.trim().length >= 2

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!isFormValid) return
    onNext({
      companyName: companyName.trim(),
      workspaceSlug: workspaceSlug.trim(),
      teamSize,
      role,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Título de seção */}
      <div className="space-y-1">
        <h3 className="text-base font-bold tracking-tight text-foreground">
          Personalize seu Workspace
        </h3>
        <p className="text-xs text-muted-foreground">
          Configure a organização para sua equipe colaborar.
        </p>
      </div>

      {/* Nome da Empresa */}
      <div className="space-y-1.5">
        <Label htmlFor="company-name" className="text-xs font-semibold">
          Nome da Empresa ou Projeto
        </Label>
        <Input
          id="company-name"
          type="text"
          placeholder="Ex: Acme Inovações, Studio Beta"
          value={companyName}
          onChange={(e) => handleCompanyNameChange(e.target.value)}
          required
          autoFocus
          className="text-xs h-10 w-full"
        />
      </div>

      {/* URL do Workspace / Subdomínio */}
      <div className="space-y-1.5">
        <Label htmlFor="workspace-slug" className="text-xs font-semibold">
          Endereço do Workspace
        </Label>
        <div className="flex items-center rounded-lg border border-input bg-background overflow-hidden focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
          <Input
            id="workspace-slug"
            type="text"
            placeholder="minha-empresa"
            value={workspaceSlug}
            onChange={(e) => setWorkspaceSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
            className="border-none focus-visible:ring-0 text-xs h-9 px-3 rounded-none shadow-none font-mono"
          />
          <span className="bg-muted px-2.5 py-2 text-[11px] font-mono text-muted-foreground border-l border-border select-none shrink-0">
            .atlas.io
          </span>
        </div>
      </div>

      {/* Tamanho da Equipe (Cards Selecionáveis) */}
      <div className="space-y-2 pt-1">
        <Label className="text-xs font-semibold flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5 text-primary" />
          Quantas pessoas trabalharão neste espaço?
        </Label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {teamSizeOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setTeamSize(opt.value)}
              className={cn(
                "flex flex-col items-start p-2.5 rounded-xl border text-left transition-all cursor-pointer",
                teamSize === opt.value
                  ? "border-primary bg-primary/10 shadow-xs"
                  : "border-border/80 bg-card hover:bg-muted/50 hover:border-border"
              )}
            >
              <span className="text-xs font-bold text-foreground">{opt.label}</span>
              <span className="text-[10px] text-muted-foreground mt-0.5">{opt.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Cargo / Função Principal */}
      <div className="space-y-1.5 pt-1">
        <Label htmlFor="user-role" className="text-xs font-semibold flex items-center gap-1.5">
          <Briefcase className="h-3.5 w-3.5 text-primary" />
          Qual é o seu papel principal?
        </Label>
        <select
          id="user-role"
          value={role}
          onChange={(e) => setRole(e.target.value as UserRole)}
          className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs font-medium text-foreground focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20 h-10 cursor-pointer"
        >
          {roleOptions.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </div>

      {/* Botões de Ação */}
      <div className="flex items-center gap-2 pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={onBack}
          className="h-10 text-xs font-semibold gap-1.5"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Voltar
        </Button>
        <Button
          type="submit"
          disabled={!isFormValid}
          className="flex-1 h-10 text-xs font-semibold gap-2 shadow-xs"
        >
          <span>Continuar</span>
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </form>
  )
}
