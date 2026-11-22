import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react"
import {
  ShieldCheck,
  Smartphone,
  MessageSquare,
  KeyRound,
  RotateCcw,
  AlertCircle,
  ArrowLeft,
} from "lucide-react"
import { Button } from "@/components/shadcn/ui/button"
import { Checkbox } from "@/components/shadcn/ui/checkbox"
import { InputOtp } from "@/components/shadcn/ui/input-otp"
import { Input } from "@/components/shadcn/ui/input"
// Variante single-input precisa de ref real para foco/select no erro; o Input
// primitivo do template não encaminha ref (ver auth-padronizacao no Brain).
import { Input as ForwardedInput } from "@/components/ui/input"
import { cn } from "@/lib/cn"
import type { MfaMethod, MfaUserContext, MfaVerificationResult } from "./mfa-types"

export interface MfaChallengeCardProps {
  userContext: MfaUserContext
  onVerify: (data: {
    code: string
    method: MfaMethod
    trustDevice: boolean
  }) => Promise<MfaVerificationResult> | MfaVerificationResult
  onResendCode?: (method: MfaMethod) => Promise<void> | void
  onCancel?: () => void
  onSuccess?: () => void
  className?: string
  /** Variante single-input (área interna): mantém o contrato de input real. */
  inputMode?: "otp" | "single"
  codeLabel?: string
  codeMaxLength?: number
  title?: string
  /** Título da página interna deve ser `h1`; default do card é `h2`. */
  titleAs?: "h1" | "h2"
  description?: ReactNode
  submitLabel?: string
  submitPendingLabel?: string
  submitClassName?: string
  /** Backend interno não oferece "lembrar dispositivo" — desliga o checkbox. */
  showTrustDevice?: boolean
  /** Lockout/estado externo: bloqueia input e submit sem mexer no card. */
  disabled?: boolean
  /** Slot para CTA de enroll e status de lockout (página controla). */
  footer?: ReactNode
}

/**
 * Moldura estável da visão principal. Declarada fora do componente para que o
 * tipo do elemento não mude a cada render (senão React remonta o input e o
 * foco/select são perdidos a cada dígito digitado).
 */
function ChallengeFrame({
  single,
  onSubmit,
  children,
}: {
  single: boolean
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  children: ReactNode
}) {
  return single ? (
    <form noValidate onSubmit={onSubmit} className="space-y-6">
      {children}
    </form>
  ) : (
    <div className="space-y-6">{children}</div>
  )
}

export function MfaChallengeCard({
  userContext,
  onVerify,
  onResendCode,
  onCancel,
  onSuccess,
  className,
  inputMode = "otp",
  codeLabel,
  codeMaxLength = 8,
  title,
  titleAs = "h2",
  description,
  submitLabel = "Verificar Código",
  submitPendingLabel = "Validando autenticação...",
  submitClassName,
  showTrustDevice = true,
  disabled = false,
  footer,
}: MfaChallengeCardProps) {
  const isSingleInput = inputMode === "single"
  const Heading = titleAs
  const singleInputRef = useRef<HTMLInputElement>(null)
  const [currentMethod, setCurrentMethod] = useState<MfaMethod>(userContext.preferredMethod)
  const [otpCode, setOtpCode] = useState("")
  const [backupCodeInput, setBackupCodeInput] = useState("")
  const [trustDevice, setTrustDevice] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [resendCooldown, setResendCooldown] = useState(0)
  const [showMethodSelector, setShowMethodSelector] = useState(false)
  const blocked = isLoading || disabled

  // Timer de resend cooldown
  useEffect(() => {
    if (resendCooldown <= 0) return
    const timer = setInterval(() => {
      setResendCooldown((prev) => prev - 1)
    }, 1000)
    return () => clearInterval(timer)
  }, [resendCooldown])

  // Foco inicial no campo — espelha o contrato da página interna sem exigir
  // ref externa (o card passa a ser dono do input). A retomada no erro é feita
  // por `fail()`: um `setState` com a MESMA mensagem não dispara efeito, então
  // o foco precisava de um agendamento explícito a cada tentativa.
  useEffect(() => {
    if (!isSingleInput) return
    singleInputRef.current?.focus()
  }, [isSingleInput])

  const focusSingleInput = () => {
    const focus = () => {
      singleInputRef.current?.focus()
      singleInputRef.current?.select()
    }
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(focus)
      return
    }
    focus()
  }

  /** Erro de verificação: publica na live region e devolve o foco ao campo. */
  const fail = (message: string) => {
    setErrorMessage(message)
    setOtpCode("")
    focusSingleInput()
  }

  const handleVerify = async (codeToVerify: string) => {
    if (!codeToVerify.trim() || blocked) return
    setIsLoading(true)
    setErrorMessage(null)

    try {
      const res = await onVerify({
        code: codeToVerify.trim(),
        method: currentMethod,
        trustDevice,
      })

      if (res.success) {
        if (onSuccess) onSuccess()
      } else {
        fail(res.message || "Código incorreto ou expirado. Verifique e tente novamente.")
      }
    } catch {
      fail("Erro ao verificar o código. Tente novamente em instantes.")
    } finally {
      setIsLoading(false)
    }
  }

  const handleFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void handleVerify(otpCode)
  }

  const handleResend = async () => {
    if (resendCooldown > 0 || !onResendCode) return
    setResendCooldown(60)
    setErrorMessage(null)
    try {
      await onResendCode(currentMethod)
    } catch {
      setErrorMessage("Não foi possível reenviar o código agora.")
      focusSingleInput()
    }
  }

  const switchMethod = (method: MfaMethod) => {
    setCurrentMethod(method)
    setOtpCode("")
    setBackupCodeInput("")
    setErrorMessage(null)
    setShowMethodSelector(false)
    if (method === "sms" && onResendCode) {
      setResendCooldown(60)
    }
  }

  return (
    <div
      className={cn(
        "w-full max-w-md mx-auto rounded-2xl border border-border/80 bg-card p-6 sm:p-8 shadow-lg text-card-foreground",
        className
      )}
    >
      {/* Botão Voltar para seleção ou cancelamento */}
      {showMethodSelector ? (
        <div className="mb-4">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowMethodSelector(false)}
            className="text-xs text-muted-foreground gap-1 -ml-2 h-8"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Voltar para verificação
          </Button>
        </div>
      ) : onCancel ? (
        <div className="mb-4">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCancel}
            className="text-xs text-muted-foreground gap-1 -ml-2 h-8"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Voltar para o login
          </Button>
        </div>
      ) : null}

      {/* Visão de Seleção de Métodos Alternativos */}
      {showMethodSelector ? (
        <div className="space-y-4">
          <div className="text-center sm:text-left">
            <h3 className="text-lg font-bold tracking-tight text-foreground">
              Escolha outra forma de verificação
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              Selecione outro método autenticado associado à sua conta.
            </p>
          </div>

          <div className="space-y-2 pt-2">
            {userContext.availableMethods.map((method) => {
              if (method === currentMethod) return null

              let icon = Smartphone
              let title = "App Autenticador (TOTP)"
              let desc = "Código temporário do Google Authenticator ou Authy"

              if (method === "sms") {
                icon = MessageSquare
                title = "Mensagem SMS"
                desc = userContext.phoneNumberMasked
                  ? `Código enviado para ${userContext.phoneNumberMasked}`
                  : "Código via SMS no celular cadastrado"
              } else if (method === "backup_code") {
                icon = KeyRound
                title = "Código de Recuperação (Backup)"
                desc = "Código reserva descartável de 8 caracteres"
              }

              const IconComp = icon

              return (
                <button
                  key={method}
                  type="button"
                  onClick={() => switchMethod(method)}
                  className="w-full flex items-center gap-3.5 p-3.5 rounded-xl border border-border/80 bg-background hover:bg-muted/50 hover:border-primary/40 transition-all text-left group cursor-pointer"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
                    <IconComp className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-bold text-foreground block truncate">
                      {title}
                    </span>
                    <span className="text-[11px] text-muted-foreground block truncate">
                      {desc}
                    </span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      ) : (
        /* Visão Principal do Desafio de Código. No input único, Enter submete
           sem reload (form noValidate); otp/backup mantêm o botão com onClick. */
        <ChallengeFrame single={isSingleInput} onSubmit={handleFormSubmit}>
          {/* Cabeçalho */}
          <div className="text-center space-y-2">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-xs">
              {currentMethod === "totp" && <Smartphone className="h-6 w-6" />}
              {currentMethod === "sms" && <MessageSquare className="h-6 w-6" />}
              {currentMethod === "backup_code" && <KeyRound className="h-6 w-6" />}
            </div>

            <div className="space-y-1">
              <Heading className="text-xl font-extrabold tracking-tight text-foreground">
                {title ??
                  (currentMethod === "backup_code"
                    ? "Código de Recuperação"
                    : "Verificação em Duas Etapas")}
              </Heading>
              {description !== undefined ? (
                <p className="text-xs text-muted-foreground max-w-xs mx-auto leading-relaxed">
                  {description}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground max-w-xs mx-auto leading-relaxed">
                  {currentMethod === "totp" && (
                    <>
                      Digite o código de 6 dígitos gerado pelo seu aplicativo autenticador
                      (Google Authenticator, Authy ou 1Password).
                    </>
                  )}
                  {currentMethod === "sms" && (
                    <>
                      Enviamos um SMS com código de segurança para{" "}
                      <strong className="text-foreground">
                        {userContext.phoneNumberMasked || "seu telefone cadastrado"}
                      </strong>
                      .
                    </>
                  )}
                  {currentMethod === "backup_code" && (
                    <>
                      Insira um dos seus códigos reservas de emergência gerados durante a
                      configuração da conta.
                    </>
                  )}
                </p>
              )}
            </div>
          </div>

          {/* Área de Entrada do Código */}
          <div className="space-y-3">
            {currentMethod === "backup_code" ? (
              <div className="space-y-2">
                <Input
                  type="text"
                  placeholder="Ex: a1b2-c3d4"
                  value={backupCodeInput}
                  onChange={(e) => setBackupCodeInput(e.target.value.toUpperCase())}
                  className="text-center font-mono text-base font-bold tracking-widest uppercase h-11"
                  autoFocus
                />
                <span className="text-[11px] text-muted-foreground text-center block">
                  Cada código reserva só pode ser utilizado uma única vez.
                </span>
              </div>
            ) : isSingleInput ? (
              <div className="space-y-2">
                {codeLabel ? (
                  <label
                    htmlFor="mfa-single-code"
                    className="block text-sm font-medium text-foreground"
                  >
                    {codeLabel}
                  </label>
                ) : null}
                <ForwardedInput
                  id="mfa-single-code"
                  ref={singleInputRef}
                  value={otpCode}
                  onChange={(event) => {
                    setOtpCode(
                      event.target.value.replace(/\D/g, "").slice(0, codeMaxLength),
                    )
                    if (errorMessage) setErrorMessage(null)
                  }}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="123456"
                  aria-invalid={Boolean(errorMessage)}
                  aria-describedby={errorMessage ? "mfa-challenge-error" : undefined}
                  disabled={blocked}
                  className="h-11 w-full text-center font-mono text-lg tracking-widest tabular-nums"
                />
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <InputOtp
                  length={6}
                  value={otpCode}
                  onChange={(val) => {
                    setOtpCode(val)
                    if (errorMessage) setErrorMessage(null)
                  }}
                  onComplete={(val) => handleVerify(val)}
                  isInvalid={Boolean(errorMessage)}
                  disabled={blocked}
                />
              </div>
            )}

            {/* Live region persistente: montada antes do erro para que a
                inserção do texto seja anunciada; só o conteúdo muda. */}
            <div
              id="mfa-challenge-error"
              role="alert"
              aria-live="assertive"
              aria-atomic="true"
              tabIndex={-1}
              className={cn(
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                errorMessage &&
                  "flex items-center gap-1.5 rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-xs text-destructive",
              )}
            >
              {errorMessage ? (
                <>
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{errorMessage}</span>
                </>
              ) : null}
            </div>
          </div>

          {/* Opção Reenviar Código (para SMS) */}
          {currentMethod === "sms" && onResendCode && (
            <div className="flex items-center justify-center text-xs">
              {resendCooldown > 0 ? (
                <span className="text-muted-foreground flex items-center gap-1">
                  Reenviar código em <strong className="text-foreground">{resendCooldown}s</strong>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={handleResend}
                  className="font-semibold text-primary hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Não recebeu o SMS? Reenviar código
                </button>
              )}
            </div>
          )}

          {/* Lembrar deste dispositivo (desligado quando backend não suporta) */}
          {showTrustDevice ? (
            <div className="flex items-center space-x-2 pt-1 border-t border-border/60">
              <Checkbox
                id="trust-device"
                checked={trustDevice}
                onCheckedChange={(checked) => setTrustDevice(Boolean(checked))}
              />
              <label
                htmlFor="trust-device"
                className="text-xs text-muted-foreground font-medium cursor-pointer select-none leading-none"
              >
                Não solicitar neste dispositivo pelos próximos 30 dias
              </label>
            </div>
          ) : null}

          {/* Botão de Verificação */}
          <Button
            type={isSingleInput ? "submit" : "button"}
            onClick={
              isSingleInput
                ? undefined
                : () =>
                    handleVerify(
                      currentMethod === "backup_code" ? backupCodeInput : otpCode,
                    )
            }
            disabled={
              blocked ||
              (currentMethod === "backup_code" ? !backupCodeInput.trim() : otpCode.length < 6)
            }
            className={cn("w-full text-xs font-semibold h-10 shadow-xs gap-1.5", submitClassName)}
          >
            <ShieldCheck className="h-4 w-4" />
            {isLoading ? submitPendingLabel : submitLabel}
          </Button>

          {/* Rodapé / Alternar método */}
          {userContext.availableMethods.length > 1 && (
            <div className="text-center pt-2 border-t border-border/60">
              <button
                type="button"
                onClick={() => setShowMethodSelector(true)}
                className="text-xs font-semibold text-primary hover:underline cursor-pointer"
              >
                Problemas para acessar? Tentar de outra forma
              </button>
            </div>
          )}

          {/* Slot controlado pela página (CTA de enroll / status de lockout) */}
          {footer ? <div className="space-y-2 pt-2">{footer}</div> : null}
        </ChallengeFrame>
      )}
    </div>
  )
}
