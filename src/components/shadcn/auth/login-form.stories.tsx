import type { Meta, StoryObj } from "@storybook/react-vite"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { MemoryRouter } from "react-router-dom"

import {
  LoginForm,
  type LoginFormProps,
} from "@/components/shadcn/auth/login-form"
import { loginSchema, type LoginInput } from "@/lib/validations/auth"

/** Estados do form de login antes da página que o consome (storybook-first). */
type LoginHarnessProps = Partial<Omit<LoginFormProps, "form" | "onSubmit">>

function LoginHarness(props: LoginHarnessProps) {
  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  })

  return <LoginForm form={form} onSubmit={() => {}} {...props} />
}

const meta = {
  title: "Auth/LoginForm",
  component: LoginHarness,
  parameters: { layout: "centered" },
  decorators: [(Story) => <MemoryRouter>{Story()}</MemoryRouter>],
} satisfies Meta<typeof LoginHarness>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Loading: Story = { args: { isPending: true } }
export const Error: Story = {
  args: { error: "E-mail ou senha inválidos. Tente novamente." },
}
export const Notice: Story = {
  args: { notice: "Conta criada. Entre com seu e-mail e senha." },
}
export const Disabled: Story = { args: { disabled: true } }
