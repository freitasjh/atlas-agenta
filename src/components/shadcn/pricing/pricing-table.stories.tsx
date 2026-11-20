import type { Meta, StoryObj } from "@storybook/react-vite"

import { PricingTable } from "./pricing-table"

const meta = {
  title: "Shadcn/Pricing/PricingTable",
  component: PricingTable,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof PricingTable>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    showComparison: true,
  },
}

export const DarkMode: Story = {
  decorators: [
    (Story) => (
      <div className="dark min-h-screen bg-background text-foreground p-6">
        <Story />
      </div>
    ),
  ],
}

