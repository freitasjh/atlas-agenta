import type { Meta, StoryObj } from "@storybook/react-vite"

import data from "@/app/dashboard/data.json"
import { DataTable } from "./data-table"

const meta = {
  title: "Shadcn/Dashboard/DataTable",
  component: DataTable,
  parameters: {
    layout: "padded",
  },
  args: {
    data,
  },
  decorators: [
    (Story) => (
      <div className="bg-background p-6 text-foreground">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof DataTable>

export default meta
type Story = StoryObj<typeof meta>

export const Light: Story = {}

export const Dark: Story = {
  decorators: [
    (Story) => (
      <div className="dark">
        <div className="bg-background p-6 text-foreground">
          <Story />
        </div>
      </div>
    ),
  ],
}

export const Vazio: Story = {
  args: {
    data: [],
  },
}

