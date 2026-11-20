import type { Meta, StoryObj } from "@storybook/react-vite"

import { SocialProof } from "./social-proof"

const meta = {
  title: "Marketing/SocialProof",
  component: SocialProof,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof SocialProof>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    eyebrow: "Confiado por mais de 1.200 clínicas, fintechs e consultorias modernas",
    logos: ["// STONE", "• NUBANK ENTERPRISE", "[+] EINSTEIN SAÚDE", "~ DASA MEDICINA", "> VTEX LOGISTICS"],
  },
}

export const Dark: Story = {
  ...Default,
  decorators: [(Story) => (<div className="dark"><Story /></div>)],
}
