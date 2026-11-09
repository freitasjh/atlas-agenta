import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/lib/supabase";
import type { OperatorProof } from "@/internal-admin/internalOperator";

export type InternalOperatorState =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | { status: "mfa_required" }
  | { status: "forbidden" }
  | { status: "allowed"; userId: string };

/**
 * Prova de operador interno via Edge `verify-operator` (server-side, AAL2 por
 * request). Nunca lê PostgREST de tenant; nunca confia em claim nem em cache
 * do cliente como prova. `aal2` sem `is_operator` não libera.
 */
export function useInternalOperator(): InternalOperatorState {
  const query = useQuery({
    queryKey: ["internal-operator-proof"],
    queryFn: async (): Promise<OperatorProof | null> => {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) return null;
      const { data, error } = await supabase.functions.invoke("verify-operator", {});
      if (error) {
        const status = (error as { status?: number }).status ?? (error as { context?: { status?: number } }).context?.status;
        if (status === 401) return null;
        throw error;
      }
      const body = data as
        | {
            is_operator?: unknown;
            isOperator?: unknown;
            aal?: unknown;
            user_id?: unknown;
            userId?: unknown;
          }
        | null;
      if (!body) return null;
      // C4: Edge responde snake_case {is_operator, aal, user_id}; aceitar
      // snake_case (canônico) + camelCase legado sem preferir um quebrado.
      const rawIsOperator =
        typeof body.is_operator === "boolean" ? body.is_operator : body.isOperator;
      if (typeof rawIsOperator !== "boolean") return null;
      const rawUserId =
        typeof body.user_id === "string"
          ? body.user_id
          : typeof body.userId === "string"
            ? body.userId
            : null;
      return {
        isOperator: rawIsOperator,
        aal: typeof body.aal === "string" ? body.aal : "aal1",
        userId: rawUserId,
      };
    },
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });

  if (query.isLoading) return { status: "loading" };
  if (query.isError) return { status: "forbidden" };
  const proof = query.data ?? null;
  if (!proof) return { status: "unauthenticated" };
  if (!proof.isOperator || proof.aal !== "aal2" || !proof.userId) {
    if (proof.isOperator && proof.aal !== "aal2") return { status: "mfa_required" };
    return { status: "forbidden" };
  }
  return { status: "allowed", userId: proof.userId };
}
