import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { supabase } from "@/lib/supabase";
import { ROLES } from "@/types/domain";

const profileRoleSchema = z.object({ role: z.enum(ROLES) });

/**
 * Decide o destino pós-login. Respeita o `from` (rota que o guard interrompeu)
 * quando houver; caso contrário, manda `super_admin` para `/admin` e os demais
 * papéis para `/app`.
 *
 * A `role` é lida da PRÓPRIA linha do `profiles` via `.eq("id", userId)` antes do
 * `.single()` — não pelo RLS. A policy `profiles_select_same_tenant` deixa o
 * usuário enxergar TODOS os profiles do tenant, então um `.single()` sem esse
 * filtro retorna 406 em tenants com 2+ profiles. O `userId` vem sempre da sessão
 * Supabase autenticada (`supabase.auth.getUser()`, `id = auth.uid()`), nunca de
 * entrada do cliente, e NÃO é filtro de tenant. Se não houver usuário/sessão ou a
 * leitura falhar, cai no destino padrão `/app` — os guards (ADR-08) reavaliam.
 */
export function usePostLoginRedirect() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  return useCallback(
    async (from?: string) => {
      if (from) {
        navigate(from, { replace: true });
        return;
      }

      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        const userId = user?.id;
        if (!userId) throw new Error("Sessão sem usuário ao ler o profile.");
        const { data, error } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", userId)
          .single();
        if (error) throw error;
        const { role } = profileRoleSchema.parse(data);
        void queryClient.invalidateQueries({ queryKey: ["profile"] });
        navigate(role === "super_admin" ? "/admin" : "/app", {
          replace: true,
        });
      } catch {
        navigate("/app", { replace: true });
      }
    },
    [navigate, queryClient],
  );
}
