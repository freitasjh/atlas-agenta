import { useState } from "react"
import type { Meta, StoryObj } from "@storybook/react"
import { MfaChallengeCard } from "./mfa-challenge-card"
import { MfaSetupDialog } from "./mfa-setup-dialog"
import { MfaBackupCodesDialog, type BackupCodeItem } from "./mfa-backup-codes-dialog"
import { Button } from "@/components/shadcn/ui/button"
import type { MfaUserContext, MfaSetupData } from "./mfa-types"

const mockUserContext: MfaUserContext = {
  userId: "usr_109283",
  userEmail: "joao.silva@empresa.com.br",
  phoneNumberMasked: "(11) 9****-4589",
  preferredMethod: "totp",
  availableMethods: ["totp", "sms", "backup_code"],
}

const mockSetupData: MfaSetupData = {
  secretKey: "JBSWY3DPEHPK3PXP",
  qrCodeUrl:
    "https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=otpauth%3A%2F%2Ftotp%2FAtlas%3Ajoao.silva%40empresa.com.br%3Fsecret%3DJBSWY3DPEHPK3PXP%26issuer%3DAtlas",
  issuer: "Atlas Platform",
  accountName: "joao.silva@empresa.com.br",
  backupCodes: [
    "a1b2-c3d4",
    "e5f6-g7h8",
    "i9j0-k1l2",
    "m3n4-o5p6",
    "q7r8-s9t0",
    "u1v2-w3x4",
    "y5z6-a7b8",
    "c9d0-e1f2",
    "g3h4-i5j6",
    "k7l8-m9n0",
  ],
}

const mockBackupCodes: BackupCodeItem[] = [
  { code: "a1b2-c3d4", used: true, usedAt: "2026-10-15" },
  { code: "e5f6-g7h8", used: true, usedAt: "2026-11-02" },
  { code: "i9j0-k1l2", used: false },
  { code: "m3n4-o5p6", used: false },
  { code: "q7r8-s9t0", used: false },
  { code: "u1v2-w3x4", used: false },
  { code: "y5z6-a7b8", used: false },
  { code: "c9d0-e1f2", used: false },
  { code: "g3h4-i5j6", used: false },
  { code: "k7l8-m9n0", used: false },
]

const meta: Meta<typeof MfaChallengeCard> = {
  title: "Shadcn/Auth/MFA",
  component: MfaChallengeCard,
  parameters: {
    layout: "centered",
  },
}

export default meta
type Story = StoryObj<typeof MfaChallengeCard>

/**
 * Desafio MFA padrão via TOTP (Google Authenticator / Authy / 1Password).
 */
export const ChallengeTOTP: Story = {
  args: {
    userContext: mockUserContext,
    onVerify: async ({ code }) => {
      await new Promise((r) => setTimeout(r, 600))
      if (code === "123456") {
        return { success: true }
      }
      return { success: false, message: "Código incorreto. Digite '123456' para testar sucesso." }
    },
  },
}

/**
 * Desafio MFA via SMS com número mascarado e suporte a reenvio.
 */
export const ChallengeSMS: Story = {
  args: {
    userContext: {
      ...mockUserContext,
      preferredMethod: "sms",
    },
    onVerify: async ({ code }) => {
      await new Promise((r) => setTimeout(r, 500))
      return { success: code === "123456" }
    },
    onResendCode: async () => {
      await new Promise((r) => setTimeout(r, 400))
    },
  },
}

/**
 * Desafio MFA com erro de validação imediato.
 */
export const ChallengeWithError: Story = {
  args: {
    userContext: mockUserContext,
    onVerify: async () => {
      return { success: false, message: "Código expirado ou inválido (2 tentativas restantes)." }
    },
  },
}

function SetupDialogDemo() {
  const [open, setOpen] = useState(true)
  return (
    <div className="p-6">
      <Button onClick={() => setOpen(true)}>Abrir Configuração de MFA</Button>
      <MfaSetupDialog
        open={open}
        onOpenChange={setOpen}
        setupData={mockSetupData}
        onConfirmCode={async (code) => {
          await new Promise((r) => setTimeout(r, 500))
          return code === "123456"
        }}
        onFinishSetup={() => {
          setOpen(false)
        }}
      />
    </div>
  )
}

function BackupCodesDemo() {
  const [open, setOpen] = useState(true)
  const [codes, setCodes] = useState(mockBackupCodes)
  return (
    <div className="p-6">
      <Button onClick={() => setOpen(true)}>Gerenciar Códigos de Recuperação</Button>
      <MfaBackupCodesDialog
        open={open}
        onOpenChange={setOpen}
        codes={codes}
        onRegenerateCodes={async () => {
          await new Promise((r) => setTimeout(r, 500))
          const newCodes = mockSetupData.backupCodes.map((code) => ({
            code,
            used: false,
          }))
          setCodes(newCodes)
          return newCodes
        }}
      />
    </div>
  )
}

/**
 * Fluxo interativo de Ativação e Configuração de MFA (QR Code, Código de Teste e Códigos de Recuperação).
 */
export const SetupDialogInteractive: StoryObj = {
  render: () => <SetupDialogDemo />,
}

/**
 * Gerenciamento e visualização de Códigos de Recuperação de Emergência.
 */
export const BackupCodesManagement: StoryObj = {
  render: () => <BackupCodesDemo />,
}

/**
 * Desafio MFA em Dark Mode.
 */
export const ChallengeDarkMode: Story = {
  args: {
    userContext: mockUserContext,
    onVerify: async ({ code }) => ({ success: code === "123456" }),
  },
  decorators: [
    (Story) => (
      <div className="dark bg-background text-foreground p-8 rounded-2xl min-w-[480px]">
        <Story />
      </div>
    ),
  ],
}
