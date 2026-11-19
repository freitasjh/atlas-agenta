import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { planCatalogRowSchema } from "@/lib/plans";
import { supabase } from "@/lib/supabase";

/**
 * Gating do back-office T1.4/T1.5 (ADR-11, RF-35).
 *
 * O operador interno é `super_admin` e **não tem tenant** — `usePlanEntitlements`
 * degrada para `null` nesse caso, e um gate `null` bloqueia. Para o back-office,
 * a capacidade é da **plataforma**: `backofficeT14`/`backofficeT15` ficam
 * liberados quando o catálogo SSoT (`plans.features`, lido por `get_plans`)
 * expõe a flag em pelo menos um plano **ativo** — mesma fonte da ADR-01, sem
 * tabela nova e sem request a dado sensível.
 *
 * Contrato (espelha `EntitlementGate`): `error` = falha ao falar com o catálogo
 * (rede/servidor) — não é prova de ausência e a UI mostra "não foi possível
 * verificar" com retry; `unavailable` = catálogo ilegível/vazio ou sem a flag —
 * seção legível **bloqueada** ("não incluído"). Em ambos, **zero request** às
 * tabelas/RPCs do back-office. Nunca lança, nunca trava a tela.
 */
export interface BackofficeEntitlements {
  backofficeT14: boolean;
  backofficeT15: boolean;
}

export type BackofficeEntitlementsState =
  | { status: "loading"; entitlements: null; retry: () => void }
  | { status: "error"; entitlements: null; retry: () => void }
  | { status: "unavailable"; entitlements: null; retry: () => void }
  | { status: "ready"; entitlements: BackofficeEntitlements; retry: () => void };

export const BACKOFFICE_ENTITLEMENTS_KEY = [
  "admin",
  "backoffice",
  "entitlements",
] as const;

const FEATURE_BACKOFFICE_T14 = "backoffice_t14";
const FEATURE_BACKOFFICE_T15 = "backoffice_t15";

const catalogResponseSchema = z.array(planCatalogRowSchema);

function featuresOf(row: z.infer<typeof planCatalogRowSchema>): Set<string> {
  if (!Array.isArray(row.features)) return new Set();
  return new Set(row.features.filter((f): f is string => typeof f === "string"));
}

/**
 * Deriva as duas flags do catálogo (dado não confiável). Exportado para teste
 * unitário. `null` = catálogo ilegível/vazio ou sem plano ativo; sem prova não
 * há liberação.
 */
export function computeBackofficeEntitlements(
  raw: unknown,
): BackofficeEntitlements | null {
  const parsed = catalogResponseSchema.safeParse(raw);
  if (!parsed.success) return null;

  const active = parsed.data.filter((row) => row.active);
  if (active.length === 0) return null;

  let backofficeT14 = false;
  let backofficeT15 = false;
  for (const row of active) {
    const flags = featuresOf(row);
    if (flags.has(FEATURE_BACKOFFICE_T14)) backofficeT14 = true;
    if (flags.has(FEATURE_BACKOFFICE_T15)) backofficeT15 = true;
  }
  return { backofficeT14, backofficeT15 };
}

/**
 * Estado das flags de back-office para a área interna. `loading` enquanto o
 * catálogo resolve; `error` em falha de rede/servidor; `unavailable` em dado
 * ilegível/vazio ou sem a flag (degrada sem request).
 */
export function useBackofficeEntitlements(): BackofficeEntitlementsState {
  const query = useQuery({
    queryKey: BACKOFFICE_ENTITLEMENTS_KEY,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_plans");
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: false,
  });

  const retry = () => {
    void query.refetch();
  };

  if (query.isLoading) return { status: "loading", entitlements: null, retry };
  if (query.isError) return { status: "error", entitlements: null, retry };

  const entitlements = computeBackofficeEntitlements(query.data);
  if (!entitlements) return { status: "unavailable", entitlements: null, retry };
  return { status: "ready", entitlements, retry };
}
