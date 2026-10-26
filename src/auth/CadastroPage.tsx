import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { signupSchema, type SignupInput } from "@/lib/validations/auth";
import type { BusinessSegment } from "@/types/domain";
import { mapAuthError } from "@/lib/auth-errors";
import { useSignUp } from "@/hooks/useAuthMutations";
import { getPlan, parsePlanSlug } from "@/lib/plans";

/** Códigos de erro do Supabase que indicam e-mail já cadastrado. */
const EMAIL_TAKEN_CODES = new Set(["user_already_exists", "email_exists"]);

/**
 * Rótulos pt-BR dos ramos oferecidos no cadastro. Enum fechado de 3 valores
 * (sem "Outro", sem default silencioso); os literais são a chave-contrato
 * enviada em `options.data.segment` e validada pelo servidor.
 */
const SEGMENT_LABELS: Record<BusinessSegment, string> = {
  barbearia: "Barbearia",
  clinica: "Clínica",
  salao: "Salão de beleza",
};

/**
 * Cadastro da empresa. Cria `auth.user` + (via trigger `handle_new_user`)
 * tenant em `trial` e profile admin. Coleta nome da empresa, ramo
 * (obrigatório), e-mail e senha — CNPJ/plano ficam para uma fase posterior.
 *
 * Com confirmação de e-mail desligada (MVP), o `signUp` já abre sessão e
 * seguimos para `/app`. O código permanece tolerante ao ramo "verifique seu
 * e-mail" caso a config do Supabase mude: se não vier sessão, mostramos a
 * instrução neutra em vez de navegar.
 */
export function CadastroPage() {
  const signUp = useSignUp();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Intenção de plano vinda de `/precos` (`?plano=`). Entrada não confiável:
  // `parsePlanSlug` valida contra o enum e devolve `null` no caso inválido.
  // Puramente apresentacional — não entra em `onSubmit` nem é persistida.
  const plan = parsePlanSlug(params.get("plano"));
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
        <CardDescription>Comece seu teste gratuito.</CardDescription>
      </CardHeader>
      <CardContent>
        {plan ? (
          <div
            aria-labelledby="plano-escolhido-titulo"
            className="mb-4 rounded-md border border-primary/30 bg-primary/5 p-4"
          >
            <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-foreground">
              Plano escolhido
            </span>
            <p
              id="plano-escolhido-titulo"
              className="mt-2 font-display font-semibold"
            >
              Você escolheu o plano {getPlan(plan).nome}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {getPlan(plan).destaques.join(" · ")}
            </p>
          </div>
        ) : null}
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
              name="segment"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Ramo da empresa</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione o ramo" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="barbearia">
                        {SEGMENT_LABELS.barbearia}
                      </SelectItem>
                      <SelectItem value="clinica">
                        {SEGMENT_LABELS.clinica}
                      </SelectItem>
                      <SelectItem value="salao">
                        {SEGMENT_LABELS.salao}
                      </SelectItem>
                    </SelectContent>
                  </Select>
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
