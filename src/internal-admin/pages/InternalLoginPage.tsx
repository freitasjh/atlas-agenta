import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2 } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabase";
import { GENERIC_LOGIN_ERROR, writeMfaPending } from "@/internal-admin/internalOperator";

const schema = z.object({
  email: z.string().email("Informe um e-mail válido."),
  password: z.string().min(1, "Informe a senha."),
});

type Input = z.infer<typeof schema>;

/**
 * Login interno (ux: Auth Card max-w-md, 1 primário, erro genérico
 * anti-enumeração com texto e tempo idênticos). Ao sucesso abre a janela
 * `mfa_pending` (≤10min) e segue para o MFA — nunca libera dado aqui.
 */
export function InternalLoginPage() {
  const navigate = useNavigate();
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const alertRef = useRef<HTMLParagraphElement>(null);

  const form = useForm<Input>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  useEffect(() => {
    if (serverError) alertRef.current?.focus();
  }, [serverError]);

  async function onSubmit(values: Input) {
    setServerError(null);
    setPending(true);
    const startedAt = Date.now();
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: values.email,
        password: values.password,
      });
      // Tempo de resposta idêntico nos dois casos (anti-enumeração por timing).
      const elapsed = Date.now() - startedAt;
      if (elapsed < 400) await new Promise((r) => setTimeout(r, 400 - elapsed));
      if (error) {
        setServerError(GENERIC_LOGIN_ERROR);
        return;
      }
      writeMfaPending(sessionStorage);
      navigate("/internal-admin/mfa", { replace: true });
    } catch {
      setServerError(GENERIC_LOGIN_ERROR);
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-2xl">Área interna</CardTitle>
        <CardDescription>Entrada exclusiva de operadores.</CardDescription>
      </CardHeader>
      <CardContent>
        {serverError ? (
          <p
            ref={alertRef}
            role="alert"
            tabIndex={-1}
            aria-live="assertive"
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
                    <Input type="email" autoComplete="email" placeholder="voce@empresa.com.br" {...field} />
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
                  <FormLabel>Senha</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="current-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" className="min-h-[44px] w-full" disabled={pending}>
              {pending ? (
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
    </Card>
  );
}
