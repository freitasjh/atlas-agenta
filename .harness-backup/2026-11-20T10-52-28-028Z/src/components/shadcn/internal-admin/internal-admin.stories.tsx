import type { Meta, StoryObj } from "@storybook/react"
import { InternalAdminView } from "./internal-admin-view"
import { INITIAL_TENANTS, INITIAL_SAAS_KPIS } from "./internal-admin-types"

const meta: Meta<typeof InternalAdminView> = {
  title: "Shadcn/InternalAdmin/InternalAdminView",
  component: InternalAdminView,
  parameters: {
    layout: "fullscreen",
  },
}

export default meta
type Story = StoryObj<typeof InternalAdminView>

export const Default: Story = {
  args: {
    initialTenants: INITIAL_TENANTS,
    initialKpis: INITIAL_SAAS_KPIS,
  },
}

export const Empty: Story = {
  args: {
    initialTenants: [],
    initialKpis: {
      ...INITIAL_SAAS_KPIS,
      totalTenants: 0,
      activeTenants: 0,
      totalMrr: 0,
      trialsCount: 0,
      pastDueTenantsCount: 0,
      criticalQuotaTenantsCount: 0,
    },
  },
}

