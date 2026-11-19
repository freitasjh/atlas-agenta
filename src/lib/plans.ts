/**
 * Planos do Atlas Agenda — ladder neutro (T1.0b).
 *
 * Slugs: `free` / `starter` / `premium` / `enterprise` (rename de
 * `individual`→`starter`, `clinica`→`premium`, `pro`→`enterprise`; `free`
 * atribuível com 1 prof / 30 agend/mês).
 *
 * Fonte canônica: tabela `public.plans`, lida pelo frontend via RPC
 * `get_plans()` (hook `usePlansCatalog`). Este módulo guarda a camada
 * **apresentacional** (rótulo pt-BR, público, destaques) + um fallback
 * estático com os mesmos preços/quotas da tabela — se a RPC falhar ou voltar
 * vazia, a UI continua operando com o fallback, e o teste de paridade
 * (`plans.parity.test.ts`) impede drift silencioso entre os dois.
 *
 * `?plano` é a **única superfície de entrada não confiável** da tarefa:
 * `parsePlanSlug` é o ponto único de validação contra o enum conhecido. O valor
 * cru nunca deve ser interpolado no DOM — só o rótulo pt-BR obtido por lookup.
 *
 * Decisão de fronteira: `PlanSlug` não vive em `src/types/domain.ts` (reservado
 * a enums de domínio persistidos); plano exibido aqui é apresentação + fallback.
 */

import { z } from "zod";

/** Slugs em ASCII usados na URL (`?plano=...`) e no banco (`tenants.plan`). */
export const PLAN_SLUGS = ["free", "starter", "premium", "enterprise"] as const;

export type PlanSlug = (typeof PLAN_SLUGS)[number];

export interface Plan {
  slug: PlanSlug;
  /** Rótulo exibido em pt-BR. */
  nome: string;
  /** Público-alvo do plano, em pt-BR. */
  publico: string;
  /** Destaques do plano, em pt-BR. */
  destaques: readonly string[];
  /** `true` apenas no plano recomendado (ancoragem de pricing). */
  recomendado?: boolean;
  /**
   * Preço mensal em **centavos inteiros** (fallback apresentacional; o valor
   * cobrado vem da tabela via Edge). Segue a convenção `*_cents` por
   * consistência conceitual; não é persistido nem acopla billing/checkout.
   */
  price_cents: number;
}

/**
 * Catálogo apresentacional (fallback da RPC). Preços/quotas espelham o seed da
 * migration de rename (`20261115000000_plan_rename_ladder.sql`) — paridade
 * travada por teste.
 */
export const PLANS: readonly Plan[] = [
  {
    slug: "free",
    nome: "Free",
    publico: "Experimentação",
    destaques: [
      "1 profissional",
      "Até 30 agendamentos por mês",
      "Régua de mensagens padrão",
    ],
    price_cents: 0,
  },
  {
    slug: "starter",
    nome: "Starter",
    publico: "Autônomo",
    destaques: [
      "1 profissional",
      "Até 150 agendamentos por mês",
      "Régua de mensagens padrão",
    ],
    price_cents: 5900,
  },
  {
    slug: "premium",
    nome: "Premium",
    publico: "Barbearia, salão e estética",
    destaques: [
      "Até 5 profissionais",
      "Agendamentos ilimitados",
      "Mensagens personalizadas e taxa de reserva configurável",
    ],
    recomendado: true,
    price_cents: 14900,
  },
  {
    slug: "enterprise",
    nome: "Enterprise",
    publico: "Multi-profissionais",
    destaques: [
      "Mais de 5 profissionais (adicional por extra)",
      "Relatórios",
      "Suporte prioritário",
    ],
    price_cents: 25900,
  },
] as const;

/**
 * Valida a entrada não confiável `?plano`. Faz `trim` + `lowercase` e checa
 * pertencimento ao enum conhecido; retorna o `PlanSlug` ou `null`. Não
 * interpola o valor cru — a UI usa o slug validado para lookup em `getPlan`.
 */
export function parsePlanSlug(raw: string | null): PlanSlug | null {
  if (raw === null) {
    return null;
  }
  const normalized = raw.trim().toLowerCase();
  return (PLAN_SLUGS as readonly string[]).includes(normalized)
    ? (normalized as PlanSlug)
    : null;
}

/** Lookup do `Plan` pelo slug validado. */
export function getPlan(slug: PlanSlug): Plan {
  // `find` sempre acha: o slug é um `PlanSlug` validado e `PLANS` cobre o enum.
  return PLANS.find((plan) => plan.slug === slug) as Plan;
}

/**
 * Formador BRL **curto** (sem centavos) dedicado ao preço de marketing.
 * Separado do `formatCentsToBRL` de `money.ts` de propósito: aquele é a borda
 * de dinheiro operacional do domínio (sempre 2 casas, para serviço/cobrança),
 * enquanto o preço de plano é "redondo" por decisão de produto.
 */
const BRL_WHOLE = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});

/** Formata o preço mensal do plano em BRL sem centavos (ex.: `R$ 59`). */
export function formatPlanPrice(plan: Plan): string {
  return BRL_WHOLE.format(plan.price_cents / 100);
}

// ============================================================================
// Consumo via RPC `get_plans()` (SSoT `public.plans`).
// ============================================================================

/** Linha do catálogo devolvida pela RPC `get_plans()` (dado não confiável). */
export const planCatalogRowSchema = z.object({
  slug: z.string(),
  name: z.string(),
  price_cents: z.number().int().nonnegative(),
  prof_limit: z.number().int().nullable(),
  appt_limit: z.number().int().nullable(),
  features: z.unknown(),
  active: z.boolean(),
  sort_order: z.number().int(),
});

export type PlanCatalogRow = z.infer<typeof planCatalogRowSchema>;

/**
 * Mescla as linhas da RPC sobre a camada apresentacional: preço pode vir da
 * tabela (fonte canônica); rótulo/público/destaques continuam estáticos.
 * Slugs desconhecidos são ignorados; slugs sem linha na RPC usam o fallback.
 * `null` (RPC falhou/vazia) devolve o fallback integral.
 */
export function mergeCatalogWithFallback(rows: PlanCatalogRow[] | null): Plan[] {
  if (!rows || rows.length === 0) return [...PLANS];
  const bySlug = new Map(rows.map((row) => [row.slug, row]));
  return PLANS.map((plan) => {
    const row = bySlug.get(plan.slug);
    if (!row) return plan;
    return { ...plan, price_cents: row.price_cents };
  });
}
