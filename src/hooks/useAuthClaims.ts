import { useMemo } from "react";

import { useSession } from "@/hooks/useSession";
import { parseAuthClaims, type AuthClaims } from "@/lib/auth-claims";

/**
 * Claims de identidade da sessão atual (ADR-07).
 *
 * Deriva de `useSession()` com `useMemo`: nenhuma query, nenhuma chamada de
 * rede. O token já está no cache da sessão; decodificar é síncrono. `null`
 * significa claims ausentes ou inválidas (sessão emitida antes do hook, ou
 * token adulterado) — o agregador traduz em `hasIdentityError`.
 */
export function useAuthClaims(): AuthClaims | null {
  const { data: session } = useSession();
  const accessToken = session?.access_token ?? null;

  return useMemo(
    () => (accessToken ? parseAuthClaims(accessToken) : null),
    [accessToken],
  );
}
