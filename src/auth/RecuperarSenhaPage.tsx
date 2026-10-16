import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
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

import {
  requestResetSchema,
  type RequestResetInput,
} from "@/lib/validations/auth";
import { useRequestPasswordReset } from "@/hooks/useAuthMutations";

const NEUTRAL_MESSAGE =
  "Se houver uma conta com esse e-mail, enviamos um link de redefinição.";

/**
 * Solicita o link de redefinição. A resposta ao usuário é SEMPRE neutra
 * (anti-enumeração): sucesso ou e-mail inexistente mostram a mesma mensagem. O
 * erro técnico é propagado pelo mutation apenas para log; aqui não é exibido.
 */
export function RecuperarSenhaPage() {
  const requestReset = useRequestPasswordReset();
  const [sent, setSent] = useState(false);
  const feedbackRef = useRef<HTMLParagraphElement>(null);

  const form = useForm<RequestResetInput>({
    resolver: zodResolver(requestResetSchema),
    defaultValues: { email: "" },
  });

  useEffect(() => {
    if (sent) feedbackRef.current?.focus();
  }, [sent]);

  async function onSubmit(values: RequestResetInput) {
    try {
      await requestReset.mutateAsync(values);
    } catch {
      // Silenciado de propósito: a mensagem ao usuário é neutra de qualquer forma.
    } finally {
      setSent(true);
    }
  }

  if (sent) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="font-display text-2xl">
            Verifique seu e-mail
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p
            ref={feedbackRef}
            role="status"
            tabIndex={-1}
            className="text-sm text-muted-foreground focus-visible:outline-none"
          >
            {NEUTRAL_MESSAGE}
          </p>
        </CardContent>
        <CardFooter className="text-sm text-muted-foreground">
          <Link
            to="/login"
            className="rounded-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Voltar para o login
          </Link>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-2xl">Recuperar senha</CardTitle>
        <CardDescription>
          Informe seu e-mail e enviaremos um link para redefinir a senha.
        </CardDescription>
      </CardHeader>
      <CardContent>
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
            <Button
              type="submit"
              className="w-full"
              disabled={requestReset.isPending}
            >
              {requestReset.isPending ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden="true" />
                  Enviando…
                </>
              ) : (
                "Enviar link de redefinição"
              )}
            </Button>
          </form>
        </Form>
      </CardContent>
      <CardFooter className="text-sm text-muted-foreground">
        <Link
          to="/login"
          className="rounded-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Voltar para o login
        </Link>
      </CardFooter>
    </Card>
  );
}
