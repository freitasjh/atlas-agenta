import { useCallback } from "react";
import { useNavigate } from "react-router-dom";

import { supabase } from "@/lib/supabase";
import { parseAuthClaims } from "@/lib/auth-claims";

/**
 * Decide o destino pós-login. Respeita o `from` (rota que o guard interrompeu)
 * quando houver; caso contrário, manda `super_admin` para `/admin` e os demais
 * papéis para `/app`.
 *
 * O papel vem das claims do access token (ADR-07), não de uma leitura de
 * `profiles`: o hook `custom-access-token` já emitiu `user_role` no token da
 * sessão (ADR-01). Decodificar no cliente não é fronteira de segurança — serve
 * para rotear; os guards e o RLS decidem acesso. Sessão sem claims cai no
 * destino padrão `/app`; o guard (ADR-08) trata como identidade ilegível. As
 * regras de destino (ex.: troca de senha obrigatória) ficam na ADR-11.
 */
export function usePostLoginRedirect() {
  const navigate = useNavigate();

  return useCallback(
    async (from?: string) => {
      if (from) {
        navigate(from, { replace: true });
        return;
      }

      try {
        const {
          data: { session },
          error,
        } = await supabase.auth.getSession();
        if (error) throw error;
        const claims = session
          ? parseAuthClaims(session.access_token)
          : null;
        navigate(claims?.role === "super_admin" ? "/admin" : "/app", {
          replace: true,
        });
      } catch {
        navigate("/app", { replace: true });
      }
    },
    [navigate],
  );
}
