import { cn } from "@/lib/cn"

import { FieldDescription, FieldGroup } from "@/components/shadcn/ui/field"

export interface SignupFormProps
  extends Omit<React.ComponentProps<"form">, "onSubmit" | "children" | "title"> {
  /** Handler já montado pela página (ex.: `form.handleSubmit(onSubmit, onInvalid)`). */
  onSubmit: React.FormEventHandler<HTMLFormElement>
  /** Campos reais da página — o shell não conhece o schema de cadastro. */
  children?: React.ReactNode
  title?: React.ReactNode
  description?: React.ReactNode
  notice?: string | null
  error?: string | null
  errorRef?: React.Ref<HTMLParagraphElement>
  isPending?: boolean
  /**
   * Estado apenas apresentacional: aplica `aria-disabled` e CSS
   * (`pointer-events-none`, `opacity-60`), sem desabilitar os controles nativos.
   * Chamadores devem bloquear o submit — `CadastroPage` já o faz com
   * `signUp.isPending` (botão e handler).
   */
  disabled?: boolean
  footer?: React.ReactNode
}

/**
 * Shell controlado de cadastro (Arquétipo 5 de `DESIGN.md`).
 *
 * Substitui o antigo form mock: sem `setTimeout`, sem `toast`, sem
 * `window.location.hash` e sem login social. O wizard rico de `CadastroPage`
 * entra via `children`, preservando os 15 campos, RHF/zod, máscaras, ViaCEP,
 * redirects e anti-enumeração. Feedback usa `role="status"` (notice) e
 * `role="alert"` (erro), com ref para foco — contrato das páginas reais.
 * `disabled` é apresentacional (`aria-disabled` + CSS): não desabilita inputs
 * nativos, então quem chama deve travar o submit (em `CadastroPage`, via
 * `signUp.isPending`).
 */
export function SignupForm({
  onSubmit,
  children,
  title = "Criar sua conta",
  description = "Preencha os dados abaixo para criar sua conta.",
  notice,
  error,
  errorRef,
  isPending = false,
  disabled = false,
  footer,
  className,
  ...props
}: SignupFormProps) {
  return (
    <form
      onSubmit={onSubmit}
      noValidate
      aria-busy={isPending}
      className={cn("flex flex-col gap-6", className)}
      {...props}
    >
      <FieldGroup className="gap-6">
        <div className="flex flex-col items-center gap-1 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {title}
          </h1>
          <p className="text-sm text-balance text-muted-foreground">
            {description}
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

        {/* `<div>`, não `<fieldset>`: o wizard já tem seus 4 fieldsets e os
            testes fixam a contagem exata. `aria-disabled` + CSS cobrem o
            estado desabilitado sem criar outro agrupamento. */}
        <div
          aria-disabled={disabled || undefined}
          className={cn(
            "flex flex-col gap-6",
            disabled && "pointer-events-none select-none opacity-60",
          )}
        >
          {children}
        </div>

        {footer ? (
          <FieldDescription className="text-center">{footer}</FieldDescription>
        ) : null}
      </FieldGroup>
    </form>
  )
}
