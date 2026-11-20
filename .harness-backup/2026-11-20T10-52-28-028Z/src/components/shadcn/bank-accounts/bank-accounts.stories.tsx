import type { Meta, StoryObj } from "@storybook/react"
import { BankAccountsView } from "./bank-accounts-view"
import { MOCK_BANK_ACCOUNTS, MOCK_BANK_TRANSACTIONS } from "./bank-accounts-types"

const meta: Meta<typeof BankAccountsView> = {
  title: "Shadcn/Finance/BankAccounts",
  component: BankAccountsView,
  parameters: {
    layout: "fullscreen",
  },
}

export default meta
type Story = StoryObj<typeof BankAccountsView>

/**
 * Modo Reduzido com Seletor Horizontal de Contas e Extrato Ativo (Padrão idêntico a Cartões).
 */
export const DefaultReducedView: Story = {
  args: {
    initialAccounts: MOCK_BANK_ACCOUNTS,
    initialTransactions: MOCK_BANK_TRANSACTIONS,
    initialViewMode: "statements",
  },
}

/**
 * Modo Carteira de Contas (Grid de Instituições e Saldos).
 */
export const WalletAccountsMode: Story = {
  args: {
    initialAccounts: MOCK_BANK_ACCOUNTS,
    initialTransactions: MOCK_BANK_TRANSACTIONS,
    initialViewMode: "grid",
  },
}

/**
 * Modo Escuro (Dark Mode).
 */
export const DarkMode: Story = {
  args: {
    initialAccounts: MOCK_BANK_ACCOUNTS,
    initialTransactions: MOCK_BANK_TRANSACTIONS,
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
