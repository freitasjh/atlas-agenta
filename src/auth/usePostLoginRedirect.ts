import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import type { AuthSession } from "@supabase/supabase-js";

import { parseAuthClaims } from "@/lib/auth-claims";
import { resolvePostLoginDestination } from "@/auth/resolvePostLoginDestination";

/**
 * Redireciona depois do login usando a sessão que o `signInWithPassword`
 * devolveu (ou a sessão atual) — ADR-08.
 *
 * Nenhuma consulta de rede: o papel e a flag de troca de senha já estão nas
 * claims do access token (ADR-07), e a decisão é da função pura
 * `resolvePostLoginDestination`. Decodificar no cliente não é fronteira de
 * segurança — serve para rotear; guards e RLS decidem acesso.
 *
 * O `from` (rota que o guard interrompeu) só vale para papéis de tenant e só se
 * for caminho interno válido. Depois da troca de senha ele NÃO é preservado: o
 * destino é sempre o do papel.
 */
export function usePostLoginRedirect() {
  const navigate = useNavigate();

  return useCallback(
    (session: AuthSession | null, from?: string | null) => {
      const claims = session ? parseAuthClaims(session.access_token) : null;

      navigate(
        resolvePostLoginDestination({
          role: claims?.role ?? null,
          mustChangePassword: claims?.mustChangePassword ?? false,
          from,
        }),
        { replace: true },
      );
    },
    [navigate],
  );
}
