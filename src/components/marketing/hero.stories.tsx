import type { Meta, StoryObj } from "@storybook/react-vite"

import { Hero } from "./hero"

const meta = {
  title: "Marketing/Hero",
  component: Hero,
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof Hero>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    chip: (
      <>
        <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" aria-hidden="true" />
        <span className="font-semibold text-primary">Novidade:</span>
        <span>Quadro Kanban e Agenda unificados</span>
      </>
    ),
    headline: "A infraestrutura operacional definitiva para equipes de alta performance.",
    subheadline:
      "Centralize atendimentos, agendamento e gestão financeira em uma única experiência veloz e intuitiva.",
    primaryCta: { label: "Experimentar Gratuitamente", to: "/cadastro" },
    secondaryCta: { label: "Ver planos", to: "/precos", variant: "secondary" },
    trustPills: [
      "14 dias grátis sem cartão",
      "Setup pronto em 2 minutos",
      "Em conformidade com a LGPD",
    ],
  },
}

export const Dark: Story = {
  ...Default,
  decorators: [
    (Story) => (
      <div className="dark">
        <Story />
      </div>
    ),
  ],
}

/** Estado com showcase interativo (mesmo slot usado pela landing real). */
export const WithShowcase: Story = {
  ...Default,
  args: {
    ...Default.args,
    children: (
      <div className="mt-14 rounded-2xl border border-border/80 bg-card p-4 text-left shadow-xs">
        <div className="flex items-center gap-1 rounded-lg border border-border/70 bg-muted/30 p-1">
          <button type="button" className="rounded-md bg-background px-3 py-1 text-xs font-semibold">
            Métricas
          </button>
          <button type="button" className="px-3 py-1 text-xs text-muted-foreground">
            Agenda
          </button>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">Prévia do produto Atlas Agenda.</p>
      </div>
    ),
  },
}
