import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, screen, userEvent, within } from "storybook/test"

import { NotificationCenter } from "./notification-center"

const meta = {
  title: "Shadcn/Navigation/NotificationCenter",
  component: NotificationCenter,
  decorators: [
    (Story) => (
      <div className="flex justify-end bg-background p-10 text-foreground">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof NotificationCenter>

export default meta
type Story = StoryObj<typeof meta>

export const Padrao: Story = {}

export const AbrirEFiltrar: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    await userEvent.click(
      canvas.getByRole("button", { name: /Notificações, 3 não lidas/ })
    )

    await expect(
      await screen.findByText("Limite Bacen próximo do teto")
    ).toBeVisible()

    await userEvent.click(screen.getByRole("tab", { name: /Críticas/ }))

    await expect(
      screen.queryByText("Fechamento 11/26 conciliado")
    ).not.toBeInTheDocument()
    await expect(
      screen.getByText("Webhook de liquidação falhou")
    ).toBeVisible()
  },
}
