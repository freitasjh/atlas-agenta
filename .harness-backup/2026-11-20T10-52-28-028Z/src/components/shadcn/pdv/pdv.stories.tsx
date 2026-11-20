import type { Meta, StoryObj } from "@storybook/react"
import { PDVView } from "./pdv-view"
import { MOCK_PDV_PRODUCTS } from "./pdv-types"

const meta: Meta<typeof PDVView> = {
  title: "Shadcn/Retail/PDV",
  component: PDVView,
  parameters: {
    layout: "fullscreen",
  },
}

export default meta
type Story = StoryObj<typeof PDVView>

/**
 * Frente de Caixa PDV padrão com itens na comanda e caixa operacional.
 */
export const DefaultPDV: Story = {
  args: {
    initialProducts: MOCK_PDV_PRODUCTS,
  },
}

/**
 * Modo Escuro (Dark Mode) para ambientes com baixa luminosidade ou bares/restaurantes.
 */
export const DarkMode: Story = {
  args: {
    initialProducts: MOCK_PDV_PRODUCTS,
  },
  decorators: [
    (Story) => (
      <div className="dark bg-background text-foreground min-h-screen">
        <Story />
      </div>
    ),
  ],
}

