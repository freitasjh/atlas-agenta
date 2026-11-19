import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { useCurrentUser } from "@/hooks/useCurrentUser";
import { planCatalogRowSchema } from "@/lib/plans";
import { supabase } from "@/lib/supabase";

/**
 * Entitlements Fase 5 — **contrato de interface congelado (ADR-01)**.
 * Única fonte de gating da Fase 2 (`prontuario`, `pacotes`,
 * `aestheticCheckout`), Fase 3 (`estoque`, `comissaoProduto`), Fase 4
 * (`deposito`, `waitlist`, `campanhas`, `fidelidade`, `checkoutSelfService`)
 * e Fase 5 (`nfce`, `recorrencia`, `contasPagar`, `conciliacao`, `dreFluxo`,
 * `exportContabil`, `backofficeT14`, `backofficeT15`).
 * `null` = ausente/falha/sujo: o chamador degrada
 * (conteúdo legível, escrita bloqueada + upsell), nunca trava, nunca dispara
 * request sensível novo, nunca lança. Sem motor de quotas neste escopo; o
 * trava real continua sendo RLS. `segment-features` intocado (dono de
 * `payments` salão/barbearia; `aestheticCheckout` vive aqui, no entitlement).
 */
export interface PlanEntitlements {
  prontuario: boolean;
  pacotes: boolean;
  aestheticCheckout: boolean;
  estoque: boolean; // NOVO Fase 3 (T1.2)
  comissaoProduto: boolean; // NOVO Fase 3 (T1.2)
  deposito: boolean; // NOVO Fase 4 (ADR-01)
  waitlist: boolean; // NOVO Fase 4 (ADR-01)
  campanhas: boolean; // NOVO Fase 4 (ADR-01)
  fidelidade: boolean; // NOVO Fase 4 (ADR-01)
  checkoutSelfService: boolean; // NOVO Fase 4 (ADR-01, T1.3)
  nfce: boolean; // NOVO Fase 5 (ADR-01)
  recorrencia: boolean; // NOVO Fase 5 (ADR-01)
  contasPagar: boolean; // NOVO Fase 5 (ADR-01)
  conciliacao: boolean; // NOVO Fase 5 (ADR-01)
  dreFluxo: boolean; // NOVO Fase 5 (ADR-01)
  exportContabil: boolean; // NOVO Fase 5 (ADR-01)
  backofficeT14: boolean; // NOVO Fase 5 (ADR-01)
  backofficeT15: boolean; // NOVO Fase 5 (ADR-01)
}

/** Alias de compatibilidade (Fase 2 ADR-01). */
export type AestheticEntitlements = PlanEntitlements;

const ENTITLEMENT_KEYS = [
  "prontuario",
  "pacotes",
  "aestheticCheckout",
  "estoque",
  "comissaoProduto",
  "deposito",
  "waitlist",
  "campanhas",
  "fidelidade",
  "checkoutSelfService",
  "nfce",
  "recorrencia",
  "contasPagar",
  "conciliacao",
  "dreFluxo",
  "exportContabil",
  "backofficeT14",
  "backofficeT15",
] as const;

function isValidEntitlements(raw: unknown): raw is Record<string, boolean> {
  if (typeof raw !== "object" || raw === null) return false;
  const record = raw as Record<string, unknown>;
  return ENTITLEMENT_KEYS.every((key) => typeof record[key] === "boolean");
}

/**
 * Flags do catálogo SSoT (`public.plans.features`) que alimentam o contrato.
 * Slugs nunca são hardcoded aqui: a linha é localizada pelo `tenant.plan`
 * vigente no catálogo — slug legado ou fora do catálogo não casa e degrada
 * para `null`.
 */
const FEATURE_PRONTUARIO = "prontuario";
const FEATURE_PACOTES = "pacotes_sessoes";
const FEATURE_CHECKOUT = "cobranca_pix";
const FEATURE_ESTOQUE = "estoque";
const FEATURE_COMISSAO_PRODUTO = "comissao_produto";
const FEATURE_DEPOSITO = "deposito";
const FEATURE_WAITLIST = "waitlist";
const FEATURE_CAMPANHAS = "campanhas";
const FEATURE_FIDELIDADE = "fidelidade";
const FEATURE_CHECKOUT_SELF_SERVICE = "checkout_self_service";
const FEATURE_NFCE = "nfce";
const FEATURE_RECORRENCIA = "recorrencia";
const FEATURE_CONTAS_PAGAR = "contas_pagar";
const FEATURE_CONCILIACAO = "conciliacao";
const FEATURE_DRE_FLUXO = "dre_fluxo";
const FEATURE_EXPORT_CONTABIL = "export_contabil";
const FEATURE_BACKOFFICE_T14 = "backoffice_t14";
const FEATURE_BACKOFFICE_T15 = "backoffice_t15";

const catalogRowsSchema = z.array(planCatalogRowSchema);

export const PLAN_ENTITLEMENTS_KEY = ["plans", "entitlements"] as const;

function mapFeaturesToEntitlements(
  features: unknown,
): PlanEntitlements | null {
  if (!Array.isArray(features)) return null;
  const flags = new Set(features.filter((f): f is string => typeof f === "string"));
  return {
    prontuario: flags.has(FEATURE_PRONTUARIO),
    pacotes: flags.has(FEATURE_PACOTES),
    aestheticCheckout: flags.has(FEATURE_CHECKOUT),
    estoque: flags.has(FEATURE_ESTOQUE),
    comissaoProduto: flags.has(FEATURE_COMISSAO_PRODUTO),
    deposito: flags.has(FEATURE_DEPOSITO),
    waitlist: flags.has(FEATURE_WAITLIST),
    campanhas: flags.has(FEATURE_CAMPANHAS),
    fidelidade: flags.has(FEATURE_FIDELIDADE),
    checkoutSelfService: flags.has(FEATURE_CHECKOUT_SELF_SERVICE),
    nfce: flags.has(FEATURE_NFCE),
    recorrencia: flags.has(FEATURE_RECORRENCIA),
    contasPagar: flags.has(FEATURE_CONTAS_PAGAR),
    conciliacao: flags.has(FEATURE_CONCILIACAO),
    dreFluxo: flags.has(FEATURE_DRE_FLUXO),
    exportContabil: flags.has(FEATURE_EXPORT_CONTABIL),
    backofficeT14: flags.has(FEATURE_BACKOFFICE_T14),
    backofficeT15: flags.has(FEATURE_BACKOFFICE_T15),
  };
}

async function fetchCatalogRows() {
  const { data, error } = await supabase.rpc("get_plans");
  if (error) throw error;
  return catalogRowsSchema.parse(data);
}

/**
 * Leitura Fase 5 (ADR-01) com cadeia de resolução em duas etapas:
 *
 * 1. `tenant.entitlements` válido → usa direto (precedência do T1.x futuro).
 *    Válido = as 18 booleanas presentes (payload legado sem as 8 da Fase 5
 *    degrada para `null`; o catálogo cobre).
 * 2. Senão, catálogo público `get_plans()` pelo `tenant.plan` → mapeia
 *    `features` para o contrato. Plano ausente/inativo, catálogo vazio,
 *    loading ou falha de rede → `null` (chamador degrada, telas seguem
 *    legíveis).
 *
 * **Nunca lança**: dado sujo vira `null`. Chaves extras do T1.x são ignoradas
 * para manter o contrato exato. Salão/barbearia inalterados: `payments` deles
 * continua vindo de `segment-features`; `aestheticCheckout=true` neles é
 * inócuo por OR.
 */
export function usePlanEntitlements(): PlanEntitlements | null {
  const { tenant } = useCurrentUser();

  const raw =
    (tenant as unknown as Record<string, unknown> | null)?.["entitlements"];
  const hasDirectEntitlements = isValidEntitlements(raw);

  const plan =
    typeof tenant?.plan === "string" && tenant.plan.length > 0
      ? tenant.plan
      : null;

  const catalogQuery = useQuery({
    queryKey: PLAN_ENTITLEMENTS_KEY,
    queryFn: fetchCatalogRows,
    // Catálogo quase estático; falha degrada rápido para `null` sem retry.
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    retry: false,
    enabled: !hasDirectEntitlements && plan !== null,
  });

  if (!tenant) return null;
  if (hasDirectEntitlements && raw) {
    const record = raw as unknown as Record<string, boolean>;
    return {
      prontuario: record["prontuario"],
      pacotes: record["pacotes"],
      aestheticCheckout: record["aestheticCheckout"],
      estoque: record["estoque"],
      comissaoProduto: record["comissaoProduto"],
      deposito: record["deposito"],
      waitlist: record["waitlist"],
      campanhas: record["campanhas"],
      fidelidade: record["fidelidade"],
      checkoutSelfService: record["checkoutSelfService"],
      nfce: record["nfce"],
      recorrencia: record["recorrencia"],
      contasPagar: record["contasPagar"],
      conciliacao: record["conciliacao"],
      dreFluxo: record["dreFluxo"],
      exportContabil: record["exportContabil"],
      backofficeT14: record["backofficeT14"],
      backofficeT15: record["backofficeT15"],
    };
  }

  const rows = catalogQuery.data;
  if (!rows || plan === null) return null;
  const row = rows.find((r) => r.slug === plan && r.active);
  if (!row) return null;
  return mapFeaturesToEntitlements(row.features);
}
