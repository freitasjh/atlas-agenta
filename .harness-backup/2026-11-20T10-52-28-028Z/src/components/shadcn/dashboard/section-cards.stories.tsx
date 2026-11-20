import type { Meta, StoryObj } from "@storybook/react-vite"

import { SectionCards } from "./section-cards"

const meta = {
  title: "Shadcn/Dashboard/SectionCards",
  component: SectionCards,
  parameters: {
    layout: "padded",
  },
  decorators: [
    (Story) => (
      <div className="bg-background p-6 text-foreground">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SectionCards>

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

