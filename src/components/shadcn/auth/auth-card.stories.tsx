import type { Meta, StoryObj } from "@storybook/react-vite"

import { AuthCard } from "@/components/shadcn/auth/auth-card"

const meta = {
  title: "Auth/AuthCard",
  component: AuthCard,
  parameters: { layout: "centered" },
  decorators: [
    (Story) => (
      <div className="w-[360px] bg-background p-6 text-foreground">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AuthCard>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <AuthCard>
      <div className="p-6">
        <p className="font-display text-lg font-semibold">Cartão de autenticação</p>
        <p className="text-sm text-muted-foreground">
          Borda sutil e rim light superior, sem cor hardcoded.
        </p>
      </div>
    </AuthCard>
  ),
}
