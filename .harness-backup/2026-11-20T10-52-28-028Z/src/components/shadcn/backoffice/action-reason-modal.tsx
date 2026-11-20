import { useState, type FormEvent } from "react"
import { ShieldAlert } from "lucide-react"
import { Button } from "../ui/button"
import { Label } from "../ui/label"
import { Checkbox } from "../ui/checkbox"
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
import { type QueueCase } from "./backoffice-types"

interface ActionReasonModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  actionType: "reject" | "block" | "refund"
  selectedCase: QueueCase | null
  onConfirm: (reasonCode: string, justification: string) => void
}

const REASON_CODES = {
  reject: [
    { code: "UNREADABLE_DOCUMENT", label: "Documento Ilegível / Foto com Reflexo" },
    { code: "EXPIRED_DOCUMENT", label: "Documento com Validade Expirada" },
    { code: "DATA_MISMATCH", label: "Divergência entre Dados e Receita Federal" },
    { code: "SUSPICIOUS_IMAGE", label: "Indício de Adulteração Digital / Edição" },
    { code: "POLICY_VIOLATION", label: "Incompatibilidade com Política Interna" },
  ],
  block: [
    { code: "FRAUD_SUSPICION", label: "Forte Suspeita de Fraude / Golpe Pix" },
    { code: "ACCOUNT_TAKEOVER", label: "Possível Invasão de Conta (Account Takeover)" },
    { code: "BACEN_SANCTION_LIST", label: "Inclusão em Lista Restritiva / Sanção" },
    { code: "UNUSUAL_VOLUME", label: "Volume Atípico sem Lastro Financeiro" },
  ],
  refund: [
    { code: "CHARGEBACK_ACCEPTED", label: "Desacordo Comercial / Entrega Não Efetuada" },
    { code: "UNRECOGNIZED_TRANSACTION", label: "Transação Não Reconhecida pelo Titular" },
    { code: "DUPLICATED_CHARGE", label: "Cobrança Duplicada por Erro de Integração" },
  ],
}

export function ActionReasonModal({
  open,
  onOpenChange,
  actionType,
  selectedCase,
  onConfirm,
}: ActionReasonModalProps) {
  const [reasonCode, setReasonCode] = useState("")
  const [justification, setJustification] = useState("")
  const [acknowledged, setAcknowledged] = useState(false)

  const reasons = REASON_CODES[actionType] || REASON_CODES.reject

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!reasonCode || justification.trim().length < 8 || !acknowledged) return

    onConfirm(reasonCode, justification.trim())
    setReasonCode("")
    setJustification("")
    setAcknowledged(false)
    onOpenChange(false)
  }

  const titleMap = {
    reject: "Reprovar Solicitação Operacional",
    block: "Bloqueio Cautelar da Conta",
    refund: "Autorizar Estorno Financeiro",
  }

  const colorMap = {
    reject: "text-rose-600 dark:text-rose-400",
    block: "text-rose-600 dark:text-rose-400",
    refund: "text-amber-600 dark:text-amber-400",
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-y-auto overscroll-contain p-6 sm:max-w-xl">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle className={`text-lg font-bold flex items-center gap-2 ${colorMap[actionType]}`}>
              <ShieldAlert className="h-5 w-5" />
              {titleMap[actionType]}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Esta ação possui impacto operacional direto. Todos os dados inseridos serão registrados de forma imutável no log de auditoria.
            </DialogDescription>
          </DialogHeader>

          {/* Contexto do Caso */}
          {selectedCase && (
            <div className="rounded-lg bg-muted/40 border border-border p-3 space-y-1 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-foreground">{selectedCase.customerName}</span>
                <span className="font-mono text-muted-foreground">{selectedCase.protocolNumber}</span>
              </div>
              <p className="text-muted-foreground">
                Documento: <strong className="text-foreground font-mono">{selectedCase.customerDocument}</strong> • 
                Risco Atual: <strong className="text-rose-600 dark:text-rose-400">{selectedCase.riskScore}/100</strong>
              </p>
            </div>
          )}

          {/* Campos do Formulário */}
          <div className="space-y-3.5 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="reason-code" className="text-xs font-medium text-foreground">
                Código de Motivo Regulatório *
              </Label>
              <Select value={reasonCode} onValueChange={setReasonCode} required>
                <SelectTrigger id="reason-code" className="h-9 w-full text-xs">
                  <SelectValue placeholder="Selecione o motivo padronizado..." />
                </SelectTrigger>
                <SelectContent>
                  {reasons.map((r) => (
                    <SelectItem key={r.code} value={r.code} className="text-xs">
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="justification-text" className="text-xs font-medium text-foreground">
                Parecer Técnico do Analista (Mínimo 8 caracteres) *
              </Label>
              <textarea
                id="justification-text"
                rows={3}
                value={justification}
                onChange={(e) => setJustification(e.target.value)}
                placeholder="Descreva detalhadamente o parecer operacional e evidências encontradas..."
                className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-xs shadow-2xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                required
              />
              <span className="text-[10px] text-muted-foreground block text-right">
                {justification.length} caracteres digitados
              </span>
            </div>

            {/* Termo de Ciência */}
            <div className="flex items-start gap-2.5 pt-1">
              <Checkbox
                id="audit-ack"
                checked={acknowledged}
                onCheckedChange={(c) => setAcknowledged(!!c)}
                className="mt-0.5"
              />
              <Label htmlFor="audit-ack" className="text-xs text-muted-foreground cursor-pointer leading-tight">
                Declaro que analisei as evidências do caso e estou ciente de que esta decisão será registrada sob meu usuário nos relatórios de auditoria e conformidade.
              </Label>
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
              variant="destructive"
              disabled={!reasonCode || justification.trim().length < 8 || !acknowledged}
            >
              Confirmar Operação
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
