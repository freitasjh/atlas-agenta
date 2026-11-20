import { useState } from "react"
import {
  ShieldCheck,
  QrCode,
  Copy,
  Download,
  Check,
  AlertTriangle,
  ArrowRight,
  ArrowLeft,
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
import { Checkbox } from "@/components/shadcn/ui/checkbox"
import { InputOtp } from "@/components/shadcn/ui/input-otp"
import { Badge } from "@/components/shadcn/ui/badge"
import { toast } from "sonner"
import type { MfaSetupData } from "./mfa-types"

export interface MfaSetupDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  setupData: MfaSetupData
  onConfirmCode: (code: string) => Promise<boolean> | boolean
  onFinishSetup: () => void
}

export function MfaSetupDialog({
  open,
  onOpenChange,
  setupData,
  onConfirmCode,
  onFinishSetup,
}: MfaSetupDialogProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [copiedSecret, setCopiedSecret] = useState(false)
  const [copiedCodes, setCopiedCodes] = useState(false)
  const [verificationCode, setVerificationCode] = useState("")
  const [isVerifying, setIsVerifying] = useState(false)
  const [verificationError, setVerificationError] = useState<string | null>(null)
  const [savedCodesConfirmed, setSavedCodesConfirmed] = useState(false)

  // Copiar chave secreta
  const handleCopySecret = async () => {
    try {
      await navigator.clipboard.writeText(setupData.secretKey)
      setCopiedSecret(true)
      toast.success("Chave secreta copiada para a área de transferência!")
      setTimeout(() => setCopiedSecret(false), 2000)
    } catch {
      toast.error("Não foi possível copiar automaticamente.")
    }
  }

  // Copiar códigos de recuperação
  const handleCopyBackupCodes = async () => {
    try {
      const text = setupData.backupCodes.join("\n")
      await navigator.clipboard.writeText(text)
      setCopiedCodes(true)
      toast.success("10 códigos de recuperação copiados!")
      setTimeout(() => setCopiedCodes(false), 2000)
    } catch {
      toast.error("Não foi possível copiar.")
    }
  }

  // Download do arquivo .txt
  const handleDownloadBackupCodes = () => {
    const fileContent = `================================================
ATLAS PLATFORM - CÓDIGOS DE RECUPERAÇÃO 2FA / MFA
Conta: ${setupData.accountName}
Emissor: ${setupData.issuer}
Data: ${new Date().toLocaleDateString("pt-BR")}
================================================

AVISO IMPORTANTE:
- Cada código só pode ser utilizado UMA ÚNICA VEZ.
- Guarde este arquivo em local seguro (ex: cofre de senhas).
- Se perder seus códigos e o celular, você poderá perder o acesso.

SEUS CÓDIGOS DE RECUPERAÇÃO:
${setupData.backupCodes.map((code, idx) => `${idx + 1}. ${code}`).join("\n")}

================================================`

    const blob = new Blob([fileContent], { type: "text/plain;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `atlas-backup-codes-${setupData.accountName}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast.success("Arquivo de códigos baixado com sucesso!")
  }

  // Validação do código de 6 dígitos no passo 2
  const handleValidateStep2 = async (codeToTest: string) => {
    if (codeToTest.length < 6 || isVerifying) return
    setIsVerifying(true)
    setVerificationError(null)

    try {
      const isValid = await onConfirmCode(codeToTest)
      if (isValid) {
        setStep(3)
        toast.success("Aplicativo autenticador pareado com sucesso!")
      } else {
        setVerificationError("Código inválido. Digite o código de 6 dígitos atual do aplicativo.")
        setVerificationCode("")
      }
    } catch {
      setVerificationError("Falha na validação. Tente novamente.")
      setVerificationCode("")
    } finally {
      setIsVerifying(false)
    }
  }

  const handleFinish = () => {
    onFinishSetup()
    onOpenChange(false)
    setStep(1)
    setVerificationCode("")
    setSavedCodesConfirmed(false)
    toast.success("Autenticação em Duas Etapas ativada com sucesso!")
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold">
                  Configurar Autenticação em Duas Etapas (MFA)
                </DialogTitle>
                <DialogDescription className="text-xs">
                  Passo {step} de 3 •{" "}
                  {step === 1
                    ? "Escanear QR Code"
                    : step === 2
                    ? "Verificar Código de Teste"
                    : "Guardar Códigos de Recuperação"}
                </DialogDescription>
              </div>
            </div>

            {/* Stepper Pill */}
            <div className="flex items-center gap-1">
              {[1, 2, 3].map((s) => (
                <div
                  key={s}
                  className={`h-1.5 w-6 rounded-full transition-colors ${
                    step >= s ? "bg-primary" : "bg-muted"
                  }`}
                />
              ))}
            </div>
          </div>
        </DialogHeader>

        {/* ============================================================ */}
        {/* PASSO 1: ESCANEAR QR CODE E CHAVE MANUAL                      */}
        {/* ============================================================ */}
        {step === 1 && (
          <div className="space-y-4 py-2">
            <p className="text-xs text-muted-foreground leading-relaxed">
              Abra seu aplicativo autenticador preferido (como{" "}
              <strong className="text-foreground">Google Authenticator, Authy, Microsoft Authenticator</strong>{" "}
              ou 1Password) e aponte a câmera para o QR Code abaixo:
            </p>

            {/* QR Code Container */}
            <div className="flex flex-col sm:flex-row items-center gap-4 rounded-xl border border-border/80 bg-muted/30 p-4">
              <div className="flex h-36 w-36 shrink-0 items-center justify-center rounded-lg border border-border bg-white p-2 shadow-xs">
                {setupData.qrCodeUrl ? (
                  <img
                    src={setupData.qrCodeUrl}
                    alt="QR Code TOTP"
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <QrCode className="h-24 w-24 text-neutral-800" />
                )}
              </div>

              <div className="flex-1 space-y-2 text-left min-w-0">
                <Badge variant="outline" className="text-[10px] font-semibold">
                  Acessibilidade / Entrada Manual
                </Badge>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Não consegue ler o QR Code com a câmera? Digite ou copie o segredo no seu app:
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-xs font-bold text-foreground truncate select-all">
                    {setupData.secretKey}
                  </code>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleCopySecret}
                    className="h-8 text-xs font-semibold gap-1 shrink-0"
                  >
                    {copiedSecret ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-500" />
                        Copiado
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        Copiar
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ============================================================ */}
        {/* PASSO 2: CONFIRMAÇÃO DO CÓDIGO DE 6 DÍGITOS                   */}
        {/* ============================================================ */}
        {step === 2 && (
          <div className="space-y-4 py-3 text-center">
            <div className="max-w-sm mx-auto space-y-1.5">
              <h3 className="text-sm font-bold text-foreground">
                Digite o código exibido no seu aplicativo
              </h3>
              <p className="text-xs text-muted-foreground">
                Insira o código numérico temporário de 6 dígitos gerado para a conta{" "}
                <strong className="text-foreground">{setupData.accountName}</strong>.
              </p>
            </div>

            <div className="py-2 flex justify-center">
              <InputOtp
                length={6}
                value={verificationCode}
                onChange={(val) => {
                  setVerificationCode(val)
                  if (verificationError) setVerificationError(null)
                }}
                onComplete={handleValidateStep2}
                isInvalid={Boolean(verificationError)}
                disabled={isVerifying}
              />
            </div>

            {verificationError && (
              <p className="text-xs text-destructive font-medium">{verificationError}</p>
            )}
          </div>
        )}

        {/* ============================================================ */}
        {/* PASSO 3: CÓDIGOS DE RECUPERAÇÃO (MANDATÓRIO)                 */}
        {/* ============================================================ */}
        {step === 3 && (
          <div className="space-y-4 py-2">
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
              <div className="space-y-1 text-xs">
                <span className="font-bold text-amber-600 dark:text-amber-400 block">
                  Atenção: Salve seus códigos de emergência agora
                </span>
                <p className="text-muted-foreground leading-relaxed">
                  Se você perder o acesso ao seu telefone ou app autenticador, estes 10 códigos
                  serão o <strong>único meio</strong> de recuperar sua conta sem o suporte. Cada
                  código só funciona uma vez.
                </p>
              </div>
            </div>

            {/* Grid de 10 Códigos Monospace */}
            <div className="grid grid-cols-2 gap-2 rounded-xl border border-border/80 bg-muted/40 p-3.5">
              {setupData.backupCodes.map((code, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between rounded-md border border-border/60 bg-background px-2.5 py-1.5 text-xs font-mono font-bold text-foreground select-all"
                >
                  <span className="text-muted-foreground text-[10px] select-none">
                    #{String(idx + 1).padStart(2, "0")}
                  </span>
                  <span>{code}</span>
                </div>
              ))}
            </div>

            {/* Ações de Exportação */}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCopyBackupCodes}
                className="text-xs font-semibold gap-1.5 flex-1"
              >
                {copiedCodes ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                    Códigos Copiados
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    Copiar Códigos
                  </>
                )}
              </Button>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleDownloadBackupCodes}
                className="text-xs font-semibold gap-1.5 flex-1"
              >
                <Download className="h-3.5 w-3.5" />
                Baixar (.txt)
              </Button>
            </div>

            {/* Checkbox de Confirmação Obrigatório */}
            <div className="flex items-center space-x-2 pt-2 border-t border-border/60">
              <Checkbox
                id="saved-codes-confirm"
                checked={savedCodesConfirmed}
                onCheckedChange={(checked) => setSavedCodesConfirmed(Boolean(checked))}
              />
              <label
                htmlFor="saved-codes-confirm"
                className="text-xs font-medium text-foreground cursor-pointer select-none leading-tight"
              >
                Confirmo que copiei ou baixei meus 10 códigos de recuperação em um local seguro.
              </label>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-3">
          {step === 1 && (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
                className="text-xs font-semibold"
              >
                Cancelar
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => setStep(2)}
                className="text-xs font-semibold gap-1.5 shadow-xs"
              >
                Continuar
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </>
          )}

          {step === 2 && (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setStep(1)}
                className="text-xs font-semibold gap-1"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Voltar
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => handleValidateStep2(verificationCode)}
                disabled={verificationCode.length < 6 || isVerifying}
                className="text-xs font-semibold gap-1.5 shadow-xs"
              >
                {isVerifying ? "Verificando..." : "Validar e Prosseguir"}
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </>
          )}

          {step === 3 && (
            <Button
              type="button"
              size="sm"
              onClick={handleFinish}
              disabled={!savedCodesConfirmed}
              className="w-full text-xs font-semibold gap-1.5 shadow-xs bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <ShieldCheck className="h-4 w-4" />
              Concluir Ativação do MFA
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
