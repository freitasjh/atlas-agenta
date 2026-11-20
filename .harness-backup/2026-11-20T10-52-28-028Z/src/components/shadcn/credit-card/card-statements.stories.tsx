import type { Meta, StoryObj } from "@storybook/react"
import { CardStatementsView } from "./card-statements-view"
import { MOCK_CARDS_WITH_INVOICES } from "./statement-types"

const meta: Meta<typeof CardStatementsView> = {
  title: "Shadcn/Finance/CardStatements",
  component: CardStatementsView,
  parameters: {
    layout: "fullscreen",
  },
}

export default meta
type Story = StoryObj<typeof CardStatementsView>

/**
 * Visão completa de Faturas, Lançamentos em tempo real e Extrato do Cartão.
 */
export const DefaultStatements: Story = {
  args: {
    initialCards: MOCK_CARDS_WITH_INVOICES,
    initialViewMode: "statements",
  },
}

/**
 * Modo Carteira de Cartões (Wallet Management).
 */
export const WalletCardsMode: Story = {
  args: {
    initialCards: MOCK_CARDS_WITH_INVOICES,
    initialViewMode: "wallet",
  },
}

/**
 * Modo Escuro (Dark Mode).
 */
export const DarkMode: Story = {
  args: {
    initialCards: MOCK_CARDS_WITH_INVOICES,
    initialViewMode: "statements",
  },
  decorators: [
    (Story) => (
      <div className="dark bg-background text-foreground min-h-screen p-6">
        <Story />
      </div>
    ),
  ],
}

