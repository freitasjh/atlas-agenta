import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, screen, userEvent, within } from "storybook/test"

import { CreateEntrySheet } from "./create-entry-sheet"

const meta = {
  title: "Shadcn/Dashboard/CreateEntrySheet",
  component: CreateEntrySheet,
  parameters: {
    layout: "centered",
  },
  decorators: [
    (Story) => (
      <div className="flex min-h-[300px] items-center justify-center bg-background p-10 text-foreground">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CreateEntrySheet>

export default meta
type Story = StoryObj<typeof meta>

export const Fechado: Story = {}

export const Aberto: Story = {
  args: {
    open: true,
  },
}

export const Dark: Story = {
  args: {
    open: true,
  },
  decorators: [
    (Story) => (
      <div className="dark">
        <div className="flex min-h-[300px] items-center justify-center bg-background p-10 text-foreground">
          <Story />
        </div>
      </div>
    ),
  ],
}

export const PreencherEEnviar: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    const triggerButton = canvas.getByRole("button", { name: /Novo lançamento/ })
    await userEvent.click(triggerButton)

    const titleInput = await screen.findByLabelText(/Título do lançamento/)
    await expect(titleInput).toBeVisible()

    await userEvent.type(titleInput, "Assinatura Servidor Cloud AWS")

    const valueInput = screen.getByLabelText(/Valor previsto/)
    await userEvent.type(valueInput, "4500,00")

    const submitButton = screen.getByRole("button", { name: /Salvar Lançamento/ })
    await expect(submitButton).toBeEnabled()
  },
}

