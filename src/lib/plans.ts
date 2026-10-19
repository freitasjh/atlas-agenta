/**
 * Planos do Atlas Agenda — **fonte única de verdade** apresentacional (ADR-13).
 *
 * Usado por `/precos` (gerar o CTA com o slug do plano) e por `/cadastro`
 * (validar o `?plano` e exibir o rótulo da intenção escolhida). O plano é
 * **conceito de marketing nesta fase**: não é persistido, não alimenta query
 * nem escrita, e o tenant continua nascendo em `trial`. Billing/checkout e o
 * uso efetivo da coluna `tenants.plan` são Fase 3.
 *
 * `?plano` é a **única superfície de entrada não confiável** da tarefa:
 * `parsePlanSlug` é o ponto único de validação contra o enum conhecido. O valor
 * cru nunca deve ser interpolado no DOM — só o rótulo pt-BR obtido por lookup.
 *
 * Decisão de fronteira: `PlanSlug` não vive em `src/types/domain.ts` (reservado
 * a enums de domínio persistidos); plano não é persistido nesta fase.
 */

/** Slugs em ASCII usados na URL (`?plano=...`). `clinica` sem acento. */
export const PLAN_SLUGS = ["individual", "clinica", "pro"] as const;

export type PlanSlug = (typeof PLAN_SLUGS)[number];

export interface Plan {
  slug: PlanSlug;
  /** Rótulo exibido em pt-BR (pode ter acento: `Clínica`). */
  nome: string;
  /** Público-alvo do plano, em pt-BR. */
  publico: string;
  /** Destaques do plano, em pt-BR. */
  destaques: readonly string[];
  /** `true` apenas no plano recomendado (ancoragem de pricing). */
  recomendado?: boolean;
}

/**
 * Catálogo na ordem Individual → Clínica → Pro. Conteúdo reaproveitado do
 * `const PLANOS` que vivia em `src/marketing/pages.tsx`. Só `clinica` é
 * recomendado.
 */
export const PLANS: readonly Plan[] = [
  {
    slug: "individual",
    nome: "Individual",
    publico: "Autônomo",
    destaques: [
      "1 profissional",
      "Até 150 agendamentos por mês",
      "Régua de mensagens padrão",
    ],
  },
  {
    slug: "clinica",
    nome: "Clínica",
    publico: "Equipe",
    destaques: [
      "Até 5 profissionais",
      "Agendamentos ilimitados",
      "Mensagens personalizadas e taxa de reserva configurável",
    ],
    recomendado: true,
  },
  {
    slug: "pro",
    nome: "Pro",
    publico: "Multi-profissionais",
    destaques: [
      "Mais de 5 profissionais (adicional por extra)",
      "Relatórios",
      "Suporte prioritário",
    ],
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
