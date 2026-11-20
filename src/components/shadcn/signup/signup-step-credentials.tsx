import { useState } from "react"
import { Eye, EyeOff, ArrowRight, Building } from "lucide-react"
import { Button } from "@/components/shadcn/ui/button"
import { Input } from "@/components/shadcn/ui/input"
import { Label } from "@/components/shadcn/ui/label"
import { Checkbox } from "@/components/shadcn/ui/checkbox"
import { PasswordStrengthMeter } from "./password-strength-meter"
import { evaluatePasswordStrength, type SignupCredentialsData } from "./signup-types"

interface SignupStepCredentialsProps {
  initialData: SignupCredentialsData
  onNext: (data: SignupCredentialsData) => void
  onSocialAuth?: (provider: "google" | "github") => void
  onNavigateLogin?: () => void
}

export function SignupStepCredentials({
  initialData,
  onNext,
  onSocialAuth,
  onNavigateLogin,
}: SignupStepCredentialsProps) {
  const [fullName, setFullName] = useState(initialData.fullName)
  const [email, setEmail] = useState(initialData.email)
  const [password, setPassword] = useState(initialData.password)
  const [showPassword, setShowPassword] = useState(false)
  const [agreeTerms, setAgreeTerms] = useState(initialData.agreeTerms)

  const passwordEvaluation = evaluatePasswordStrength(password)
  const isPasswordValid = passwordEvaluation.score >= 2 && passwordEvaluation.hasMinLength

  const isFormValid =
    fullName.trim().length >= 2 &&
    email.includes("@") &&
    isPasswordValid &&
    agreeTerms

  // Detecção de domínio corporativo
  const isCorporateDomain = email.includes("@") && !/@(gmail|hotmail|yahoo|outlook|live)\./i.test(email)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!isFormValid) return
    onNext({
      fullName: fullName.trim(),
      email: email.trim(),
      password,
      agreeTerms,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Botões de Social Auth */}
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2.5">
          <Button
            type="button"
            variant="outline"
            onClick={() => onSocialAuth?.("google")}
            className="h-10 text-xs font-semibold gap-2 border-border/80 hover:bg-muted/60"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24Z"
              />
              <path
                fill="#FBBC05"
                d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.14-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15Z"
              />
              <path
                fill="#EA4335"
                d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98Z"
              />
            </svg>
            Google
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={() => onSocialAuth?.("github")}
            className="h-10 text-xs font-semibold gap-2 border-border/80 hover:bg-muted/60"
          >
            <svg className="h-4 w-4 fill-current" viewBox="0 0 24 24">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12Z" />
            </svg>
            GitHub
          </Button>
        </div>

        <div className="relative py-2">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-border/70" />
          </div>
          <div className="relative flex justify-center text-[11px] uppercase tracking-wider">
            <span className="bg-card px-2 text-muted-foreground font-medium">
              ou continue com seu e-mail
            </span>
          </div>
        </div>
      </div>

      {/* Nome Completo */}
      <div className="space-y-1.5">
        <Label htmlFor="signup-name" className="text-xs font-semibold">
          Nome Completo
        </Label>
        <Input
          id="signup-name"
          type="text"
          placeholder="Ex: João da Silva"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          autoComplete="name"
          required
          className="text-xs h-10 w-full"
        />
      </div>

      {/* E-mail Profissional */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="signup-email" className="text-xs font-semibold">
            E-mail Profissional
          </Label>
          {isCorporateDomain && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary">
              <Building className="h-3 w-3" />
              Domínio Corporativo
            </span>
          )}
        </div>
        <Input
          id="signup-email"
          type="email"
          placeholder="nome@suaempresa.com.br"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          required
          className="text-xs h-10 w-full"
        />
      </div>

      {/* Senha com Toggle e Medidor de Força */}
      <div className="space-y-1.5">
        <Label htmlFor="signup-password" className="text-xs font-semibold">
          Criar Senha Segura
        </Label>
        <div className="relative">
          <Input
            id="signup-password"
            type={showPassword ? "text" : "password"}
            placeholder="Mínimo de 8 caracteres"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            required
            className="text-xs h-10 w-full pr-10"
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            aria-label={showPassword ? "Ocultar senha" : "Exibir senha"}
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>

        {/* Medidor inline dinâmico */}
        <PasswordStrengthMeter password={password} />
      </div>

      {/* Checkbox de Termos */}
      <div className="flex items-start space-x-2 pt-1">
        <Checkbox
          id="agree-terms"
          checked={agreeTerms}
          onCheckedChange={(checked) => setAgreeTerms(Boolean(checked))}
        />
        <label
          htmlFor="agree-terms"
          className="text-[11px] text-muted-foreground leading-snug cursor-pointer select-none"
        >
          Concordo com os{" "}
          <a href="#termos" className="text-primary font-semibold hover:underline">
            Termos de Serviço
          </a>{" "}
          e com a{" "}
          <a href="#privacidade" className="text-primary font-semibold hover:underline">
            Política de Privacidade
          </a>
          .
        </label>
      </div>

      {/* Botão de Avanço */}
      <Button
        type="submit"
        disabled={!isFormValid}
        className="w-full h-10 text-xs font-semibold gap-2 shadow-xs mt-2"
      >
        <span>Continuar para Workspace</span>
        <ArrowRight className="h-4 w-4" />
      </Button>

      {/* Link para Login */}
      <p className="text-center text-xs text-muted-foreground pt-1">
        Já possui uma conta?{" "}
        <button
          type="button"
          onClick={onNavigateLogin}
          className="font-bold text-primary hover:underline cursor-pointer"
        >
          Fazer login
        </button>
      </p>
    </form>
  )
}
