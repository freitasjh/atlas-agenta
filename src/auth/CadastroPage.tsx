import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { AuthError } from "@supabase/supabase-js";
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

import { signupSchema, type SignupInput } from "@/lib/validations/auth";
import { mapAuthError } from "@/lib/auth-errors";
import { useSignUp } from "@/hooks/useAuthMutations";

/** Códigos de erro do Supabase que indicam e-mail já cadastrado. */
const EMAIL_TAKEN_CODES = new Set(["user_already_exists", "email_exists"]);

/**
 * Cadastro da empresa. Cria `auth.user` + (via trigger ADR-04) tenant em
 * `trial` e profile admin. Escopo do MVP: só nome da empresa, e-mail e senha —
 * CNPJ/segmento/plano ficam para uma fase posterior.
 *
 * Com confirmação de e-mail desligada (MVP), o `signUp` já abre sessão e
 * seguimos para `/app`. O código permanece tolerante ao ramo "verifique seu
 * e-mail" caso a config do Supabase mude: se não vier sessão, mostramos a
 * instrução neutra em vez de navegar.
 */
export function CadastroPage() {
  const signUp = useSignUp();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);
  const feedbackRef = useRef<HTMLParagraphElement>(null);

  const form = useForm<SignupInput>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      tradeName: "",
      email: "",
      password: "",
      confirmPassword: "",
    },
  });

  useEffect(() => {
    if (serverError || checkEmail) feedbackRef.current?.focus();
  }, [serverError, checkEmail]);

  async function onSubmit(values: SignupInput) {
    setServerError(null);
    try {
      const result = await signUp.mutateAsync(values);
      if (result.session) {
        navigate("/app", { replace: true });
      } else {
        // Confirmação de e-mail ligada: sessão só abre após o usuário confirmar.
        setCheckEmail(true);
      }
    } catch (error) {
      if (error instanceof AuthError && EMAIL_TAKEN_CODES.has(error.code ?? "")) {
        form.setError("email", {
          type: "server",
          message: "Já existe uma conta com esse e-mail.",
        });
        return;
      }
      setServerError(mapAuthError(error));
    }
  }

  if (checkEmail) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="font-display text-2xl">
            Confirme seu e-mail
          </CardTitle>
          <CardDescription>
            Enviamos um link de confirmação para o e-mail informado. Abra-o para
            ativar sua conta.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p
            ref={feedbackRef}
            tabIndex={-1}
            className="text-sm text-muted-foreground focus-visible:outline-none"
          >
            Não recebeu? Confira a caixa de spam ou tente cadastrar novamente em
            alguns minutos.
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
        <CardTitle className="font-display text-2xl">
          Criar conta da empresa
        </CardTitle>
        <CardDescription>Comece o teste do Atlas Agenda.</CardDescription>
      </CardHeader>
      <CardContent>
        {serverError ? (
          <p
            ref={feedbackRef}
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
              name="tradeName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome da empresa</FormLabel>
                  <FormControl>
                    <Input autoComplete="organization" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
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
                  <FormLabel>Senha</FormLabel>
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
                  <FormLabel>Confirmar senha</FormLabel>
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
            <Button type="submit" className="w-full" disabled={signUp.isPending}>
              {signUp.isPending ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden="true" />
                  Criando conta…
                </>
              ) : (
                "Criar conta"
              )}
            </Button>
          </form>
        </Form>
      </CardContent>
      <CardFooter className="text-sm text-muted-foreground">
        <span>
          Já tem conta?{" "}
          <Link
            to="/login"
            className="rounded-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Entrar
          </Link>
        </span>
      </CardFooter>
    </Card>
  );
}
