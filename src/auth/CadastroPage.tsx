import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { signupSchema, type SignupInput } from "@/lib/validations/auth";
import type { BusinessSegment } from "@/types/domain";
import { mapSignUpError } from "@/lib/auth-errors";
import { useSignUp } from "@/hooks/useAuthMutations";
import { usePostLoginRedirect } from "@/auth/usePostLoginRedirect";
import { getPlan, parsePlanSlug } from "@/lib/plans";

/**
 * Aviso levado ao `/login` quando a conta nasce mas o login automático falha.
 * Texto neutro: a conta existe, só não há sessão (ADR-03).
 */
const SKIP_AUTO_LOGIN_NOTICE = "Conta criada. Entre com seu e-mail e senha.";

/**
 * Rótulos pt-BR dos ramos oferecidos no cadastro. Enum fechado de 3 valores
 * (sem "Outro", sem default silencioso); os literais são o mesmo enum do
 * servidor — a chave enviada em `body.segment` da Edge Function `signup-tenant`
 * (ADR-02).
 */
const SEGMENT_LABELS: Record<BusinessSegment, string> = {
  barbearia: "Barbearia",
  clinica: "Clínica",
  salao: "Salão de beleza",
};

/**
 * Cadastro da empresa. A conta e a empresa (tenant em `trial` + profile admin +
 * templates) nascem na Edge Function `signup-tenant` (ADR-02), numa transação
 * só do servidor — o cliente não cria usuário nem escolhe papel.
 *
 * Em sucesso o próprio hook faz o login com o mesmo e-mail e senha, e a sessão
 * resultante segue para o destino pós-login da ADR-08 (flag de troca de senha
 * primeiro, depois `/admin/empresas` para `super_admin`, senão `/app`).
 * Se o login automático falhar, a conta já existe: a tela vai para `/login`
 * com o aviso neutro, sem dado órfão e sem assustar o usuário com erro.
 */
export function CadastroPage() {
  const signUp = useSignUp();
  const redirectAfterLogin = usePostLoginRedirect();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  // Intenção de plano vinda de `/precos` (`?plano=`). Entrada não confiável:
  // `parsePlanSlug` valida contra o enum e devolve `null` no caso inválido.
  // Puramente apresentacional — não entra em `onSubmit` nem é persistida.
  const plan = parsePlanSlug(params.get("plano"));
  const [serverError, setServerError] = useState<string | null>(null);
  const feedbackRef = useRef<HTMLParagraphElement>(null);

  const form = useForm<SignupInput>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      tradeName: "",
      // Sentinela vazia (mesmo padrão dos Selects de `AppointmentFormDialog`):
      // mantém o campo CONTROLADO desde o primeiro render (sem o warning do
      // React "uncontrolled → controlled"), sem virar default silencioso — o
      // enum zod não aceita "" e a submissão sem escolha dispara o erro pt-BR.
      segment: "" as BusinessSegment,
      email: "",
      password: "",
      confirmPassword: "",
    },
  });

  useEffect(() => {
    if (serverError) feedbackRef.current?.focus();
  }, [serverError]);

  async function onSubmit(values: SignupInput) {
    setServerError(null);
    try {
      const { session } = await signUp.mutateAsync(values);
      if (session) {
        redirectAfterLogin(session);
        return;
      }
      // Empresa criada, sessão não: nada de dado órfão — pede login na tela
      // própria, com aviso neutro (ADR-03).
      navigate("/login", {
        replace: true,
        state: { notice: SKIP_AUTO_LOGIN_NOTICE },
      });
    } catch (error) {
      setServerError(mapSignUpError(error));
    }
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
                    value={field.value || undefined}
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
