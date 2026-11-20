import type { Meta, StoryObj } from "@storybook/react-vite"

import { LandingPage } from "./LandingPage"

const meta = {
  title: "Pages/LandingPage",
  component: LandingPage,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof LandingPage>

export default meta
type Story = StoryObj<typeof meta>

export const Light: Story = {}

export const Dark: Story = {
  decorators: [
    (Story) => (
      <div className="dark">
        <Story />
      </div>
    ),
  ],
}

