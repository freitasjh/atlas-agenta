"use client"

import * as React from "react"
import { toast } from "sonner"
import { cn } from "@/lib/cn"

import { Button } from "@/components/shadcn/ui/button"
import { Checkbox } from "@/components/shadcn/ui/checkbox"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/shadcn/ui/field"
import { Input } from "@/components/shadcn/ui/input"

interface SignupFormProps extends Omit<React.ComponentProps<"form">, "onSubmit"> {
  onSubmit?: (e: React.FormEvent<HTMLFormElement>) => void
}

export function SignupForm({
  className,
  onSubmit,
  ...props
}: SignupFormProps) {
  const [fullName, setFullName] = React.useState("")
  const [email, setEmail] = React.useState("")
  const [password, setPassword] = React.useState("")
  const [confirmPassword, setConfirmPassword] = React.useState("")
  const [agreeTerms, setAgreeTerms] = React.useState(true)
  const [isLoading, setIsLoading] = React.useState(false)

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()

    if (password !== confirmPassword) {
      toast.error("As senhas não coincidem", {
        description: "Verifique se digitou a mesma senha nos dois campos.",
      })
      return
    }

    if (!agreeTerms) {
      toast.error("Termos de serviço", {
        description: "Você precisa aceitar os termos de serviço para criar sua conta.",
      })
      return
    }

    setIsLoading(true)

    setTimeout(() => {
      setIsLoading(false)
      toast.success("Conta criada com sucesso!", {
        description: `Bem-vindo(a) ao Atlas, ${fullName}! Redirecionando para o painel...`,
      })
      if (onSubmit) {
        onSubmit(e)
      } else {
        window.location.hash = "#/shadcn"
      }
    }, 700)
  }

  return (
    <form
      className={cn("flex flex-col gap-6", className)}
      onSubmit={handleSubmit}
      {...props}
    >
      <FieldGroup>
        <div className="flex flex-col items-center gap-1 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Criar sua conta
          </h1>
          <p className="text-sm text-balance text-muted-foreground">
            Preencha os dados abaixo para iniciar seu período gratuito de 14 dias.
          </p>
        </div>

        {/* Nome Completo */}
        <Field>
          <FieldLabel htmlFor="fullName">Nome completo</FieldLabel>
          <Input
            id="fullName"
            type="text"
            placeholder="Ana Clara Silva"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            autoComplete="name"
            required
          />
        </Field>

        {/* E-mail Corporativo */}
        <Field>
          <FieldLabel htmlFor="email">E-mail corporativo</FieldLabel>
          <Input
            id="email"
            type="email"
            placeholder="voce@empresa.com.br"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </Field>

        {/* Senha */}
        <Field>
          <FieldLabel htmlFor="password">Senha</FieldLabel>
          <Input
            id="password"
            type="password"
            placeholder="Pelo menos 8 caracteres"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </Field>

        {/* Confirmar Senha */}
        <Field>
          <FieldLabel htmlFor="confirmPassword">Confirmar senha</FieldLabel>
          <Input
            id="confirmPassword"
            type="password"
            placeholder="Repita a senha digitada"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
          />
        </Field>

        {/* Checkbox Termos */}
        <div className="flex items-start gap-2.5 pt-1">
          <Checkbox
            id="terms"
            checked={agreeTerms}
            onCheckedChange={(checked) => setAgreeTerms(checked === true)}
            className="mt-0.5"
          />
          <label
            htmlFor="terms"
            className="text-xs text-muted-foreground leading-snug cursor-pointer select-none"
          >
            Concordo com os{" "}
            <a href="#" className="font-medium text-foreground underline underline-offset-4 hover:text-primary">
              Termos de Serviço
            </a>{" "}
            e a{" "}
            <a href="#" className="font-medium text-foreground underline underline-offset-4 hover:text-primary">
              Política de Privacidade
            </a>
            .
          </label>
        </div>

        {/* Botão de Envio */}
        <Field>
          <Button type="submit" disabled={isLoading} className="w-full h-10 font-semibold shadow-xs">
            {isLoading ? "Criando conta..." : "Criar Conta & Iniciar Teste"}
          </Button>
        </Field>

        <FieldSeparator>ou cadastre-se com</FieldSeparator>

        {/* Social Login */}
        <Field>
          <Button
            variant="outline"
            type="button"
            className="w-full gap-2 text-xs font-semibold"
            onClick={() => {
              toast.info("Conectando ao provedor GitHub...")
              setTimeout(() => {
                window.location.hash = "#/shadcn"
              }, 500)
            }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              className="h-4 w-4"
            >
              <path
                d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
                fill="currentColor"
              />
            </svg>
            Continuar com GitHub
          </Button>

          <FieldDescription className="text-center pt-2 text-xs">
            Já tem uma conta?{" "}
            <a
              href="#/login"
              className="font-semibold text-foreground underline underline-offset-4 hover:text-primary"
            >
              Entrar
            </a>
          </FieldDescription>
        </Field>
      </FieldGroup>
    </form>
  )
}
