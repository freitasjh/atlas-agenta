import type { Meta, StoryObj } from "@storybook/react"
import { TransactionsView } from "./transactions-view"
import { INITIAL_TRANSACTIONS } from "./transaction-types"

const meta: Meta<typeof TransactionsView> = {
  title: "Shadcn/Transactions/TransactionsView",
  component: TransactionsView,
  parameters: {
    layout: "fullscreen",
  },
}

export default meta
type Story = StoryObj<typeof TransactionsView>

export const Default: Story = {
  args: {
    initialTransactions: INITIAL_TRANSACTIONS,
  },
}

export const Empty: Story = {
  args: {
    initialTransactions: [],
  },
}

