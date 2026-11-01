import { useMutation, useQueryClient } from "@tanstack/react-query";

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
 * Cadastro da empresa. Mapeia `tradeName` (schema zod) → `trade_name` e
 * `segment` → `segment` no `options.data`, exatamente as chaves que o trigger
 * `handle_new_user` lê (`raw_user_meta_data->>'trade_name'` / `->>'segment'`)
 * para nomear o tenant e gravar o ramo. Divergência de chave = dado nascendo
 * nulo silenciosamente. O `segment` é metadado de signup validado no servidor
 * (defesa em profundidade com o `check` do banco); nunca é fronteira de acesso.
 * O cliente NUNCA envia `role` nem `tenant_id` — isso é decidido no servidor.
 */
export function useSignUp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ tradeName, segment, email, password }: SignupInput) => {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { trade_name: tradeName, segment },
        },
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
 * `claims` vem do token RENOVADO. `null` significa que a renovação falhou (ou
 * não devolveu token): a senha já foi salva, então a mutation NÃO falha — a
 * tela (ADR-10) decide sair e pedir login de novo. Nunca se libera o painel
 * com token defasado.
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

/**
 * Troca a senha provisória pela definitiva (ADR-09) via Edge Function
 * `change-password` (ADR-04).
 *
 * - O corpo leva SÓ `password`: o usuário vem do JWT (`verify_jwt`), nunca do
 *   cliente. A senha existe apenas nas variáveis da mutation — não entra em
 *   query key, `localStorage` nem `console`.
 * - Sucesso e 409 `password_change_not_required` (flag já limpo por outra aba)
 *   seguem para a renovação do token e devolvem as claims do token novo.
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
      }

      // A troca encerra as outras sessões (ADR-04): o token em mãos está
      // defasado. Renovar é obrigatório para ver o flag limpo nas claims.
      const { data, error: refreshError } =
        await supabase.auth.refreshSession();
      const accessToken = refreshError ? null : data.session?.access_token;
      const claims = accessToken ? parseAuthClaims(accessToken) : null;

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
