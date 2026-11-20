import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, within } from "storybook/test"

import { KanbanBoard } from "./kanban-board"

const meta = {
  title: "Shadcn/Kanban/KanbanBoard",
  component: KanbanBoard,
  parameters: {
    layout: "padded",
  },
  decorators: [
    (Story) => (
      <div className="min-h-[600px] w-full bg-background p-6 text-foreground">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof KanbanBoard>

export default meta
type Story = StoryObj<typeof meta>

export const Light: Story = {}

export const Dark: Story = {
  decorators: [
    (Story) => (
      <div className="dark">
        <div className="min-h-[600px] w-full bg-background p-6 text-foreground">
          <Story />
        </div>
      </div>
    ),
  ],
}

export const BuscarTarefa: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    const searchInput = canvas.getByPlaceholderText("Buscar no board...")
    await expect(searchInput).toBeVisible()

    await userEvent.type(searchInput, "mTLS")

    await expect(
      await canvas.findByText("Validar certificado mTLS para integração Itaú Custódia")
    ).toBeVisible()

    await expect(
      canvas.queryByText("Conciliação automática de recebíveis Stone Lote #894")
    ).not.toBeInTheDocument()
  },
}
