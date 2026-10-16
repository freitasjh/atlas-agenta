import { useMutation, useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import { sessionQueryKey } from "@/hooks/useSession";
import type {
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

/** Login por e-mail/senha. Invalida sessão e profile em caso de sucesso. */
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
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
  });
}

/**
 * Cadastro da empresa. Mapeia `tradeName` (schema zod) → `trade_name` no
 * `options.data`, exatamente a chave que o trigger `handle_new_user` (ADR-04)
 * lê para nomear o tenant. Divergência aqui = tenant com nome nulo.
 * O cliente NUNCA envia `role` nem `tenant_id` — isso é decidido no servidor.
 */
export function useSignUp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ tradeName, email, password }: SignupInput) => {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { trade_name: tradeName },
        },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: sessionQueryKey });
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
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
