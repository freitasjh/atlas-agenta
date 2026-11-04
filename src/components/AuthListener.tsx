import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import { isSupabaseConfigured } from "@/lib/env";
import { applyAuthEvent } from "@/lib/auth-cache";

/**
 * Assina `supabase.auth.onAuthStateChange` UMA vez e mantém o cache da sessão
 * (`["session"]`) em dia sem polling. Cobre login/logout/refresh de token e o
 * evento `PASSWORD_RECOVERY` (usado pela tela de redefinição, ADR-07).
 *
 * Em `SIGNED_OUT`, também remove as queries de identidade dependentes para não
 * servir tenant obsoleto antes do redirect do guard.
 *
 * A reação ao cache fica em `applyAuthEvent` (`@/lib/auth-cache`), extraído para
 * reutilização e sofisticação (troca de conta, reset sem refetch). A identidade
 * em si vem das claims do JWT (ADR-07), que deixam de existir junto com a sessão.
 *
 * Guard por `isSupabaseConfigured`: este componente é montado no `RootLayout`,
 * então roda no load. Sem `.env` válido, não assina `onAuthStateChange`.
 *
 * Não renderiza nada; desinscreve no unmount.
 */
export function AuthListener() {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!isSupabaseConfigured) {
      return;
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      applyAuthEvent(queryClient, event, session);

      if (event === "SIGNED_OUT") {
        queryClient.removeQueries({ queryKey: ["tenant"] });
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [queryClient]);

  return null;
}
