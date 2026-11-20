import type { Meta, StoryObj } from "@storybook/react-vite"

import {
  SignupForm,
  type SignupFormProps,
} from "@/components/shadcn/auth/signup-form"

/** Estados do shell de cadastro antes da página que o consome. */
type SignupHarnessProps = Partial<Omit<SignupFormProps, "onSubmit" | "children">>

function SignupHarness(props: SignupHarnessProps) {
  return (
    <SignupForm
      onSubmit={(event) => event.preventDefault()}
      footer={
        <>
          Já tem uma conta? <span className="underline underline-offset-4">Entrar</span>
        </>
      }
      {...props}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="story-name" className="text-sm font-medium">
            Nome completo
          </label>
          <input
            id="story-name"
            className="h-10 w-full rounded-md border border-input bg-background px-3"
            autoComplete="name"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="story-email" className="text-sm font-medium">
            E-mail corporativo
          </label>
          <input
            id="story-email"
            type="email"
            className="h-10 w-full rounded-md border border-input bg-background px-3"
            autoComplete="email"
          />
        </div>
        <button
          type="submit"
          className="h-10 w-full rounded-md bg-primary font-medium text-primary-foreground"
        >
          Criar conta
        </button>
      </div>
    </SignupForm>
  )
}

const meta = {
  title: "Auth/SignupForm",
  component: SignupHarness,
  parameters: { layout: "centered" },
} satisfies Meta<typeof SignupHarness>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Loading: Story = { args: { isPending: true } }
export const Error: Story = {
  args: { error: "Não foi possível criar a conta. Tente novamente." },
}
export const Notice: Story = { args: { notice: "Aviso neutro" } }
export const Disabled: Story = { args: { disabled: true } }
