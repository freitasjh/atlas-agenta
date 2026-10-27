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
 * Em `SIGNED_OUT`, `applyAuthEvent` remove todo o cache de dados do usuário
 * anterior (preservando a sessão), para não servir dados obsoletos antes do
 * redirect do guard nem vazar dados entre contas no mesmo navegador.
 *
 * Único consumidor que toca o client no LOAD (montado no `RootLayout` que
 * envolve todas as rotas). Por isso traz o guard por `isSupabaseConfigured`:
 * sem `.env` válido, nem assina `onAuthStateChange` — early-return. É o ponto
 * cirúrgico que reprovou a 1ª tentativa; combinado com o client no-op de
 * `supabase.ts`, o load fica seguro sem custo para o caminho configurado.
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
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [queryClient]);

  return null;
}
