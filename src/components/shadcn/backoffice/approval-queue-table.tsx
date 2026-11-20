import { useState } from "react"
import { 
  MoreVertical, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  UserCheck, 
  Eye, 
  Building2, 
  User 
} from "lucide-react"
import { Button } from "../ui/button"
import { Checkbox } from "../ui/checkbox"
import { Badge } from "../ui/badge"
import { Avatar, AvatarFallback } from "../ui/avatar"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select"
import { 
  type QueueCase, 
  type CaseCategory, 
  type RiskLevel,
  formatCurrencyBRL 
} from "./backoffice-types"

interface ApprovalQueueTableProps {
  cases: QueueCase[]
  selectedCaseIds: string[]
  onSelectAll: (checked: boolean) => void
  onSelectCase: (caseId: string, checked: boolean) => void
  onOpenInspector: (queueCase: QueueCase) => void
  onQuickApprove: (queueCase: QueueCase) => void
  onQuickReject: (queueCase: QueueCase) => void
  onAssignToMe: (caseId: string) => void
  onBatchApprove: () => void
  onBatchAssign: () => void
}

export function ApprovalQueueTable({
  cases,
  selectedCaseIds,
  onSelectAll,
  onSelectCase,
  onOpenInspector,
  onQuickApprove,
  onQuickReject,
  onAssignToMe,
  onBatchApprove,
  onBatchAssign,
}: ApprovalQueueTableProps) {
  const [activeTab, setActiveTab] = useState<CaseCategory | "all">("all")
  const [riskFilter, setRiskFilter] = useState<RiskLevel | "all">("all")
  const [assignmentFilter, setAssignmentFilter] = useState<"all" | "unassigned" | "mine">("all")

  // Filtragem dos casos
  const filteredCases = cases.filter((c) => {
    if (activeTab !== "all" && c.category !== activeTab) return false
    if (riskFilter !== "all" && c.riskLevel !== riskFilter) return false
    if (assignmentFilter === "unassigned" && c.assignedTo) return false
    if (assignmentFilter === "mine" && c.assignedTo?.id !== "op-1") return false
    return true
  })

  const allSelected = filteredCases.length > 0 && selectedCaseIds.length === filteredCases.length
  const someSelected = selectedCaseIds.length > 0 && selectedCaseIds.length < filteredCases.length

  const tabs: { key: CaseCategory | "all"; label: string; count: number }[] = [
    { key: "all", label: "Todos os Casos", count: cases.length },
    { key: "fraud_alert", label: "Risco & Fraude", count: cases.filter((c) => c.category === "fraud_alert").length },
    { key: "kyc", label: "KYC & Documentos", count: cases.filter((c) => c.category === "kyc").length },
    { key: "chargeback", label: "Disputas & Estornos", count: cases.filter((c) => c.category === "chargeback").length },
    { key: "limit_increase", label: "Limites Pix/TED", count: cases.filter((c) => c.category === "limit_increase").length },
  ]

  const categoryBadgeMap = {
    fraud_alert: { label: "Fraude", class: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20" },
    kyc: { label: "KYC", class: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20" },
    chargeback: { label: "Disputa", class: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20" },
    limit_increase: { label: "Limite", class: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20" },
  }

  return (
    <div className="space-y-4">
      {/* Abas Superiores de Filtro por Categoria */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border/80 pb-3">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
          {tabs.map((tab) => (
            <Button
              key={tab.key}
              type="button"
              variant={activeTab === tab.key ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setActiveTab(tab.key)}
              className={`h-8 px-3 text-xs gap-1.5 rounded-lg ${
                activeTab === tab.key
                  ? "bg-primary text-primary-foreground hover:bg-primary/90 font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <span>{tab.label}</span>
              <span className={`text-[10px] rounded-full px-1.5 py-0.2 ${
                activeTab === tab.key
                  ? "bg-primary-foreground/20 text-primary-foreground"
                  : "bg-muted text-muted-foreground"
              }`}>
                {tab.count}
              </span>
            </Button>
          ))}
        </div>

        {/* Filtros Dropdown Rápidos */}
        <div className="flex items-center gap-2 self-end sm:self-auto">
          {/* Filtro de Risco */}
          <div className="w-32">
            <Select
              value={riskFilter}
              onValueChange={(val) => setRiskFilter(val as RiskLevel | "all")}
            >
              <SelectTrigger className="h-8 text-xs w-full">
                <SelectValue placeholder="Risco" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os Riscos</SelectItem>
                <SelectItem value="critical">Crítico (≥ 80)</SelectItem>
                <SelectItem value="medium">Médio (50-79)</SelectItem>
                <SelectItem value="low">Baixo (&lt; 50)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Filtro de Atribuição */}
          <div className="w-36">
            <Select
              value={assignmentFilter}
              onValueChange={(val) => setAssignmentFilter(val as "all" | "unassigned" | "mine")}
            >
              <SelectTrigger className="h-8 text-xs w-full">
                <SelectValue placeholder="Atribuição" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas as Atribuições</SelectItem>
                <SelectItem value="mine">Atribuídos a Mim</SelectItem>
                <SelectItem value="unassigned">Fila Não Atribuída</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Barra de Ações em Lote */}
      {selectedCaseIds.length > 0 && (
        <div className="flex items-center justify-between rounded-xl bg-primary/10 border border-primary/20 px-4 py-2.5 text-xs animate-in fade-in-50 duration-200">
          <div className="flex items-center gap-2">
            <Badge variant="default" className="text-xs h-5 px-2">
              {selectedCaseIds.length}
            </Badge>
            <span className="font-medium text-foreground">
              {selectedCaseIds.length === 1 ? "caso selecionado na esteira" : "casos selecionados na esteira"}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onBatchAssign}
              className="h-8 text-xs gap-1.5 bg-background"
            >
              <UserCheck className="h-3.5 w-3.5" />
              Atribuir a Mim
            </Button>

            <Button
              type="button"
              size="sm"
              onClick={onBatchApprove}
              className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              Aprovar em Lote
            </Button>
          </div>
        </div>
      )}

      {/* Tabela de Casos */}
      <div className="rounded-xl border border-border/80 bg-card overflow-hidden shadow-2xs">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10 pl-4">
                <Checkbox
                  checked={allSelected ? true : someSelected ? "indeterminate" : false}
                  onCheckedChange={(checked) => onSelectAll(!!checked)}
                  aria-label="Selecionar todos os casos"
                />
              </TableHead>
              <TableHead className="w-36 font-semibold text-xs">Protocolo / Tipo</TableHead>
              <TableHead className="min-w-[220px] font-semibold text-xs">Proponente / Solicitante</TableHead>
              <TableHead className="w-32 font-semibold text-xs">Score de Risco</TableHead>
              <TableHead className="w-32 font-semibold text-xs">Valor da Operação</TableHead>
              <TableHead className="w-36 font-semibold text-xs">Prazo de SLA</TableHead>
              <TableHead className="w-40 font-semibold text-xs">Analista</TableHead>
              <TableHead className="w-12 pr-4 text-right"></TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {filteredCases.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-32 text-center text-sm text-muted-foreground">
                  Nenhum caso operacional pendente com os filtros selecionados.
                </TableCell>
              </TableRow>
            ) : (
              filteredCases.map((c) => {
                const isSelected = selectedCaseIds.includes(c.id)
                const badgeInfo = categoryBadgeMap[c.category]

                return (
                  <TableRow
                    key={c.id}
                    data-state={isSelected ? "selected" : undefined}
                    className="group hover:bg-muted/40 transition-colors cursor-pointer"
                    onClick={() => onOpenInspector(c)}
                  >
                    <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={(checked) => onSelectCase(c.id, !!checked)}
                        aria-label={`Selecionar caso ${c.protocolNumber}`}
                      />
                    </TableCell>

                    {/* Protocolo e Categoria */}
                    <TableCell>
                      <div className="space-y-0.5">
                        <span className="font-mono font-semibold text-xs text-foreground group-hover:text-primary transition-colors">
                          {c.protocolNumber}
                        </span>
                        <div>
                          <Badge variant="outline" className={`text-[10px] py-0 px-1.5 h-4 ${badgeInfo.class}`}>
                            {badgeInfo.label}
                          </Badge>
                        </div>
                      </div>
                    </TableCell>

                    {/* Cliente e Documento */}
                    <TableCell>
                      <div className="space-y-0.5">
                        <p className="font-medium text-xs text-foreground truncate max-w-xs md:max-w-sm">
                          {c.customerName}
                        </p>
                        <p className="text-[11px] text-muted-foreground font-mono flex items-center gap-1">
                          {c.accountType === "PJ" ? <Building2 className="h-3 w-3" /> : <User className="h-3 w-3" />}
                          {c.customerDocument}
                        </p>
                      </div>
                    </TableCell>

                    {/* Score de Risco */}
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="w-12 bg-muted rounded-full h-1.5 overflow-hidden">
                          <div
                            className={`h-full ${
                              c.riskLevel === "critical"
                                ? "bg-rose-500"
                                : c.riskLevel === "medium"
                                ? "bg-amber-500"
                                : "bg-emerald-500"
                            }`}
                            style={{ width: `${c.riskScore}%` }}
                          />
                        </div>
                        <span className={`text-xs font-mono font-bold ${
                          c.riskLevel === "critical"
                            ? "text-rose-600 dark:text-rose-400"
                            : c.riskLevel === "medium"
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-emerald-600 dark:text-emerald-400"
                        }`}>
                          {c.riskScore}/100
                        </span>
                      </div>
                    </TableCell>

                    {/* Valor */}
                    <TableCell className="font-mono text-xs text-foreground font-semibold">
                      {c.amount !== undefined ? formatCurrencyBRL(c.amount) : "—"}
                    </TableCell>

                    {/* SLA Restante */}
                    <TableCell>
                      <div className="flex items-center gap-1.5 text-xs">
                        <Clock className={`h-3.5 w-3.5 shrink-0 ${
                          c.slaRemainingMinutes < 60 ? "text-rose-500 animate-pulse" : "text-muted-foreground"
                        }`} />
                        <span className={`font-mono ${
                          c.slaRemainingMinutes < 60 ? "text-rose-600 dark:text-rose-400 font-bold" : "text-muted-foreground"
                        }`}>
                          {c.slaRemainingMinutes > 60
                            ? `${Math.floor(c.slaRemainingMinutes / 60)}h ${c.slaRemainingMinutes % 60}m`
                            : `${c.slaRemainingMinutes} min`}
                        </span>
                      </div>
                    </TableCell>

                    {/* Analista */}
                    <TableCell>
                      {c.assignedTo ? (
                        <div className="flex items-center gap-1.5">
                          <Avatar className="h-5 w-5">
                            <AvatarFallback className="text-[9px] bg-primary/10 text-primary">
                              {c.assignedTo.name.slice(0, 2).toUpperCase()}
                            </AvatarFallback>
                          </Avatar>
                          <span className="text-xs text-foreground truncate max-w-[100px]">
                            {c.assignedTo.name.split(" ")[0]}
                          </span>
                        </div>
                      ) : (
                        <Badge variant="outline" className="text-[10px] text-muted-foreground bg-muted/40">
                          Fila Livre
                        </Badge>
                      )}
                    </TableCell>

                    {/* Menu de Ações */}
                    <TableCell className="pr-4 text-right" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                          >
                            <MoreVertical className="h-4 w-4" />
                            <span className="sr-only">Opções do caso</span>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem onClick={() => onOpenInspector(c)} className="gap-2 cursor-pointer">
                            <Eye className="h-4 w-4" />
                            Inspecionar Caso
                          </DropdownMenuItem>
                          {!c.assignedTo && (
                            <DropdownMenuItem onClick={() => onAssignToMe(c.id)} className="gap-2 cursor-pointer">
                              <UserCheck className="h-4 w-4" />
                              Atribuir a Mim
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem onClick={() => onQuickApprove(c)} className="gap-2 text-emerald-600 dark:text-emerald-400 cursor-pointer">
                            <CheckCircle2 className="h-4 w-4" />
                            Aprovação Rápida
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => onQuickReject(c)} className="gap-2 text-destructive cursor-pointer">
                            <XCircle className="h-4 w-4" />
                            Reprovar / Bloquear
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
