import { useEffect, useRef, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { AlertCircle, Loader2 } from "lucide-react"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { supabase } from "@/lib/supabase"

export const ACCEPT_INVITATION_COPY = {
  title: "Aceitar convite",
  description: "Defina sua senha para ativar sua conta.",
  passwordLabel: "Senha",
  confirmPasswordLabel: "Confirmar senha",
  passwordHint: "Use ao menos 8 caracteres.",
  submit: "Aceitar convite",
  submitting: "Aceitando…",
  submittingAnnouncement: "Aceitando convite",
  invalidToken: "Token de convite inválido ou ausente.",
  genericError: "Não foi possível aceitar o convite.",
  successNotice: "Convite aceito. Entre com seu e-mail e senha.",
  successTitle: "Convite aceito!",
  nextStepsTeam: "Entre e veja sua agenda.",
  nextStepsAdmin: "Entre e gerencie sua empresa.",
  errorTitle: "Não foi possível aceitar o convite",
  loginLink: "Ir para o login",
} as const

const tokenSchema = z.string().min(16)

export const acceptInvitationSchema = z
  .object({
    password: z
      .string()
      .min(8, "A senha deve ter ao menos 8 caracteres.")
      .max(72, "A senha deve ter no máximo 72 caracteres."),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "As senhas não coincidem.",
    path: ["confirmPassword"],
  })

export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>

const acceptResponseSchema = z
  .object({ role: z.string().nullish() })
  .passthrough();

/** Copy de próximos passos por papel (ADR-006). Fallback genérico sem role. */
export function nextStepsCopy(role: string | null | undefined): string {
  if (role === "admin") return ACCEPT_INVITATION_COPY.nextStepsAdmin;
  if (role === "professional" || role === "receptionist") {
    return ACCEPT_INVITATION_COPY.nextStepsTeam;
  }
  return ACCEPT_INVITATION_COPY.successNotice;
}

export function AcceptInvitationPage() {
  const [params] = useSearchParams()
  const token = params.get("token")

  const parsedToken = tokenSchema.safeParse(token)
  const validToken = parsedToken.success ? parsedToken.data : null

  const [serverError, setServerError] = useState<string | null>(null)
  const [acceptedRole, setAcceptedRole] = useState<string | null | undefined>(
    undefined,
  )
  const alertRef = useRef<HTMLParagraphElement>(null)
  const passwordRef = useRef<HTMLInputElement | null>(null)
  const submittingRef = useRef(false)

  const form = useForm<AcceptInvitationInput>({
    resolver: zodResolver(acceptInvitationSchema),
    defaultValues: { password: "", confirmPassword: "" },
    shouldFocusError: true,
  })

  useEffect(() => {
    if (validToken) passwordRef.current?.focus()
  }, [validToken])

  useEffect(() => {
    if (serverError) alertRef.current?.focus()
  }, [serverError])

  if (!validToken) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md text-center" role="alert">
          <CardHeader>
            <AlertCircle className="h-10 w-10 mx-auto text-destructive" aria-hidden="true" />
            <CardTitle className="font-display text-destructive">
              {ACCEPT_INVITATION_COPY.errorTitle}
            </CardTitle>
            <CardDescription>{ACCEPT_INVITATION_COPY.invalidToken}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="min-h-11">
              <Link to="/login">{ACCEPT_INVITATION_COPY.loginLink}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  async function onSubmit(values: AcceptInvitationInput) {
    if (submittingRef.current) return
    submittingRef.current = true
    setServerError(null)
    try {
      const { data, error } = await supabase.functions.invoke(
        "accept-invitation",
        { body: { token: validToken, password: values.password } },
      )
      if (error) {
        const serverMessage =
          (data as { message?: unknown } | null)?.message
        setServerError(
          typeof serverMessage === "string" && serverMessage.trim().length > 0
            ? serverMessage
            : (error.message ?? ACCEPT_INVITATION_COPY.genericError),
        )
        return
      }
      const parsed = acceptResponseSchema.safeParse(data ?? {})
      setAcceptedRole(parsed.success ? (parsed.data.role ?? null) : null)
    } catch {
      setServerError(ACCEPT_INVITATION_COPY.genericError)
    } finally {
      submittingRef.current = false
    }
  }

  if (acceptedRole !== undefined) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md text-center">
          <CardHeader>
            <CardTitle className="font-display text-2xl">
              {ACCEPT_INVITATION_COPY.successTitle}
            </CardTitle>
            <CardDescription>{nextStepsCopy(acceptedRole)}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="min-h-11">
              <Link
                to="/login"
                replace
                state={{ notice: ACCEPT_INVITATION_COPY.successNotice }}
              >
                {ACCEPT_INVITATION_COPY.loginLink}
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const isPending = form.formState.isSubmitting

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="font-display text-2xl">
            {ACCEPT_INVITATION_COPY.title}
          </CardTitle>
          <CardDescription>{ACCEPT_INVITATION_COPY.description}</CardDescription>
        </CardHeader>
        <CardContent>
          {serverError ? (
            <p
              ref={alertRef}
              role="alert"
              tabIndex={-1}
              className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {serverError}
            </p>
          ) : null}
          <Form {...form}>
            <form
              role="form"
              onSubmit={form.handleSubmit(onSubmit)}
              className="space-y-4"
              noValidate
            >
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{ACCEPT_INVITATION_COPY.passwordLabel}</FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        autoComplete="new-password"
                        className="text-base sm:text-sm"
                        {...field}
                        ref={(element) => {
                          field.ref(element)
                          passwordRef.current = element
                        }}
                      />
                    </FormControl>
                    <FormDescription>
                      {ACCEPT_INVITATION_COPY.passwordHint}
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>
                      {ACCEPT_INVITATION_COPY.confirmPasswordLabel}
                    </FormLabel>
                    <FormControl>
                      <Input
                        type="password"
                        autoComplete="new-password"
                        className="text-base sm:text-sm"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="submit"
                className="h-11 w-full sm:h-10"
                disabled={isPending}
              >
                {isPending ? (
                  <>
                    <Loader2 className="animate-spin" aria-hidden="true" />
                    {ACCEPT_INVITATION_COPY.submitting}
                  </>
                ) : (
                  ACCEPT_INVITATION_COPY.submit
                )}
              </Button>
              {isPending ? (
                <span role="status" className="sr-only">
                  {ACCEPT_INVITATION_COPY.submittingAnnouncement}
                </span>
              ) : null}
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  )
}
