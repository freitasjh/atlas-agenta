import { useState, useMemo } from "react"
import { toast } from "sonner"
import { 
  Users, 
  History, 
  Activity 
} from "lucide-react"
import { Button } from "../ui/button"
import {
  type QueueCase,
  type AuditLogEntry,
  type ServiceHealth,
  type BackofficeMetrics,
  type OperatorStatus,
  INITIAL_QUEUE_CASES,
  INITIAL_AUDIT_LOGS,
  INITIAL_SERVICES_HEALTH,
  INITIAL_BACKOFFICE_METRICS,
} from "./backoffice-types"
import { BackofficeHeader } from "./backoffice-header"
import { BackofficeKpis } from "./backoffice-kpis"
import { ApprovalQueueTable } from "./approval-queue-table"
import { CaseInspectorSheet } from "./case-inspector-sheet"
import { ActionReasonModal } from "./action-reason-modal"
import { AuditLogTable } from "./audit-log-table"
import { ServicesHealthCard } from "./services-health-card"

interface BackofficeViewProps {
  initialCases?: QueueCase[]
  initialAuditLogs?: AuditLogEntry[]
  initialServices?: ServiceHealth[]
  initialMetrics?: BackofficeMetrics
}

export function BackofficeView({
  initialCases = INITIAL_QUEUE_CASES,
  initialAuditLogs = INITIAL_AUDIT_LOGS,
  initialServices = INITIAL_SERVICES_HEALTH,
  initialMetrics = INITIAL_BACKOFFICE_METRICS,
}: BackofficeViewProps) {
  // Estados principais de dados
  const [cases, setCases] = useState<QueueCase[]>(initialCases)
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>(initialAuditLogs)
  const [services] = useState<ServiceHealth[]>(initialServices)
  const [metrics, setMetrics] = useState<BackofficeMetrics>(initialMetrics)

  // Filtros e Navegação Interna da Tela
  const [currentViewTab, setCurrentViewTab] = useState<"queue" | "audit" | "infrastructure">("queue")
  const [searchQuery, setSearchQuery] = useState("")
  const [operatorStatus, setOperatorStatus] = useState<OperatorStatus>("available")
  const [isRefreshing, setIsRefreshing] = useState(false)

  // Seleção e Modais
  const [selectedCaseIds, setSelectedCaseIds] = useState<string[]>([])
  const [inspectingCase, setInspectingCase] = useState<QueueCase | null>(null)
  const [isInspectorOpen, setIsInspectorOpen] = useState(false)

  // Modal de Ação Sensível
  const [actionModal, setActionModal] = useState<{
    open: boolean
    type: "reject" | "block" | "refund"
    targetCase: QueueCase | null
  }>({
    open: false,
    type: "reject",
    targetCase: null,
  })

  // Casos filtrados pela busca do cabeçalho
  const searchedCases = useMemo(() => {
    if (!searchQuery.trim()) return cases
    const q = searchQuery.toLowerCase()
    return cases.filter(
      (c) =>
        c.protocolNumber.toLowerCase().includes(q) ||
        c.customerName.toLowerCase().includes(q) ||
        c.customerDocument.includes(q) ||
        c.customerEmail.toLowerCase().includes(q)
    )
  }, [cases, searchQuery])

  // Handlers de Ações
  const handleRefresh = () => {
    setIsRefreshing(true)
    setTimeout(() => {
      setIsRefreshing(false)
      toast.success("Fila de casos atualizada com os servidores centrais.")
    }, 600)
  }

  // Aprovação Direta
  const handleApproveCase = (queueCase: QueueCase) => {
    // 1. Remove da fila de pendentes
    setCases((prev) => prev.filter((c) => c.id !== queueCase.id))
    setSelectedCaseIds((prev) => prev.filter((id) => id !== queueCase.id))
    
    // 2. Adiciona ao Log de Auditoria
    const newLog: AuditLogEntry = {
      id: `log-${Date.now()}`,
      timestamp: new Date().toISOString(),
      operatorName: "Você (Analista Atual)",
      operatorRole: "Analista de Risco & Compliance",
      action: "Aprovação Operacional de Caso",
      targetResource: queueCase.customerName,
      targetId: queueCase.protocolNumber,
      ipAddress: "192.168.1.100",
      status: "success",
      justification: "Caso analisado e aprovado em conformidade com as esteiras de compliance.",
    }
    setAuditLogs((prev) => [newLog, ...prev])

    // 3. Atualiza métrica
    setMetrics((prev) => ({
      ...prev,
      pendingCasesCount: Math.max(0, prev.pendingCasesCount - 1),
    }))

    if (inspectingCase?.id === queueCase.id) {
      setIsInspectorOpen(false)
    }

    toast.success(`Caso ${queueCase.protocolNumber} (${queueCase.customerName}) aprovado com sucesso!`)
  }

  // Abertura do Modal de Reprovação/Bloqueio
  const handleOpenRejectModal = (queueCase: QueueCase) => {
    setActionModal({
      open: true,
      type: "reject",
      targetCase: queueCase,
    })
  }

  const handleOpenBlockModal = (queueCase: QueueCase) => {
    setActionModal({
      open: true,
      type: "block",
      targetCase: queueCase,
    })
  }

  // Confirmação com Justificativa
  const handleConfirmActionWithReason = (reasonCode: string, justification: string) => {
    const target = actionModal.targetCase
    if (!target) return

    setCases((prev) => prev.filter((c) => c.id !== target.id))
    setSelectedCaseIds((prev) => prev.filter((id) => id !== target.id))

    const isBlock = actionModal.type === "block"
    const newLog: AuditLogEntry = {
      id: `log-${Date.now()}`,
      timestamp: new Date().toISOString(),
      operatorName: "Você (Analista Atual)",
      operatorRole: "Analista de Risco & Compliance",
      action: isBlock ? "Bloqueio Cautelar de Conta" : "Reprovação Cadastral / Transacional",
      targetResource: target.customerName,
      targetId: target.protocolNumber,
      ipAddress: "192.168.1.100",
      status: "warning",
      reasonCode,
      justification,
    }
    setAuditLogs((prev) => [newLog, ...prev])

    setMetrics((prev) => ({
      ...prev,
      pendingCasesCount: Math.max(0, prev.pendingCasesCount - 1),
    }))

    if (inspectingCase?.id === target.id) {
      setIsInspectorOpen(false)
    }

    toast.success(
      isBlock
        ? `Conta ${target.customerName} bloqueada cautelarmente e log de auditoria gerado.`
        : `Caso ${target.protocolNumber} reprovado com motivo ${reasonCode}.`
    )
  }

  // Atribuição de caso a mim
  const handleAssignToMe = (caseId: string) => {
    setCases((prev) =>
      prev.map((c) => {
        if (c.id === caseId) {
          return {
            ...c,
            status: "in_review",
            assignedTo: {
              id: "op-1",
              name: "Você (Analista Atual)",
              email: "admin@atlas.com.br",
              role: "Analista de Risco",
            },
          }
        }
        return c
      })
    )
    toast.success("Caso atribuído à sua esteira de análise com sucesso.")
  }

  // Ações em Lote
  const handleBatchAssign = () => {
    setCases((prev) =>
      prev.map((c) => {
        if (selectedCaseIds.includes(c.id)) {
          return {
            ...c,
            status: "in_review",
            assignedTo: {
              id: "op-1",
              name: "Você (Analista Atual)",
              email: "admin@atlas.com.br",
              role: "Analista de Risco",
            },
          }
        }
        return c
      })
    )
    toast.success(`${selectedCaseIds.length} casos atribuídos à sua esteira!`)
    setSelectedCaseIds([])
  }

  const handleBatchApprove = () => {
    if (confirm(`Deseja aprovar em lote os ${selectedCaseIds.length} casos selecionados?`)) {
      const approvedCases = cases.filter((c) => selectedCaseIds.includes(c.id))
      setCases((prev) => prev.filter((c) => !selectedCaseIds.includes(c.id)))

      // Gera logs de auditoria para cada aprovação
      const batchLogs: AuditLogEntry[] = approvedCases.map((ac, idx) => ({
        id: `log-batch-${Date.now()}-${idx}`,
        timestamp: new Date().toISOString(),
        operatorName: "Você (Analista Atual)",
        operatorRole: "Analista de Risco",
        action: "Aprovação em Lote",
        targetResource: ac.customerName,
        targetId: ac.protocolNumber,
        ipAddress: "192.168.1.100",
        status: "success",
        justification: "Aprovação operacional em lote executada via Backoffice.",
      }))

      setAuditLogs((prev) => [...batchLogs, ...prev])
      setMetrics((prev) => ({
        ...prev,
        pendingCasesCount: Math.max(0, prev.pendingCasesCount - approvedCases.length),
      }))

      toast.success(`${approvedCases.length} casos foram aprovados com sucesso!`)
      setSelectedCaseIds([])
    }
  }

  return (
    <div className="flex flex-col gap-6 px-4 lg:px-6 py-4">
      {/* Cabeçalho do Backoffice com Status Pill e Busca Global */}
      <BackofficeHeader
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        operatorStatus={operatorStatus}
        onOperatorStatusChange={(st) => {
          setOperatorStatus(st)
          toast.info(`Status do analista alterado para: ${st}`)
        }}
        onRefresh={handleRefresh}
        isRefreshing={isRefreshing}
        systemOperational={services.every((s) => s.status !== "down")}
      />

      {/* Grid de KPIs Essenciais de Operações */}
      <BackofficeKpis metrics={metrics} />

      {/* Navegação por Módulos do Backoffice */}
      <div className="flex items-center gap-2 border-b border-border/70 pb-2">
        <Button
          type="button"
          variant={currentViewTab === "queue" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setCurrentViewTab("queue")}
          className={`h-9 px-3.5 text-xs gap-2 ${
            currentViewTab === "queue"
              ? "bg-primary text-primary-foreground hover:bg-primary/90 font-semibold"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Users className="h-4 w-4" />
          Fila de Operações & Risco
          <span className={`text-[10px] rounded-full px-1.5 py-0.2 ${
            currentViewTab === "queue"
              ? "bg-primary-foreground/20 text-primary-foreground"
              : "bg-muted text-muted-foreground"
          }`}>
            {cases.length}
          </span>
        </Button>

        <Button
          type="button"
          variant={currentViewTab === "audit" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setCurrentViewTab("audit")}
          className={`h-9 px-3.5 text-xs gap-2 ${
            currentViewTab === "audit"
              ? "bg-primary text-primary-foreground hover:bg-primary/90 font-semibold"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <History className="h-4 w-4" />
          Trilha de Auditoria (Compliance)
          <span className={`text-[10px] rounded-full px-1.5 py-0.2 ${
            currentViewTab === "audit"
              ? "bg-primary-foreground/20 text-primary-foreground"
              : "bg-muted text-muted-foreground"
          }`}>
            {auditLogs.length}
          </span>
        </Button>

        <Button
          type="button"
          variant={currentViewTab === "infrastructure" ? "secondary" : "ghost"}
          size="sm"
          onClick={() => setCurrentViewTab("infrastructure")}
          className={`h-9 px-3.5 text-xs gap-2 ${
            currentViewTab === "infrastructure"
              ? "bg-primary text-primary-foreground hover:bg-primary/90 font-semibold"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Activity className="h-4 w-4" />
          Saúde de Gateways & Conectores
        </Button>
      </div>

      {/* Conteúdo da Aba Ativa */}
      {currentViewTab === "queue" && (
        <ApprovalQueueTable
          cases={searchedCases}
          selectedCaseIds={selectedCaseIds}
          onSelectAll={(checked) => setSelectedCaseIds(checked ? searchedCases.map((c) => c.id) : [])}
          onSelectCase={(id, checked) =>
            setSelectedCaseIds((prev) => (checked ? [...prev, id] : prev.filter((x) => x !== id)))
          }
          onOpenInspector={(c) => {
            setInspectingCase(c)
            setIsInspectorOpen(true)
          }}
          onQuickApprove={handleApproveCase}
          onQuickReject={handleOpenRejectModal}
          onAssignToMe={handleAssignToMe}
          onBatchApprove={handleBatchApprove}
          onBatchAssign={handleBatchAssign}
        />
      )}

      {currentViewTab === "audit" && (
        <AuditLogTable logs={auditLogs} />
      )}

      {currentViewTab === "infrastructure" && (
        <div className="space-y-6">
          <ServicesHealthCard services={services} />
        </div>
      )}

      {/* Drawer de Inspeção Profunda de Caso */}
      <CaseInspectorSheet
        queueCase={inspectingCase}
        open={isInspectorOpen}
        onOpenChange={setIsInspectorOpen}
        onApprove={handleApproveCase}
        onRequestReject={handleOpenRejectModal}
        onRequestBlock={handleOpenBlockModal}
        onRequestRFI={(c) => toast.info(`Solicitação de informações complementares (RFI) enviada para ${c.customerEmail}.`)}
      />

      {/* Modal de Ação Sensível com Justificativa Obrigatória */}
      <ActionReasonModal
        open={actionModal.open}
        onOpenChange={(op) => setActionModal((p) => ({ ...p, open: op }))}
        actionType={actionModal.type}
        selectedCase={actionModal.targetCase}
        onConfirm={handleConfirmActionWithReason}
      />
    </div>
  )
}
