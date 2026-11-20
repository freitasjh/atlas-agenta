import type { Meta, StoryObj } from "@storybook/react-vite"

import { Calendar, Kanban } from "lucide-react"

import { BentoCard } from "./bento-card"

const meta = {
  title: "Marketing/BentoCard",
  component: BentoCard,
  parameters: { layout: "centered" },
} satisfies Meta<typeof BentoCard>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    title: "Grade de Agendamento Multi-Profissional",
    description: "Coordene múltiplos especialistas lado a lado.",
  },
}

export const WithIcon: Story = {
  args: {
    icon: <Calendar className="h-5 w-5" aria-hidden="true" />,
    iconClassName: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    title: "Grade de Agendamento Multi-Profissional",
    description: "Coordene múltiplos especialistas lado a lado.",
  },
}

export const WithoutIcon: Story = {
  args: {
    title: "Sem ícone",
    description: "Card sem ícone no topo.",
  },
}

export const WithChildren: Story = {
  args: {
    title: "Com conteúdo extra",
    description: "Área de children renderizada abaixo.",
    children: <button type="button">Ação</button>,
  },
}

export const ColSpanVariants: Story = {
  args: { title: "Variantes de colSpan" },
  render: () => (
    <div className="grid grid-cols-12 gap-4 p-6 max-w-5xl">
      <BentoCard colSpan={12} title="colSpan 12" description="Ocupa toda a largura." />
      <BentoCard colSpan={8} title="colSpan 8" description="Ocupa 8 colunas." />
      <BentoCard colSpan={4} title="colSpan 4" description="Ocupa 4 colunas." />
      <BentoCard colSpan={6} icon={<Kanban className="h-5 w-5" aria-hidden="true" />} title="colSpan 6 com ícone" description="Ocupa 6 colunas." />
    </div>
  ),
}

export const Dark: Story = {
  ...Default,
  decorators: [(Story) => (<div className="dark"><Story /></div>)],
}
