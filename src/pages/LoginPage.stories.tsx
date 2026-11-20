import type { Meta, StoryObj } from "@storybook/react-vite"

import { LoginPage } from "./LoginPage"

const meta = {
  title: "Templates/Login",
  component: LoginPage,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof LoginPage>

export default meta
type Story = StoryObj<typeof meta>

export const Light: Story = {
  decorators: [
    (Story) => (
      <div className="min-h-svh bg-background text-foreground">
        <Story />
      </div>
    ),
  ],
}

export const Dark: Story = {
  decorators: [
    (Story) => (
      <div className="dark">
        <div className="min-h-svh bg-background text-foreground">
          <Story />
        </div>
      </div>
    ),
  ],
}
