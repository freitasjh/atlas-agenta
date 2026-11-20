import type { Meta, StoryObj } from "@storybook/react-vite"
import { MemoryRouter } from "react-router-dom"

import { SignupPage } from "./SignupPage"

const meta = {
  title: "Pages/SignupPage",
  component: SignupPage,
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <MemoryRouter>{Story()}</MemoryRouter>],
} satisfies Meta<typeof SignupPage>

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

