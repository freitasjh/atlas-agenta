import { useState } from "react"
import { ArrowLeft, Check, Plus, X, Sparkles, ShieldCheck } from "lucide-react"
import { Button } from "@/components/shadcn/ui/button"
import { Input } from "@/components/shadcn/ui/input"
import { Label } from "@/components/shadcn/ui/label"
import { Badge } from "@/components/shadcn/ui/badge"
import type { SignupInviteData } from "./signup-types"

interface SignupStepInviteProps {
  initialData: SignupInviteData
  isLoading?: boolean
  onFinish: (data: SignupInviteData) => void
  onSkip: () => void
  onBack: () => void
}

export function SignupStepInvite({
  initialData,
  isLoading = false,
  onFinish,
  onSkip,
  onBack,
}: SignupStepInviteProps) {
  const [emails, setEmails] = useState<string[]>(initialData.inviteEmails || [])
  const [currentEmail, setCurrentEmail] = useState("")

  const handleAddEmail = () => {
    const trimmed = currentEmail.trim().toLowerCase()
    if (trimmed && trimmed.includes("@") && !emails.includes(trimmed)) {
      setEmails([...emails, trimmed])
      setCurrentEmail("")
    }
  }

  const handleRemoveEmail = (emailToRemove: string) => {
    setEmails(emails.filter((e) => e !== emailToRemove))
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault()
      handleAddEmail()
    }
  }

  return (
    <div className="space-y-5">
      {/* Cabeçalho */}
      <div className="space-y-1">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-[10px] font-semibold text-primary">
          <Sparkles className="h-3 w-3" />
          Quase lá!
        </div>
        <h3 className="text-base font-bold tracking-tight text-foreground">
          Convide seus colegas de equipe
        </h3>
        <p className="text-xs text-muted-foreground">
          Compartilhe o acesso para começarem a colaborar em tempo real (opcional).
        </p>
      </div>

      {/* Input de Adição de E-mails */}
      <div className="space-y-2">
        <Label htmlFor="invite-input" className="text-xs font-semibold">
          E-mail dos colegas
        </Label>
        <div className="flex gap-2">
          <Input
            id="invite-input"
            type="email"
            placeholder="colega@suaempresa.com.br"
            value={currentEmail}
            onChange={(e) => setCurrentEmail(e.target.value)}
            onKeyDown={handleKeyDown}
            className="text-xs h-10 flex-1"
          />
          <Button
            type="button"
            variant="outline"
            onClick={handleAddEmail}
            disabled={!currentEmail.includes("@")}
            className="h-10 text-xs font-semibold gap-1 shrink-0"
          >
            <Plus className="h-3.5 w-3.5" />
            Adicionar
          </Button>
        </div>
        <span className="text-[11px] text-muted-foreground block">
          Pressione Enter para adicionar múltiplos e-mails.
        </span>
      </div>

      {/* Lista de Chips de E-mails Adicionados */}
      {emails.length > 0 && (
        <div className="space-y-2 rounded-xl border border-border/70 bg-muted/30 p-3">
          <span className="text-[11px] font-semibold text-muted-foreground block">
            {emails.length} {emails.length === 1 ? "convite preparado" : "convites preparados"}:
          </span>
          <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto">
            {emails.map((email) => (
              <Badge
                key={email}
                variant="secondary"
                className="text-xs font-mono py-1 px-2.5 gap-1.5 bg-background border border-border"
              >
                <span>{email}</span>
                <button
                  type="button"
                  onClick={() => handleRemoveEmail(email)}
                  className="text-muted-foreground hover:text-foreground cursor-pointer"
                  aria-label={`Remover ${email}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Banner de Boas-Vindas */}
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 flex items-start gap-3">
        <ShieldCheck className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
        <div className="text-xs space-y-0.5">
          <span className="font-bold text-emerald-600 dark:text-emerald-400 block">
            Teste Gratuito Pro Ativado
          </span>
          <p className="text-muted-foreground leading-relaxed">
            Seu workspace terá acesso irrestrito a todos os módulos, templates e dashboards por 14
            dias, sem necessidade de cartão de crédito.
          </p>
        </div>
      </div>

      {/* Ações */}
      <div className="space-y-2 pt-2">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onBack}
            disabled={isLoading}
            className="h-10 text-xs font-semibold gap-1.5"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Voltar
          </Button>

          <Button
            type="button"
            onClick={() => onFinish({ inviteEmails: emails })}
            disabled={isLoading}
            className="flex-1 h-10 text-xs font-semibold gap-2 shadow-xs bg-primary text-primary-foreground"
          >
            {isLoading ? (
              <span>Criando seu Workspace...</span>
            ) : (
              <>
                <Check className="h-4 w-4" />
                <span>Concluir e Acessar Painel</span>
              </>
            )}
          </Button>
        </div>

        {/* Botão de Pular */}
        <div className="text-center pt-1">
          <button
            type="button"
            onClick={onSkip}
            disabled={isLoading}
            className="text-xs text-muted-foreground font-semibold hover:text-foreground hover:underline cursor-pointer"
          >
            Pular esta etapa e convidar colegas mais tarde
          </button>
        </div>
      </div>
    </div>
  )
}
