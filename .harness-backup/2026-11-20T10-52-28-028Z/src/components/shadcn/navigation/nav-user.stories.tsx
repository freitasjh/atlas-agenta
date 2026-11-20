import type { Meta, StoryObj } from "@storybook/react-vite"

import { SidebarProvider } from "@/components/shadcn/ui/sidebar"
import { NavUser } from "./nav-user"

const meta = {
  title: "Shadcn/Navigation/NavUser",
  component: NavUser,
  args: {
    user: {
      name: "Atlas Admin",
      email: "admin@atlas.com.br",
      avatar: "",
    },
  },
  decorators: [
    (Story) => (
      <SidebarProvider className="min-h-auto w-64 bg-sidebar p-4 text-sidebar-foreground">
        <Story />
      </SidebarProvider>
    ),
  ],
} satisfies Meta<typeof NavUser>

export default meta
type Story = StoryObj<typeof meta>

export const Light: Story = {}

export const Dark: Story = {
  decorators: [
    (Story) => (
      <div className="dark">
        <SidebarProvider className="min-h-auto w-64 bg-sidebar p-4 text-sidebar-foreground">
          <Story />
        </SidebarProvider>
      </div>
    ),
  ],
}

