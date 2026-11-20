import { useState } from "react"
import { toast } from "sonner"
import { SignupStepper } from "./signup-stepper"
import { SignupStepCredentials } from "./signup-step-credentials"
import { SignupStepWorkspace } from "./signup-step-workspace"
import { SignupStepInvite } from "./signup-step-invite"
import type {
  SignupCredentialsData,
  SignupWorkspaceData,
  SignupInviteData,
  SignupFullFormData,
} from "./signup-types"

export interface SignupWizardCardProps {
  onSuccess?: (data: SignupFullFormData) => void
  onNavigateLogin?: () => void
  onSocialAuth?: (provider: "google" | "github") => void
  initialStep?: 1 | 2 | 3
}

export function SignupWizardCard({
  onSuccess,
  onNavigateLogin,
  onSocialAuth,
  initialStep = 1,
}: SignupWizardCardProps) {
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(initialStep)
  const [isLoading, setIsLoading] = useState(false)

  // Estado unificado dos passos
  const [formData, setFormData] = useState<SignupFullFormData>({
    fullName: "",
    email: "",
    password: "",
    agreeTerms: true,
    companyName: "",
    workspaceSlug: "",
    teamSize: "2-10",
    role: "engineering",
    inviteEmails: [],
  })

  // Passo 1 -> Passo 2
  const handleCredentialsComplete = (stepData: SignupCredentialsData) => {
    setFormData((prev) => ({
      ...prev,
      ...stepData,
      // Pré-preenche o nome da empresa se ainda não preenchido
      companyName: prev.companyName || `${stepData.fullName.split(" ")[0]} Workspace`,
      workspaceSlug:
        prev.workspaceSlug ||
        stepData.fullName
          .split(" ")[0]
          .toLowerCase()
          .replace(/[^a-z0-9]/g, ""),
    }))
    setCurrentStep(2)
  }

  // Passo 2 -> Passo 3
  const handleWorkspaceComplete = (stepData: SignupWorkspaceData) => {
    setFormData((prev) => ({ ...prev, ...stepData }))
    setCurrentStep(3)
  }

  // Passo 3 Concluir
  const handleFinalSubmit = async (inviteData: SignupInviteData) => {
    const fullData: SignupFullFormData = {
      ...formData,
      inviteEmails: inviteData.inviteEmails,
    }

    setIsLoading(true)

    // Simula criação do workspace e provisionamento
    setTimeout(() => {
      setIsLoading(false)
      toast.success("Workspace criado com sucesso!", {
        description: `Bem-vindo(a) ao Atlas, ${fullData.fullName}! Seu workspace '${fullData.companyName}' está pronto.`,
      })

      if (onSuccess) {
        onSuccess(fullData)
      } else {
        window.location.hash = "#/shadcn"
      }
    }, 900)
  }

  const handleSkipInvites = () => {
    handleFinalSubmit({ inviteEmails: [] })
  }

  return (
    <div className="w-full space-y-4">
      {/* Stepper de Progresso */}
      <SignupStepper currentStep={currentStep} />

      {/* Renderização do Passo Atual */}
      <div className="pt-2">
        {currentStep === 1 && (
          <SignupStepCredentials
            initialData={{
              fullName: formData.fullName,
              email: formData.email,
              password: formData.password,
              agreeTerms: formData.agreeTerms,
            }}
            onNext={handleCredentialsComplete}
            onSocialAuth={onSocialAuth}
            onNavigateLogin={onNavigateLogin}
          />
        )}

        {currentStep === 2 && (
          <SignupStepWorkspace
            initialData={{
              companyName: formData.companyName,
              workspaceSlug: formData.workspaceSlug,
              teamSize: formData.teamSize,
              role: formData.role,
            }}
            onNext={handleWorkspaceComplete}
            onBack={() => setCurrentStep(1)}
          />
        )}

        {currentStep === 3 && (
          <SignupStepInvite
            initialData={{
              inviteEmails: formData.inviteEmails,
            }}
            isLoading={isLoading}
            onFinish={handleFinalSubmit}
            onSkip={handleSkipInvites}
            onBack={() => setCurrentStep(2)}
          />
        )}
      </div>
    </div>
  )
}

