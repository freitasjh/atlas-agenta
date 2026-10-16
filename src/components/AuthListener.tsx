import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import { sessionQueryKey } from "@/hooks/useSession";

/**
 * Assina `supabase.auth.onAuthStateChange` UMA vez e mantém o cache da sessão
 * (`["session"]`) em dia sem polling. Cobre login/logout/refresh de token e o
 * evento `PASSWORD_RECOVERY` (usado pela tela de redefinição, ADR-07).
 *
 * Em `SIGNED_OUT`, também remove as queries de identidade dependentes para não
 * servir profile/tenant obsoletos antes do redirect do guard.
 *
 * Não renderiza nada; desinscreve no unmount.
 */
export function AuthListener() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      queryClient.setQueryData(sessionQueryKey, session);

      if (event === "SIGNED_OUT") {
        queryClient.removeQueries({ queryKey: ["profile"] });
        queryClient.removeQueries({ queryKey: ["tenant"] });
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [queryClient]);

  return null;
}
