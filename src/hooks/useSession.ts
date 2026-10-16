import { useQuery } from "@tanstack/react-query";
import type { AuthSession } from "@supabase/supabase-js";

import { supabase } from "@/lib/supabase";

/** Chave de cache da sessão Supabase. O `AuthListener` escreve nela. */
export const sessionQueryKey = ["session"] as const;

/**
 * Sessão Supabase como fonte única de verdade (TanStack Query).
 *
 * A sessão não "fica velha" por idade — ela muda por evento (login/logout/
 * refresh/recuperação). Por isso `staleTime: Infinity`: o cache é mantido em dia
 * pelo `AuthListener` (`onAuthStateChange`), não por polling nem refetch.
 *
 * Retorna `AuthSession | null` (null = sem sessão).
 */
export function useSession() {
  return useQuery<AuthSession | null>({
    queryKey: sessionQueryKey,
    queryFn: async () => {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      return data.session;
    },
    staleTime: Infinity,
  });
}
