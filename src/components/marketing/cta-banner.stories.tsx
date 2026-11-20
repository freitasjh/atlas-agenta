import type { Meta, StoryObj } from "@storybook/react-vite"

import { Zap } from "lucide-react"

import { CtaBanner } from "./cta-banner"

const meta = {
  title: "Marketing/CtaBanner",
  component: CtaBanner,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof CtaBanner>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    badge: (
      <>
        <Zap className="h-3.5 w-3.5" aria-hidden="true" />
        <span>Modernize sua operação hoje</span>
      </>
    ),
    headline: "Pronto para transformar a produtividade da sua equipe?",
    subheadline: "Junte-se a quem já reduziu faltas e organizou a cobrança.",
    primaryCta: { label: "Começar agora", to: "/cadastro" },
    secondaryCta: { label: "Ver planos", to: "/precos", variant: "secondary" },
  },

}

export const Dark: Story = {
  ...Default,
  decorators: [(Story) => (<div className="dark"><Story /></div>)],
}
