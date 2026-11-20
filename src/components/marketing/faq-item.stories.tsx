import type { Meta, StoryObj } from "@storybook/react-vite"

import { FaqItem } from "./faq-item"

const meta = {
  title: "Marketing/FaqItem",
  component: FaqItem,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof FaqItem>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { question: "Preciso instalar algo?", answer: "Não." },
  render: () => (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <FaqItem
        question="Preciso instalar algo?"
        answer="Não. O Atlas Agenda roda no navegador do celular e do computador."
      />
    </div>
  ),
}

export const Dark: Story = {
  ...Default,
  decorators: [(Story) => (<div className="dark"><Story /></div>)],
}
