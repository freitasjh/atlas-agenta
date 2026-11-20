import type { UseFormReturn } from "react-hook-form"
import { Link } from "react-router-dom"
import { Loader2 } from "lucide-react"

import { cn } from "@/lib/cn"
import type { LoginInput } from "@/lib/validations/auth"

import { Button } from "@/components/shadcn/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/shadcn/ui/field"
// `register()` precisa de ref: o Input de `@/components/ui` é forwardRef,
// diferente do primitivo template (`@/components/shadcn/ui/input`).
import { Input } from "@/components/ui/input"

export interface LoginFormProps {
  /** Instância RHF da página — zod/resolver continua sendo dela. */
  form: UseFormReturn<LoginInput>
  /** Callback com os valores já validados pelo resolver. */
  onSubmit: (values: LoginInput) => void | Promise<void>
  isPending?: boolean
  disabled?: boolean
  /** Aviso neutro de quem chega de outra tela (ADR-03): `role="status"`. */
  notice?: string | null
  /** Erro de credencial mapeado (anti-enumeração): `role="alert"`. */
  error?: string | null
  errorRef?: React.Ref<HTMLParagraphElement>
  className?: string
}

/**
 * Form de login do template, agora controlado pela página real.
 *
 * A lógica (RHF + zod, mutation, redirect, anti-enumeração) continua em
 * `src/auth/LoginPage.tsx`; aqui só apresentação, links do React Router e
 * acessibilidade. O botão social GitHub do template era mock e foi removido.
 */
export function LoginForm({
  form,
  onSubmit,
  isPending = false,
  disabled = false,
  notice,
  error,
  errorRef,
  className,
}: LoginFormProps) {
  const { errors } = form.formState
  const blocked = isPending || disabled

  return (
    <form
      onSubmit={form.handleSubmit(onSubmit)}
      noValidate
      aria-busy={isPending}
      className={cn("flex flex-col gap-6", className)}
    >
      <FieldGroup className="gap-6">
        <div className="flex flex-col items-center gap-1 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Entrar na sua conta
          </h1>
          <p className="text-sm text-balance text-muted-foreground">
            Acesse o painel da sua empresa.
          </p>
        </div>

        {notice ? (
          <p
            role="status"
            className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-foreground"
          >
            {notice}
          </p>
        ) : null}

        {error ? (
          <p
            ref={errorRef}
            role="alert"
            tabIndex={-1}
            className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {error}
          </p>
        ) : null}

        <Field data-invalid={Boolean(errors.email)}>
          <FieldLabel htmlFor="email">E-mail</FieldLabel>
          <Input
            id="email"
            type="email"
            placeholder="voce@empresa.com.br"
            autoComplete="email"
            disabled={blocked}
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? "email-error" : undefined}
            {...form.register("email")}
          />
          <FieldError id="email-error" errors={[errors.email]} />
        </Field>

        <Field data-invalid={Boolean(errors.password)}>
          <div className="flex items-center">
            <FieldLabel htmlFor="password">Senha</FieldLabel>
            <Link
              to="/recuperar-senha"
              className="ml-auto rounded-sm text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Esqueceu a senha?
            </Link>
          </div>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            disabled={blocked}
            aria-invalid={Boolean(errors.password)}
            aria-describedby={errors.password ? "password-error" : undefined}
            {...form.register("password")}
          />
          <FieldError id="password-error" errors={[errors.password]} />
        </Field>

        <Field>
          <Button type="submit" className="w-full" disabled={blocked}>
            {isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Entrando…
              </>
            ) : (
              "Entrar"
            )}
          </Button>
        </Field>

        <FieldDescription className="text-center">
          Ainda não tem conta?{" "}
          <Link
            to="/cadastro"
            className="rounded-sm font-medium text-foreground underline underline-offset-4 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Criar conta
          </Link>
        </FieldDescription>
      </FieldGroup>
    </form>
  )
}
