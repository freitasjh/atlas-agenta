import type { Meta, StoryObj } from "@storybook/react-vite"
import { expect, screen, userEvent, within } from "storybook/test"

import { Combobox, type ComboboxItem } from "./combobox"

const frameworks: ComboboxItem[] = [
  { value: "next", label: "Next.js", description: "The React Framework for the Web" },
  { value: "sveltekit", label: "SvelteKit", description: "Web development, streamlined" },
  { value: "nuxt", label: "Nuxt", description: "The Intuitive Vue Framework" },
  { value: "remix", label: "Remix", description: "Build Better Websites" },
  { value: "astro", label: "Astro", description: "The web framework for content-driven websites" },
]

const meta = {
  title: "Shadcn/UI/Combobox",
  component: Combobox,
  parameters: {
    layout: "centered",
  },
  args: {
    items: frameworks,
    placeholder: "Selecione um framework...",
    searchPlaceholder: "Buscar framework...",
    className: "w-64",
  },
  decorators: [
    (Story) => (
      <div className="flex min-h-[300px] items-start justify-center bg-background p-10 text-foreground">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Combobox>

export default meta
type Story = StoryObj<typeof meta>

export const Padrao: Story = {}

export const ComValorInicial: Story = {
  args: {
    defaultValue: "next",
  },
}

export const Dark: Story = {
  decorators: [
    (Story) => (
      <div className="dark">
        <div className="flex min-h-[300px] items-start justify-center bg-background p-10 text-foreground">
          <Story />
        </div>
      </div>
    ),
  ],
}

export const BuscarESelecionar: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)

    const trigger = canvas.getByRole("combobox")
    await userEvent.click(trigger)

    const searchInput = await screen.findByPlaceholderText("Buscar framework...")
    await expect(searchInput).toBeVisible()

    await userEvent.type(searchInput, "astro")

    const option = screen.getByText("Astro")
    await expect(option).toBeVisible()

    await userEvent.click(option)
    await expect(canvas.getByText("Astro")).toBeVisible()
  },
}

