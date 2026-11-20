import type { Meta, StoryObj } from "@storybook/react-vite"

import { Testimonials } from "./testimonials"

const meta = {
  title: "Marketing/Testimonials",
  component: Testimonials,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Testimonials>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    eyebrow: "Casos de Sucesso",
    headline: "Quem usa o Atlas não volta para planilhas.",
    subheadline: "Veja como nossos clientes reduziram tempos operacionais.",
    items: [
      {
        quote: "A confirmação automática pelo WhatsApp derrubou as faltas na clínica.",
        name: "Dra. Sofia Alencar",
        role: "Clínica • Alencar & Associados",
        initials: "SA",
        avatarClassName: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
      },
      {
        quote: "Encaixe rápido e lembrete que derruba o buraco na agenda.",
        name: "Carlos Lima",
        role: "Barbearia • Studio Lima",
        initials: "CL",
        avatarClassName: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
      },
      {
        quote: "Cobro por PIX assim que termino e recebo sem cobrar na mão.",
        name: "Mariana Fontes",
        role: "Autônoma • Estética",
        initials: "MF",
        avatarClassName: "bg-violet-500/10 text-violet-700 dark:text-violet-300",
      },
    ],
  },
}

export const Dark: Story = {
  ...Default,
  decorators: [(Story) => (<div className="dark"><Story /></div>)],
}
