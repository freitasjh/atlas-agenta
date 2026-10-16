import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

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
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  resetPasswordSchema,
  type ResetPasswordInput,
} from "@/lib/validations/auth";
import { mapAuthError } from "@/lib/auth-errors";
import { useSession } from "@/hooks/useSession";
import { useUpdatePassword } from "@/hooks/useAuthMutations";

/**
 * Destino do link de redefinição do e-mail. O Supabase emite `PASSWORD_RECOVERY`
 * e abre uma sessão de recuperação, que o `AuthListener` (ADR-06) grava no cache
 * `["session"]`. Esta tela só mostra o formulário quando há sessão; sem ela,
 * mostra "link inválido ou expirado" com CTA para pedir um novo.
 *
 * Ao definir a nova senha (`useUpdatePassword`), mostra um toast e navega para
 * `/app` (a sessão de recuperação já autentica o usuário).
 */
export function RedefinirSenhaPage() {
  const sessionQuery = useSession();
  const updatePassword = useUpdatePassword();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState<string | null>(null);
  const alertRef = useRef<HTMLParagraphElement>(null);

  const form = useForm<ResetPasswordInput>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  useEffect(() => {
    if (serverError) alertRef.current?.focus();
  }, [serverError]);

  async function onSubmit(values: ResetPasswordInput) {
    setServerError(null);
    try {
      await updatePassword.mutateAsync(values);
      toast.success("Senha redefinida. Você já pode usar a nova senha.");
      navigate("/app", { replace: true });
    } catch (error) {
      setServerError(mapAuthError(error));
    }
  }

  // Aguarda a resolução da sessão antes de decidir (evita flash do estado de
  // erro enquanto o `PASSWORD_RECOVERY` ainda não chegou ao cache).
  if (sessionQuery.isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="font-display text-2xl">Redefinir senha</CardTitle>
        </CardHeader>
        <CardContent>
          <p
            role="status"
            className="flex items-center gap-2 text-sm text-muted-foreground"
          >
            <Loader2 className="animate-spin" aria-hidden="true" />
            Verificando o link…
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!sessionQuery.data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="font-display text-2xl">
            Link inválido ou expirado
          </CardTitle>
          <CardDescription>
            O link de redefinição não é mais válido. Solicite um novo para
            continuar.
          </CardDescription>
        </CardHeader>
        <CardFooter className="text-sm text-muted-foreground">
          <Link
            to="/recuperar-senha"
            className="rounded-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Solicitar novo link
          </Link>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-2xl">Redefinir senha</CardTitle>
        <CardDescription>Defina a nova senha da sua conta.</CardDescription>
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
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nova senha</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      autoComplete="new-password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Confirmar nova senha</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      autoComplete="new-password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button
              type="submit"
              className="w-full"
              disabled={updatePassword.isPending}
            >
              {updatePassword.isPending ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden="true" />
                  Salvando…
                </>
              ) : (
                "Salvar nova senha"
              )}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
