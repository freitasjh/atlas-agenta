import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";

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

import { loginSchema, type LoginInput } from "@/lib/validations/auth";
import { mapAuthError } from "@/lib/auth-errors";
import { useSignIn } from "@/hooks/useAuthMutations";
import { usePostLoginRedirect } from "@/auth/usePostLoginRedirect";

/**
 * Tela de login por e-mail/senha. Ao sucesso, decide o destino com
 * `usePostLoginRedirect` (respeita `state.from` e manda `super_admin` para
 * `/admin`). Erro de credencial vira um alerta pt-BR genérico no topo, sem
 * revelar qual campo falhou (anti-enumeração).
 */
export function LoginPage() {
  const signIn = useSignIn();
  const redirectAfterLogin = usePostLoginRedirect();
  const location = useLocation() as { state?: { from?: string } };
  const [serverError, setServerError] = useState<string | null>(null);
  const alertRef = useRef<HTMLParagraphElement>(null);

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  useEffect(() => {
    if (serverError) alertRef.current?.focus();
  }, [serverError]);

  async function onSubmit(values: LoginInput) {
    setServerError(null);
    try {
      await signIn.mutateAsync(values);
      await redirectAfterLogin(location.state?.from);
    } catch (error) {
      setServerError(mapAuthError(error));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-2xl">Entrar</CardTitle>
        <CardDescription>Acesse o painel da sua empresa.</CardDescription>
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
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>E-mail</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      autoComplete="email"
                      placeholder="voce@empresa.com.br"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <div className="flex items-center justify-between">
                    <FormLabel>Senha</FormLabel>
                    <Link
                      to="/recuperar-senha"
                      className="rounded-sm text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      Esqueci minha senha
                    </Link>
                  </div>
                  <FormControl>
                    <Input
                      type="password"
                      autoComplete="current-password"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" className="w-full" disabled={signIn.isPending}>
              {signIn.isPending ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden="true" />
                  Entrando…
                </>
              ) : (
                "Entrar"
              )}
            </Button>
          </form>
        </Form>
      </CardContent>
      <CardFooter className="text-sm text-muted-foreground">
        <span>
          Ainda não tem conta?{" "}
          <Link
            to="/cadastro"
            className="rounded-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Criar conta
          </Link>
        </span>
      </CardFooter>
    </Card>
  );
}
