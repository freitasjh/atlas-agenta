import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SignOutButton } from "@/components/SignOutButton";

import { useCurrentUser } from "@/hooks/useCurrentUser";
import {
  useChangeInitialPassword,
  useSignOut,
} from "@/hooks/useAuthMutations";
import {
  initialPasswordSchema,
  type InitialPasswordInput,
} from "@/lib/validations/auth";
import { mapInitialPasswordError, isInitialSessionExpiredError } from "@/lib/auth-errors";
import { resolvePostLoginDestination } from "@/auth/resolvePostLoginDestination";

/**
 * Textos pt-BR da tela de troca de senha obrigatória (ADR-10). Mapa único:
 * a tela renderiza daqui e o teste de cópia confere as strings exatas sem
 * montar DOM.
 */
export const TROCAR_SENHA_COPY = {
  firstAccessBadge: "Primeiro acesso",
  title: "Crie sua nova senha",
  description:
    "Sua senha atual é provisória. Defina uma senha só sua para entrar no painel.",
  passwordLabel: "Nova senha",
  confirmPasswordLabel: "Confirmar nova senha",
  passwordHint: "Use ao menos 8 caracteres.",
  accountLabel: "Conta:",
  submit: "Salvar nova senha",
  submitting: "Salvando…",
  submittingAnnouncement: "Salvando nova senha",
  success: "Senha salva. Painel liberado.",
  reloginWarning: "Senha salva. Entre com a nova senha.",
  loginLink: "Ir para o login",
} as const;

/**
 * Tela de troca de senha obrigatória do primeiro acesso (ADR-10).
 *
 * Fica em `GateLayout` + `RequireAuth`, mas FORA do guard de troca (ADR-11):
 * incluir o guard aqui criaria laço, já que é esta tela que limpa a flag.
 *
 * Fluxo:
 * - flag já limpa (outra aba trocou) → `<Navigate>` para o destino do papel;
 * - sucesso com claims novas sem a flag → toast, limpa senha do form e da
 *   mutation e navega para o destino do papel;
 * - renovação falhou ou claims ainda com a flag → `signOut` local e login com
 *   aviso: o painel nunca abre com token defasado;
 * - erro → mensagem pt-BR de `mapInitialPasswordError`, com link de login
 *   quando a causa é sessão expirada (`isInitialSessionExpiredError`).
 */
export function TrocarSenhaPage() {
  const { session, role, mustChangePassword, isLoadingAuth } = useCurrentUser();
  const changePassword = useChangeInitialPassword();
  const signOut = useSignOut();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const alertRef = useRef<HTMLParagraphElement>(null);
  const passwordRef = useRef<HTMLInputElement | null>(null);
  // Síncrono de propósito: `isPending` só chega ao `onSubmit` na re-renderização
  // seguinte, então um segundo Enter/clique na mesma janela ainda o veria falso.
  const submittingRef = useRef(false);

  const form = useForm<InitialPasswordInput>({
    resolver: zodResolver(initialPasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
    shouldFocusError: true,
  });

  useEffect(() => {
    if (serverError) alertRef.current?.focus();
  }, [serverError]);

  // Foco no primeiro campo ao montar (ADR-14): o usuário cai direto no
  // formulário, sem precisar tabular a partir do topo da página.
  useEffect(() => {
    passwordRef.current?.focus();
  }, []);

  // Acesso direto com a flag já limpa (outra aba concluiu a troca): vai para a
  // casa do papel, sem passar pelo formulário.
  if (!isLoadingAuth && !mustChangePassword) {
    return (
      <Navigate
        to={resolvePostLoginDestination({
          role,
          mustChangePassword: false,
        })}
        replace
      />
    );
  }

  /** Descarta a senha do form e das variáveis da mutation. */
  function clearPasswordState() {
    form.reset();
    changePassword.reset();
  }

  async function finishWithRelogin() {
    toast.warning(TROCAR_SENHA_COPY.reloginWarning);
    try {
      await signOut.mutateAsync();
    } catch {
      // Logout local é soberano: o cache é limpo no `onSettled` mesmo com
      // falha de rede. O usuário volta ao login de qualquer forma.
    }
    navigate("/login", { replace: true });
  }

  async function onSubmit(values: InitialPasswordInput) {
    // Guard real de duplo submit: fecha a janela entre o Enter e o `disabled`
    // do botão (que só existe depois da re-renderização). `isPending` continua
    // no `disabled` da UI; o ref é quem impede a segunda requisição.
    if (submittingRef.current) return;
    submittingRef.current = true;

    setServerError(null);
    setSessionExpired(false);

    try {
      const { claims } = await changePassword.mutateAsync({
        password: values.password,
      });

      clearPasswordState();

      if (claims === null || claims.mustChangePassword) {
        await finishWithRelogin();
        return;
      }

      toast.success(TROCAR_SENHA_COPY.success);
      navigate(
        resolvePostLoginDestination({
          role: claims.role,
          mustChangePassword: claims.mustChangePassword,
        }),
        { replace: true },
      );
    } catch (error) {
      setSessionExpired(isInitialSessionExpiredError(error));
      setServerError(mapInitialPasswordError(error));
    } finally {
      submittingRef.current = false;
    }
  }

  const email = session?.user.email ?? "—";

  return (
    <Card className="border-l-4 border-l-status-pendente">
      <CardHeader className="space-y-2">
        <Badge variant="secondary" className="w-fit">
          {TROCAR_SENHA_COPY.firstAccessBadge}
        </Badge>
        <CardTitle className="font-display text-2xl">
          {TROCAR_SENHA_COPY.title}
        </CardTitle>
        <CardDescription>{TROCAR_SENHA_COPY.description}</CardDescription>
        <p className="text-sm text-muted-foreground">
          <span className="sr-only">{TROCAR_SENHA_COPY.accountLabel} </span>
          <span className="font-mono text-foreground">{email}</span>
        </p>
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
            {sessionExpired ? (
              <>
                {" "}
                <Link
                  to="/login"
                  className="rounded-sm font-semibold underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                >
                  {TROCAR_SENHA_COPY.loginLink}
                </Link>
              </>
            ) : null}
          </p>
        ) : null}

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-4"
            noValidate
          >
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{TROCAR_SENHA_COPY.passwordLabel}</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      autoComplete="new-password"
                      className="text-base sm:text-sm"
                      {...field}
                      ref={(element) => {
                        // RHF precisa do ref para registrar o campo e focar no
                        // erro; a tela, para o foco inicial. Um callback só
                        // atende os dois (o spread de `field` traria o ref dele).
                        field.ref(element);
                        passwordRef.current = element;
                      }}
                    />
                  </FormControl>
                  <FormDescription>
                    {TROCAR_SENHA_COPY.passwordHint}
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
                    {TROCAR_SENHA_COPY.confirmPasswordLabel}
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
              className="h-11 w-full sm:h-10 sm:w-auto"
              disabled={isLoadingAuth || changePassword.isPending}
            >
              {changePassword.isPending ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden="true" />
                  {TROCAR_SENHA_COPY.submitting}
                </>
              ) : (
                TROCAR_SENHA_COPY.submit
              )}
            </Button>
            {changePassword.isPending ? (
              <span role="status" className="sr-only">
                {TROCAR_SENHA_COPY.submittingAnnouncement}
              </span>
            ) : null}
          </form>
        </Form>
      </CardContent>
      <CardFooter className="justify-end">
        {/* Rótulo "Sair"/"Saindo…" vem do botão compartilhado, fonte única para
            todas as saídas do app — a cópia desta tela não duplica a string. */}
        <SignOutButton
          variant="link"
          className="h-auto p-0 text-sm text-muted-foreground"
        />
      </CardFooter>
    </Card>
  );
}
