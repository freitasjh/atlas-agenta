import type { Meta, StoryObj } from "@storybook/react"
import { SettingsView } from "./settings-view"

const meta: Meta<typeof SettingsView> = {
  title: "Shadcn/Settings/SettingsView",
  component: SettingsView,
  parameters: { layout: "fullscreen" },
}

export default meta
type Story = StoryObj<typeof SettingsView>

export const Default: Story = {}

export const Security: Story = { args: { initialSection: "security" } }

export const Permissions: Story = { args: { initialSection: "team" } }

export const DangerZone: Story = { args: { initialSection: "advanced" } }

export const DarkMode: Story = {
  decorators: [
    (Story) => (
      <div className="dark min-h-screen bg-background text-foreground">
        <Story />
      </div>
    ),
  ],
}

