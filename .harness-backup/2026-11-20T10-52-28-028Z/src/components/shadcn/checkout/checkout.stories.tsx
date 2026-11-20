import type { Meta, StoryObj } from "@storybook/react"
import { CheckoutView } from "./checkout-view"
import { INITIAL_ORDER_ITEMS } from "./checkout-types"

const meta: Meta<typeof CheckoutView> = {
  title: "Shadcn/Checkout/CheckoutView",
  component: CheckoutView,
  parameters: {
    layout: "fullscreen",
  },
}

export default meta
type Story = StoryObj<typeof CheckoutView>

export const Default: Story = {
  args: {
    initialItems: INITIAL_ORDER_ITEMS,
  },
}

export const SingleItem: Story = {
  args: {
    initialItems: [
      {
        id: "item-custom",
        name: "Licença Atlas Pro (Anual)",
        category: "Assinatura",
        price: 199.0,
        quantity: 1,
        description: "Acesso total à biblioteca de componentes e templates",
        badge: "Destaque",
      },
    ],
  },
}

