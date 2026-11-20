import type { Meta, StoryObj } from "@storybook/react"
import { SignupWizardCard } from "./signup-wizard-card"
import { SignupStepCredentials } from "./signup-step-credentials"
import { SignupStepWorkspace } from "./signup-step-workspace"
import { SignupStepInvite } from "./signup-step-invite"

const meta: Meta<typeof SignupWizardCard> = {
  title: "Shadcn/Auth/SignupWizard",
  component: SignupWizardCard,
  parameters: {
    layout: "centered",
  },
}

export default meta
type Story = StoryObj<typeof SignupWizardCard>

/**
 * Fluxo interativo completo em 3 etapas (Credenciais -> Workspace -> Convite).
 */
export const FullWizardFlow: Story = {
  render: () => (
    <div className="w-[420px] rounded-2xl border border-border/80 bg-card p-6 shadow-lg">
      <SignupWizardCard
        onSuccess={(data) => {
          console.log("Cadastro concluído com sucesso:", data)
        }}
        onNavigateLogin={() => {
          alert("Navegando para tela de login")
        }}
      />
    </div>
  ),
}

/**
 * Passo 1 isolado: Credenciais, Social Auth e Medidor de Força de Senha.
 */
export const Step1CredentialsOnly: StoryObj = {
  render: () => (
    <div className="w-[420px] rounded-2xl border border-border/80 bg-card p-6 shadow-lg">
      <SignupStepCredentials
        initialData={{
          fullName: "",
          email: "",
          password: "",
          agreeTerms: true,
        }}
        onNext={(data) => {
          alert(`Passo 1 concluído para: ${data.fullName} (${data.email})`)
        }}
        onSocialAuth={(p) => alert(`Autenticação com ${p}`)}
        onNavigateLogin={() => alert("Ir para login")}
      />
    </div>
  ),
}

/**
 * Passo 2 isolado: Personalização do Workspace, Slug e Tamanho da Equipe.
 */
export const Step2WorkspaceOnly: StoryObj = {
  render: () => (
    <div className="w-[420px] rounded-2xl border border-border/80 bg-card p-6 shadow-lg">
      <SignupStepWorkspace
        initialData={{
          companyName: "Acme Tech",
          workspaceSlug: "acme-tech",
          teamSize: "11-50",
          role: "engineering",
        }}
        onNext={(data) => {
          alert(`Passo 2 concluído: ${data.companyName} (${data.teamSize})`)
        }}
        onBack={() => alert("Voltar")}
      />
    </div>
  ),
}

/**
 * Passo 3 isolado: Convite de Membros com Tags/Chips e Atalho de Pular.
 */
export const Step3TeamInviteOnly: StoryObj = {
  render: () => (
    <div className="w-[420px] rounded-2xl border border-border/80 bg-card p-6 shadow-lg">
      <SignupStepInvite
        initialData={{
          inviteEmails: ["dev@acme.com", "product@acme.com"],
        }}
        onFinish={(data) => {
          alert(`Workspace finalizado com ${data.inviteEmails.length} convites`)
        }}
        onSkip={() => alert("Pulou convites")}
        onBack={() => alert("Voltar")}
      />
    </div>
  ),
}

/**
 * Visualização completa no Tema Escuro (Dark Mode).
 */
export const DarkMode: Story = {
  render: () => (
    <div className="dark bg-background text-foreground p-8 rounded-2xl min-w-[460px]">
      <div className="w-[420px] rounded-2xl border border-border/80 bg-card p-6 shadow-lg">
        <SignupWizardCard />
      </div>
    </div>
  ),
}

