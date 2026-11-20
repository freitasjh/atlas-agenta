import { useState } from "react"
import { 
  CheckCircle2, 
  XCircle, 
  ShieldAlert, 
  FileText, 
  Clock, 
  User, 
  Building2, 
  History, 
  Copy, 
  Check 
} from "lucide-react"
import { Button } from "../ui/button"
import { Badge } from "../ui/badge"
import { Avatar, AvatarFallback } from "../ui/avatar"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "../ui/sheet"
import { 
  type QueueCase, 
  formatCurrencyBRL, 
  formatDateTimeBR 
} from "./backoffice-types"

interface CaseInspectorSheetProps {
  queueCase: QueueCase | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onApprove: (queueCase: QueueCase) => void
  onRequestReject: (queueCase: QueueCase) => void
  onRequestBlock: (queueCase: QueueCase) => void
  onRequestRFI: (queueCase: QueueCase) => void
}

export function CaseInspectorSheet({
  queueCase,
  open,
  onOpenChange,
  onApprove,
  onRequestReject,
  onRequestBlock,
  onRequestRFI,
}: CaseInspectorSheetProps) {
  const [copiedDoc, setCopiedDoc] = useState(false)

  if (!queueCase) return null

  const handleCopyDocument = () => {
    navigator.clipboard.writeText(queueCase.customerDocument)
    setCopiedDoc(true)
    setTimeout(() => setCopiedDoc(false), 2000)
  }

  const categoryLabelMap = {
    fraud_alert: "Alerta de Risco & Fraude",
    kyc: "Validação Cadastral (KYC)",
    chargeback: "Disputa & Contestação",
    limit_increase: "Aumento de Limite Operacional",
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent 
        side="right" 
        className="w-full sm:max-w-lg p-0 flex flex-col justify-between overflow-y-auto"
      >
        <div className="p-6 space-y-6">
          {/* Header do Drawer */}
          <SheetHeader className="space-y-1 text-left">
            <div className="flex items-center justify-between pr-6">
              <span className="text-xs font-mono font-semibold text-primary">
                {queueCase.protocolNumber}
              </span>

              <Badge 
                variant="outline" 
                className={`text-[10px] font-mono uppercase px-2 py-0.5 ${
                  queueCase.riskLevel === "critical"
                    ? "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20"
                    : queueCase.riskLevel === "medium"
                    ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                    : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                }`}
              >
                Risco: {queueCase.riskScore}/100 ({queueCase.riskLevel})
              </Badge>
            </div>

            <SheetTitle className="text-lg font-bold text-foreground leading-tight">
              {queueCase.customerName}
            </SheetTitle>
            <p className="text-xs text-muted-foreground">
              {categoryLabelMap[queueCase.category]}
            </p>
          </SheetHeader>

          {/* SLA Timer Alert */}
          <div className={`rounded-lg border p-3 flex items-center justify-between text-xs ${
            queueCase.slaRemainingMinutes < 60
              ? "bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-300"
              : "bg-muted/40 border-border text-muted-foreground"
          }`}>
            <span className="flex items-center gap-1.5 font-medium">
              <Clock className="h-3.5 w-3.5" />
              SLA de Resolução:
            </span>
            <span className="font-mono font-bold">
              {queueCase.slaRemainingMinutes > 60
                ? `${Math.floor(queueCase.slaRemainingMinutes / 60)}h ${queueCase.slaRemainingMinutes % 60}m restantes`
                : `${queueCase.slaRemainingMinutes} minutos restantes (Prioritário)`}
            </span>
          </div>

          {/* Dados do Cliente & Operação */}
          <div className="space-y-3">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Dados do Proponente & Operação
            </h4>

            <div className="rounded-lg border border-border/70 divide-y divide-border/60 text-xs">
              <div className="p-2.5 flex items-center justify-between">
                <span className="text-muted-foreground flex items-center gap-1.5">
                  {queueCase.accountType === "PJ" ? <Building2 className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}
                  Documento ({queueCase.accountType})
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="font-mono font-medium text-foreground">
                    {queueCase.customerDocument}
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyDocument}
                    className="text-muted-foreground hover:text-foreground"
                    title="Copiar documento"
                  >
                    {copiedDoc ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                  </button>
                </div>
              </div>

              <div className="p-2.5 flex items-center justify-between">
                <span className="text-muted-foreground">E-mail Cadastrado</span>
                <span className="text-foreground truncate max-w-[200px]" title={queueCase.customerEmail}>
                  {queueCase.customerEmail}
                </span>
              </div>

              {queueCase.amount !== undefined && (
                <div className="p-2.5 flex items-center justify-between">
                  <span className="text-muted-foreground">Valor Envolvido na Análise</span>
                  <span className="font-mono font-bold text-foreground text-sm">
                    {formatCurrencyBRL(queueCase.amount)}
                  </span>
                </div>
              )}

              <div className="p-2.5 flex items-center justify-between">
                <span className="text-muted-foreground">Entrada na Fila</span>
                <span className="text-muted-foreground font-mono">
                  {formatDateTimeBR(queueCase.createdAt)}
                </span>
              </div>
            </div>
          </div>

          {/* Resumo Operacional da Anomalia / Solicitação */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Parecer do Sistema & Alerta
            </h4>
            <div className="rounded-lg bg-muted/30 border border-border/80 p-3 text-xs text-foreground leading-relaxed">
              {queueCase.summary}
            </div>
          </div>

          {/* Documentos Anexados & OCR */}
          {queueCase.documents.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5" />
                Documentos Anexados ({queueCase.documents.length})
              </h4>

              <div className="space-y-2">
                {queueCase.documents.map((doc) => (
                  <div key={doc.id} className="rounded-lg border border-border p-3 space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText className="h-4 w-4 text-primary shrink-0" />
                        <span className="font-medium text-foreground truncate max-w-xs">{doc.name}</span>
                      </div>
                      <Badge variant="outline" className={`text-[10px] ${
                        doc.status === "verified" ? "text-emerald-600 bg-emerald-500/10" : "text-amber-600 bg-amber-500/10"
                      }`}>
                        {doc.status === "verified" ? "Verificado" : "Pendente"}
                      </Badge>
                    </div>

                    {/* OCR Text se existir */}
                    {doc.ocrExtractedText && (
                      <div className="rounded bg-muted/40 p-2 text-[11px] font-mono space-y-1">
                        <span className="text-[10px] text-muted-foreground block font-sans font-semibold">Dados Extraídos por OCR:</span>
                        {Object.entries(doc.ocrExtractedText).map(([key, val]) => (
                          <div key={key} className="flex justify-between">
                            <span className="text-muted-foreground">{key}:</span>
                            <span className="text-foreground">{val}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Timeline de Eventos do Caso */}
          {queueCase.timeline.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <History className="h-3.5 w-3.5" />
                Histórico & Trilha de Auditoria do Caso
              </h4>

              <div className="space-y-3 relative pl-4 border-l border-border/80 ml-2">
                {queueCase.timeline.map((event) => (
                  <div key={event.id} className="relative space-y-1 text-xs">
                    <div className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-primary border-2 border-background" />
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-foreground">{event.action}</span>
                      <span className="text-[10px] text-muted-foreground font-mono">
                        {formatDateTimeBR(event.timestamp)}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      Por: <strong className="text-foreground">{event.actor}</strong>
                    </p>
                    {event.details && (
                      <p className="text-xs text-muted-foreground bg-muted/20 p-2 rounded">
                        {event.details}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Analista Responsável */}
          <div className="flex items-center justify-between p-3 rounded-lg border border-border/70 bg-muted/20 text-xs">
            <div className="flex items-center gap-2">
              <Avatar className="h-7 w-7">
                <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
                  {queueCase.assignedTo ? queueCase.assignedTo.name.slice(0, 2).toUpperCase() : "NA"}
                </AvatarFallback>
              </Avatar>
              <div>
                <p className="font-medium text-foreground">
                  {queueCase.assignedTo ? queueCase.assignedTo.name : "Não Atribuído"}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {queueCase.assignedTo ? queueCase.assignedTo.role : "Fila Geral"}
                </p>
              </div>
            </div>

            <Badge variant="outline" className="text-[10px]">
              {queueCase.status === "in_review" ? "Em Análise" : "Aguardando"}
            </Badge>
          </div>
        </div>

        {/* Rodapé Fixo com Ações Operacionais */}
        <div className="p-4 border-t border-border bg-card space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              onClick={() => onApprove(queueCase)}
              className="gap-1.5 text-xs h-9 bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs"
            >
              <CheckCircle2 className="h-4 w-4" />
              Aprovar Caso
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={() => onRequestRFI(queueCase)}
              className="gap-1.5 text-xs h-9"
            >
              Solicitar Dados (RFI)
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <Button
              type="button"
              variant="destructive"
              onClick={() => onRequestReject(queueCase)}
              className="gap-1.5 text-xs h-8"
            >
              <XCircle className="h-3.5 w-3.5" />
              Reprovar Solicitação
            </Button>

            <Button
              type="button"
              variant="ghost"
              onClick={() => onRequestBlock(queueCase)}
              className="gap-1.5 text-xs h-8 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 hover:text-rose-700"
            >
              <ShieldAlert className="h-3.5 w-3.5" />
              Bloquear Conta
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
