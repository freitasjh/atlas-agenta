import type { Meta, StoryObj } from "@storybook/react-vite"

import { Calendar, Kanban, Zap, Lock, FileSpreadsheet } from "lucide-react"

import { BentoGrid } from "./bento-grid"
import { BentoCard } from "./bento-card"

const meta = {
  title: "Marketing/BentoGrid",
  component: BentoGrid,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof BentoGrid>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { children: null as any },
  render: () => (
    <BentoGrid
      eyebrow="Ecossistema Unificado"
      headline="Tudo o que sua operação precisa. Sem gambiarras."
      subheadline="Desenvolvido com foco em velocidade, ergonomia e precisão matemática."
    >
      <BentoCard
        colSpan={8}
        icon={<Calendar className="h-5 w-5" aria-hidden="true" />}
        iconClassName="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
        title="Grade de Agendamento Multi-Profissional"
        description="Coordene múltiplos especialistas lado a lado."
      />
      <BentoCard
        colSpan={4}
        icon={<Kanban className="h-5 w-5" aria-hidden="true" />}
        iconClassName="bg-sky-500/10 text-sky-600 dark:text-sky-400"
        title="Kanban no Padrão Linear"
        description="Arraste cards fluidamente."
      />
      <BentoCard
        colSpan={4}
        icon={<Zap className="h-5 w-5" aria-hidden="true" />}
        iconClassName="bg-amber-500/10 text-amber-600 dark:text-amber-400"
        title="Faturamento & Liquidação"
        description="Cálculo automático de honorários."
      />
      <BentoCard
        colSpan={4}
        icon={<Lock className="h-5 w-5" aria-hidden="true" />}
        iconClassName="bg-violet-500/10 text-violet-600 dark:text-violet-400"
        title="Conformidade & RBAC"
        description="Permissões granulares por função."
      />
      <BentoCard
        colSpan={4}
        icon={<FileSpreadsheet className="h-5 w-5" aria-hidden="true" />}
        iconClassName="bg-primary/10 text-primary"
        title="Relatórios & Webhooks"
        description="Exporte para Excel ou sincronize via API."
      />
    </BentoGrid>
  ),
}

export const Dark: Story = {
  ...Default,
  decorators: [(Story) => (<div className="dark"><Story /></div>)],
}
