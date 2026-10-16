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
 * A `role` é lida do `profiles` sob RLS (sem `tenant_id` do cliente); o retorno
 * é pré-populado no cache de `profile` para o chrome não refazer a leitura. Se a
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
        const { data, error } = await supabase
          .from("profiles")
          .select("role")
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
