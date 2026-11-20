import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, userEvent, within } from "storybook/test"
import { Scheduler } from "./scheduler"

const meta = {
  title: "Shadcn/Scheduler/Scheduler",
  component: Scheduler,
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof Scheduler>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {},
}

export const VisaoSemana: Story = {
  args: {
    initialViewMode: "week",
  },
}

export const VisaoLista: Story = {
  args: {
    initialViewMode: "list",
  },
}

export const DarkMode: Story = {
  decorators: [
    (Story) => (
      <div className="dark bg-background text-foreground p-4 rounded-xl min-h-screen">
        <Story />
      </div>
    ),
  ],
}

export const InterativoDetalhesConsulta: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    // Localizar botão com o agendamento de Renata Vasconcelos
    const aptButton = await canvas.findByText("Renata Vasconcelos")
    expect(aptButton).toBeInTheDocument()

    // Clicar para abrir o modal de detalhes
    await userEvent.click(aptButton)

    // O modal deve estar no documento
    const body = within(document.body)
    const modalTitle = await body.findByText("Check-up Cardiológico")
    expect(modalTitle).toBeInTheDocument()
  },
}
