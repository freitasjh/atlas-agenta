import type { Meta, StoryObj } from "@storybook/react"
import { AIWorkspaceView } from "./ai-workspace-view"
import { MOCK_AI_THREADS } from "./ai-types"

const meta: Meta<typeof AIWorkspaceView> = {
  title: "Shadcn/AI/AIWorkspaceView",
  component: AIWorkspaceView,
  parameters: {
    layout: "fullscreen",
  },
}

export default meta
type Story = StoryObj<typeof AIWorkspaceView>

export const DefaultWorkspace: Story = {}

export const NewConversationEmptyState: Story = {
  args: {
    initialThreads: [
      {
        id: "thread-empty",
        title: "Nova Conversa",
        personaId: "financial-copilot",
        updatedAt: "Agora",
        totalTokens: 0,
        messages: [],
        artifacts: [],
      },
      ...MOCK_AI_THREADS,
    ],
    initialThreadId: "thread-empty",
    initialArtifactOpen: false,
  },
}

export const ToolApprovalFlow: Story = {
  args: {
    initialThreadId: "thread-dre-fechamento",
    initialArtifactOpen: false,
  },
}

export const DarkMode: Story = {
  decorators: [
    (Story) => (
      <div className="dark min-h-screen bg-background text-foreground">
        <Story />
      </div>
    ),
  ],
}

