import type { Meta, StoryObj } from "@storybook/react"
import { BackofficeView } from "./backoffice-view"
import { 
  INITIAL_QUEUE_CASES, 
  INITIAL_AUDIT_LOGS, 
  INITIAL_SERVICES_HEALTH, 
  INITIAL_BACKOFFICE_METRICS 
} from "./backoffice-types"

const meta: Meta<typeof BackofficeView> = {
  title: "Shadcn/Backoffice/BackofficeView",
  component: BackofficeView,
  parameters: {
    layout: "fullscreen",
  },
}

export default meta
type Story = StoryObj<typeof BackofficeView>

export const Default: Story = {
  args: {
    initialCases: INITIAL_QUEUE_CASES,
    initialAuditLogs: INITIAL_AUDIT_LOGS,
    initialServices: INITIAL_SERVICES_HEALTH,
    initialMetrics: INITIAL_BACKOFFICE_METRICS,
  },
}

export const EmptyQueue: Story = {
  args: {
    initialCases: [],
    initialAuditLogs: INITIAL_AUDIT_LOGS,
    initialServices: INITIAL_SERVICES_HEALTH,
    initialMetrics: {
      ...INITIAL_BACKOFFICE_METRICS,
      pendingCasesCount: 0,
      fraudAlertsCount: 0,
      disputesCount: 0,
      activeDisputesAmount: 0,
    },
  },
}

