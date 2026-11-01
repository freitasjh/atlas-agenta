import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AuthSession } from "@supabase/supabase-js";

import { supabase } from "@/lib/supabase";
import { sessionQueryKey } from "@/hooks/useSession";
import { parseAuthClaims, type AuthClaims } from "@/lib/auth-claims";
import type {
  InitialPasswordInput,
  LoginInput,
  RequestResetInput,
  ResetPasswordInput,
  SignupInput,
} from "@/lib/validations/auth";

/**
 * Mutations de autenticação (TanStack Query). Um hook por responsabilidade.
 * As telas (ADR-07) chamam estes mutations no `onSubmit` dos formulários e
 * mapeiam os erros para pt-BR com `mapAuthError` (lib/auth-errors).
 *
 * Nada de `fetch` solto; nenhum `tenant_id` do cliente; sem segredos.
 */

/** Login por e-mail/senha. Invalida a sessão em caso de sucesso (ADR-07: a
 * identidade vem das claims do novo token — nenhuma leitura de `profiles`). */
export function useSignIn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ email, password }: LoginInput) => {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sessionQueryKey });
    },
  });
}

/**
 * Resultado do cadastro da empresa (ADR-03).
 *
 * `session` é a sessão aberta pelo login automático logo após a criação da
 * conta. `null` significa "empresa criada, sessão não": a tela manda para
 * `/login` com um aviso neutro — não há dado órfão, a conta só não está logada.
 */
export interface SignUpResult {
  session: AuthSession | null;
}

/**
 * Cadastro da empresa (ADR-03) pela Edge Function `signup-tenant` (ADR-02).
 *
 * - O trigger `handle_new_user` não existe mais: o cadastro nativo do Auth no
 *   cliente criaria usuário SEM empresa/profile. A empresa (tenant + profile
 *   admin + templates) nasce na RPC transacional do servidor.
 * - O corpo leva SÓ os campos da ADR-02 (`email`, `password`, `trade_name`,
 *   `segment`). Nada de `role`, `tenant_id` ou `app_metadata`: o papel é
 *   decidido no servidor, nunca pelo cliente.
 * - Em sucesso, o login automático usa o mesmo e-mail e a mesma senha; a
 *   sessão resultante alimenta o destino pós-login da ADR-08.
 * - A senha existe só nas variáveis da mutation: `gcTime: 0` descarta o cache
 *   assim que não há observador (não entra em query key, `localStorage` nem
 *   log).
 * - Falha do invoke sobe como `Error` com `{ status, code }` para
 *   `mapSignUpError` traduzir; a mensagem do servidor não chega à tela.
 */
export function useSignUp() {
  const queryClient = useQueryClient();

  return useMutation<SignUpResult, Error, SignupInput>({
    gcTime: 0,
    mutationFn: async ({ tradeName, segment, email, password }) => {
      const { error } = await supabase.functions.invoke("signup-tenant", {
        body: { email, password, trade_name: tradeName, segment },
      });

      if (error) {
        const details = await readInvokeError(error);
        throw Object.assign(new Error("signup_failed"), details);
      }

      // Conta já criada: falhar o login aqui não desfaz nada e não deve assustar
      // o usuário com erro de cadastro. A tela pede login na tela própria.
      // Por isso o `try/catch`: a falha pode vir como `{ error }` (AuthError) ou
      // como throw (transporte/biblioteca). Os dois caminhos devolvem
      // `{ session: null }` — nunca erro de cadastro por causa do login.
      try {
        const { data } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        return { session: data.session ?? null };
      } catch {
        return { session: null };
      }
    },
    onSuccess: ({ session }) => {
      if (!session) return;
      void queryClient.invalidateQueries({ queryKey: sessionQueryKey });
    },
  });
}

/**
 * Dispara o e-mail de redefinição, com redirect para a tela `/redefinir-senha`
 * (ADR-07). A tela mostra uma confirmação neutra independentemente do resultado
 * (anti-enumeração), mas o erro técnico ainda é propagado para log.
 */
export function useRequestPasswordReset() {
  return useMutation({
    mutationFn: async ({ email }: RequestResetInput) => {
      const redirectTo = `${window.location.origin}/redefinir-senha`;
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo,
      });
      if (error) throw error;
    },
  });
}

/** Define a nova senha (requer sessão de recuperação ativa). */
export function useUpdatePassword() {
  return useMutation({
    mutationFn: async ({ password }: ResetPasswordInput) => {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
    },
  });
}

/**
 * Resultado da troca de senha obrigatória (ADR-09).
 *
 * `claims` vem do token NOVO: relogin com a senha recém-definida no 200, ou
 * token renovado no 409 `password_change_not_required`. `null` significa que a
 * criação da sessão falhou (ou não devolveu token): a senha já foi salva, então
 * a mutation NÃO falha — a tela (ADR-10) decide sair e pedir login de novo.
 * Nunca se libera o painel com token defasado.
 */
export interface ChangeInitialPasswordResult {
  ok: true;
  claims: AuthClaims | null;
}

/** Código 409 benigno: o flag já foi limpo (outra aba trocou primeiro). */
const PASSWORD_CHANGE_NOT_REQUIRED = "password_change_not_required";

/** Status/código de um erro do `functions.invoke`, lidos sem confiar no corpo. */
interface InvokeErrorDetails {
  status: number | null;
  code: string | null;
}

/**
 * Lê `{ status, code }` de um `FunctionsHttpError` (o `context` é a `Response`,
 * cujo corpo só pode ser consumido de forma assíncrona). O `code` é opcional:
 * sem corpo JSON legível o `status` continua valendo. Nunca lança.
 */
async function readInvokeError(error: unknown): Promise<InvokeErrorDetails> {
  if (typeof error !== "object" || error === null) {
    return { status: null, code: null };
  }

  const context = (error as { context?: unknown }).context;
  if (!(context instanceof Response)) return { status: null, code: null };

  let code: string | null = null;
  try {
    const body: unknown = await context.clone().json();
    if (typeof body === "object" && body !== null) {
      const value = (body as Record<string, unknown>).code;
      if (typeof value === "string") code = value;
    }
  } catch {
    // Corpo vazio/não-JSON (gateway): só o status identifica o erro.
    code = null;
  }

  return { status: context.status, code };
}

/** Claims de um access token qualquer, ou `null`. Nunca lança. */
function claimsFromToken(accessToken: string | null | undefined): AuthClaims | null {
  return accessToken ? parseAuthClaims(accessToken) : null;
}

/** Claims do token renovado pelo `refreshSession` (token ainda válido). */
async function refreshSessionClaims(): Promise<AuthClaims | null> {
  const { data, error } = await supabase.auth.refreshSession();
  if (error) return null;
  return claimsFromToken(data.session?.access_token);
}

/**
 * Claims do token criado por um login novo. Qualquer falha (rede, transporte,
 * `AuthError`) devolve `null`: a senha já foi salva e a tela cai em `/login`.
 */
async function signInClaims(
  email: string,
  password: string,
): Promise<AuthClaims | null> {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) return null;
    return claimsFromToken(data.session?.access_token);
  } catch {
    return null;
  }
}

/**
 * Troca a senha provisória pela definitiva (ADR-09) via Edge Function
 * `change-password` (ADR-04).
 *
 * - O corpo leva SÓ `password`: o usuário vem do JWT (`verify_jwt`), nunca do
 *   cliente. A senha existe apenas nas variáveis da mutation — não entra em
 *   query key, `localStorage` nem `console`.
 * - O e-mail é lido da sessão ANTES do invoke: o GoTrue revoga as sessões do
 *   usuário quando a senha muda, então depois do `200` o `getSession()` pode
 *   voltar vazio e o relogin ficaria sem identidade.
 * - `200` (senha trocada, sessões revogadas): `refreshSession` responderia 400.
 *   A sessão nova nasce de `signInWithPassword` com a senha nova; as claims do
 *   token novo são o resultado. Falha do login não derruba a mutation —
 *   devolve `claims: null` e a tela pede login de novo.
 * - `409 password_change_not_required` (flag já limpo por outra aba): a senha
 *   NÃO mudou e a sessão continua válida, então o caminho é `refreshSession`.
 * - `gcTime: 0`: o cache da mutation (incluindo as variáveis) morre assim que
 *   não há observador; a tela também chama `mutation.reset()` no sucesso.
 * - Os erros sobem como `Error` com `{ status, code }` para
 *   `mapInitialPasswordError` traduzir em pt-BR (mensagem do servidor nunca
 *   chega à tela).
 */
export function useChangeInitialPassword() {
  const queryClient = useQueryClient();

  return useMutation<
    ChangeInitialPasswordResult,
    Error,
    Pick<InitialPasswordInput, "password">
  >({
    gcTime: 0,
    mutationFn: async ({ password }) => {
      const { data: currentSession } = await supabase.auth.getSession();
      const email = currentSession.session?.user.email ?? null;

      const { error } = await supabase.functions.invoke("change-password", {
        body: { password },
      });

      if (error) {
        const details = await readInvokeError(error);
        // Fail-closed: só o código estável da ADR-04 prova que o flag já foi
        // limpo. 409 sem corpo legível (gateway/proxy) NÃO é sucesso — vira
        // erro e a tela mostra a mensagem genérica.
        const alreadyChanged =
          details.status === 409 &&
          details.code === PASSWORD_CHANGE_NOT_REQUIRED;

        if (!alreadyChanged) {
          throw Object.assign(new Error("change_password_failed"), details);
        }

        // Flag já limpo por outra aba: a senha atual continua valendo, logo a
        // sessão em mãos segue renovável.
        return { ok: true, claims: await refreshSessionClaims() };
      }

      // 200: senha trocada e sessões revogadas. Relogin com a senha nova cria
      // a sessão que carrega o flag já limpo nas claims.
      const claims = email ? await signInClaims(email, password) : null;
      return { ok: true, claims };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sessionQueryKey });
    },
  });
}

/**
 * Logout. Encerra a sessão no Supabase e LIMPA todo o cache do TanStack Query
 * (`queryClient.clear()`) para não vazar dados do usuário anterior. O logout
 * local é soberano: mesmo com falha de rede, o cache é limpo.
 */
export function useSignOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    },
    onSettled: () => {
      queryClient.clear();
    },
  });
}
