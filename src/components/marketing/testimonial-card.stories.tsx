import type { Meta, StoryObj } from "@storybook/react-vite"

import { TestimonialCard } from "./testimonial-card"

const meta = {
  title: "Marketing/TestimonialCard",
  component: TestimonialCard,
  parameters: { layout: "centered" },
} satisfies Meta<typeof TestimonialCard>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    quote: "A confirmação automática pelo WhatsApp derrubou as faltas na clínica.",
    name: "Dra. Sofia Alencar",
    role: "Clínica • Alencar & Associados",
  },
}

export const WithAvatar: Story = {
  args: {
    quote: "Encaixe rápido e lembrete que derruba o buraco na agenda.",
    name: "Carlos Lima",
    role: "Barbearia • Studio Lima",
    initials: "CL",
    avatarClassName: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
}

export const WithoutAvatar: Story = {
  args: {
    quote: "Cobro por PIX assim que termino e recebo sem cobrar na mão.",
    name: "Mariana Fontes",
    role: "Autônoma • Estética",
  },
}

export const LongQuote: Story = {
  args: {
    quote:
      "O Atlas Agenda organizou a agenda, a cobrança e o relacionamento com clientes em um único lugar, reduzindo faltas e aumentando a receita.",
    name: "Equipe Atlas",
    role: "Caso de sucesso",
    initials: "EA",
  },
}

export const Dark: Story = {
  ...Default,
  decorators: [(Story) => (<div className="dark"><Story /></div>)],
}
