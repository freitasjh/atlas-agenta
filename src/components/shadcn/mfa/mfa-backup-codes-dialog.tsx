import { useState } from "react"
import {
  KeyRound,
  Copy,
  Download,
  RotateCcw,
  Check,
  ShieldAlert,
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
import { Badge } from "@/components/shadcn/ui/badge"
import { toast } from "sonner"

export interface BackupCodeItem {
  code: string
  used: boolean
  usedAt?: string
}

export interface MfaBackupCodesDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  codes: BackupCodeItem[]
  onRegenerateCodes: () => Promise<BackupCodeItem[]> | BackupCodeItem[]
}

export function MfaBackupCodesDialog({
  open,
  onOpenChange,
  codes,
  onRegenerateCodes,
}: MfaBackupCodesDialogProps) {
  const [copied, setCopied] = useState(false)
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false)

  const remainingCount = codes.filter((c) => !c.used).length

  const handleCopy = async () => {
    try {
      const activeCodes = codes
        .filter((c) => !c.used)
        .map((c) => c.code)
        .join("\n")
      await navigator.clipboard.writeText(activeCodes)
      setCopied(true)
      toast.success("Códigos ativos copiados!")
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Não foi possível copiar.")
    }
  }

  const handleDownload = () => {
    const text = `ATLAS PLATFORM - CÓDIGOS DE RECUPERAÇÃO 2FA\nData: ${new Date().toLocaleDateString(
      "pt-BR"
    )}\n\nCódigos Ativos:\n${codes
      .filter((c) => !c.used)
      .map((c, i) => `${i + 1}. ${c.code}`)
      .join("\n")}\n\nCada código só pode ser usado uma vez.`

    const blob = new Blob([text], { type: "text/plain;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `atlas-backup-codes.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast.success("Arquivo baixado com sucesso!")
  }

  const handleConfirmRegenerate = async () => {
    setIsRegenerating(true)
    try {
      await onRegenerateCodes()
      setShowRegenerateConfirm(false)
      toast.success("Novos códigos gerados com sucesso! Os anteriores foram revogados.")
    } catch {
      toast.error("Erro ao gerar novos códigos.")
    } finally {
      setIsRegenerating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <KeyRound className="h-4 w-4" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold">
                Códigos de Recuperação de Emergência
              </DialogTitle>
              <DialogDescription className="text-xs">
                Utilize estes códigos caso não tenha acesso ao seu dispositivo de autenticação.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {showRegenerateConfirm ? (
          <div className="space-y-4 py-2">
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 flex items-start gap-3">
              <ShieldAlert className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div className="space-y-1 text-xs">
                <span className="font-bold text-destructive block">
                  Atenção: Revogação de Códigos Existentes
                </span>
                <p className="text-muted-foreground leading-relaxed">
                  Gerar uma nova lista de códigos irá <strong>invalidar imediatamente</strong>{" "}
                  todos os seus códigos de recuperação anteriores. Certifique-se de salvar os
                  novos códigos.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowRegenerateConfirm(false)}
                className="text-xs font-semibold"
              >
                Voltar
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={handleConfirmRegenerate}
                disabled={isRegenerating}
                className="text-xs font-semibold gap-1.5"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {isRegenerating ? "Gerando..." : "Sim, Gerar Novos Códigos"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            {/* Status dos Códigos */}
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                Disponíveis: <strong className="text-foreground">{remainingCount} de {codes.length} restantes</strong>
              </span>
              {remainingCount <= 2 && (
                <Badge variant="destructive" className="text-[10px] font-semibold">
                  Poucos códigos restantes
                </Badge>
              )}
            </div>

            {/* Grid de Códigos */}
            <div className="grid grid-cols-2 gap-2 rounded-xl border border-border/80 bg-muted/40 p-3">
              {codes.map((item, idx) => (
                <div
                  key={idx}
                  className={`flex items-center justify-between rounded-md border px-2.5 py-1.5 text-xs font-mono font-bold transition-all ${
                    item.used
                      ? "border-border/40 bg-muted/20 text-muted-foreground line-through opacity-60"
                      : "border-border/70 bg-background text-foreground select-all"
                  }`}
                >
                  <span className="text-[10px] text-muted-foreground select-none">
                    #{String(idx + 1).padStart(2, "0")}
                  </span>
                  <span>{item.code}</span>
                  {item.used && (
                    <span className="text-[9px] font-sans font-semibold text-muted-foreground ml-1">
                      (Usado)
                    </span>
                  )}
                </div>
              ))}
            </div>

            {/* Ações */}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCopy}
                className="text-xs font-semibold gap-1.5 flex-1"
              >
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                Copiar Ativos
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleDownload}
                className="text-xs font-semibold gap-1.5 flex-1"
              >
                <Download className="h-3.5 w-3.5" />
                Baixar (.txt)
              </Button>
            </div>
          </div>
        )}

        <DialogFooter className="border-t border-border/60 pt-3 flex flex-col sm:flex-row items-center justify-between gap-2">
          {!showRegenerateConfirm && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowRegenerateConfirm(true)}
              className="text-xs text-muted-foreground hover:text-destructive gap-1.5 mr-auto"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Gerar Novos Códigos
            </Button>
          )}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            className="text-xs font-semibold"
          >
            Fechar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
