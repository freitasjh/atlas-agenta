/**
 * Terminologia por ramo (ADR-05) — **fonte única de verdade** da linguagem que
 * a UI usa para falar com o tenant conforme o segmento de negócio. Peça pura e
 * determinística, mesmo padrão de `src/lib/plans.ts` e
 * `src/lib/message-templates.ts`: sem rede, sem estado, sem relógio.
 *
 * A fonte de verdade do **ramo** é o banco (`tenants.segment`, exposto pela
 * ADR-03 e lido sob RLS); a **tradução ramo→termos** é código versionado —
 * estática por ramo, não persistida por termo. O ramo que a app consome vem
 * SEMPRE de `tenants.segment` lido sob RLS, nunca do parâmetro de cadastro.
 *
 * A personalização é de **linguagem, não de cor/fonte** (zero token visual
 * novo). Os termos pt-BR são curtos e de largura semelhante entre ramos para
 * não causar _layout shift_ entre o genérico (durante o load do tenant) e o
 * específico.
 *
 * Gancho Fase 1b (NÃO implementar agora): `SegmentTerms` é o ponto de extensão
 * para novas chaves de termo quando os recursos de domínio de cada ramo
 * chegarem. Um futuro flag de recursos por ramo (ex.: "mostrar aba Comissão só
 * para barbearia") deve derivar de `tenant.segment` pelo mesmo caminho (um
 * `useSegmentFeatures` irmão de `useSegmentTerms`), NUNCA de um parâmetro do
 * cliente — mesma regra de fronteira do RLS.
 */

import type { BusinessSegment } from "@/types/domain";

/**
 * Vocabulário que a UI adapta por ramo. Chaves **semânticas** (não "a string da
 * tela"), curtas e de largura semelhante entre ramos. Só texto de rótulo —
 * nunca identificador, rota, `queryKey` ou nome de coluna.
 */
export interface SegmentTerms {
  /** Rótulo plural de "serviços" (ex.: "Serviços" / "Procedimentos"). */
  servicosLabel: string;
  /** Rótulo singular de "serviço" (ex.: "Serviço" / "Procedimento"). */
  servicoLabelSingular: string;
  /** Rótulo plural de "profissionais" (ex.: "Profissionais" / "Barbeiros"). */
  profissionaisLabel: string;
  /** Rótulo singular de "profissional" (ex.: "Profissional" / "Barbeiro"). */
  profissionalLabelSingular: string;
  /** Rótulo singular de "cliente" (ex.: "Cliente" / "Paciente"). */
  clienteLabel: string;
}

/**
 * Vocabulário base de hoje — o fallback genérico. Usado para tenant legado
 * (`segment` null) e para qualquer valor fora do enum. Mantém exatamente os
 * termos que o app já exibia antes desta fatia.
 */
export const GENERIC_TERMS: SegmentTerms = {
  servicosLabel: "Serviços",
  servicoLabelSingular: "Serviço",
  profissionaisLabel: "Profissionais",
  profissionalLabelSingular: "Profissional",
  clienteLabel: "Cliente",
};

/**
 * Redação de cada ramo. Termos curtos, pt-BR, de largura semelhante ao genérico
 * para não quebrar sidebar/badges nem causar _layout shift_.
 */
export const SEGMENT_TERMS: Record<BusinessSegment, SegmentTerms> = {
  barbearia: {
    servicosLabel: "Serviços",
    servicoLabelSingular: "Serviço",
    profissionaisLabel: "Barbeiros",
    profissionalLabelSingular: "Barbeiro",
    clienteLabel: "Cliente",
  },
  clinica: {
    servicosLabel: "Procedimentos",
    servicoLabelSingular: "Procedimento",
    profissionaisLabel: "Equipe clínica",
    profissionalLabelSingular: "Profissional",
    clienteLabel: "Paciente",
  },
  salao: {
    servicosLabel: "Procedimentos",
    servicoLabelSingular: "Procedimento",
    profissionaisLabel: "Equipe",
    profissionalLabelSingular: "Profissional",
    clienteLabel: "Cliente",
  },
};

/**
 * Um serviço do catálogo-semente de um ramo (ADR-06): nome pt-BR, duração em
 * minutos e preço **sugerido** em centavos inteiros (nunca float). Espelha os
 * campos que `useCreateService`/`serviceSchema` já exigem (`name`,
 * `durationMinutes`, `priceCents`), menos `active` (semeado sempre ativo).
 *
 * São só valores de partida: o admin edita/inativa pelo fluxo normal de
 * `services` depois. Nada trava por serem "de seed".
 */
export interface SeedService {
  /** Rótulo pt-BR curto do serviço (1–120 chars, igual ao CHECK do banco). */
  name: string;
  /** Duração em minutos, inteiro positivo. */
  durationMinutes: number;
  /** Preço sugerido em centavos inteiros (BRL). */
  priceCents: number;
}

/**
 * Catálogo-semente por ramo (ADR-06 / RF-10). Dado puro, versionado: no
 * primeiro acesso de um tenant **sem nenhum serviço** e com `segment`
 * conhecido, o onboarding aplica esta lista via as mutations normais de
 * `services` (sob `services_write_admin`, `tenant_id` derivado de
 * `current_tenant_id()` — o cliente nunca envia `tenant_id`).
 *
 * **Sem entrada para `segment=null`/legado**: tenant sem ramo não recebe seed e
 * cai no estado vazio honesto da `ServicosPage` (fail-safe). `segment` é
 * discriminador de produto/UX, **nunca** fronteira de isolamento — o RLS é que
 * garante que um tenant jamais veja/escreva os serviços de outro.
 *
 * Gancho Fase 1b (NÃO implementar agora): trocar de ramo depois do cadastro
 * **não** re-semeia este catálogo — o seed roda só no onboarding (lista vazia).
 */
export const SEGMENT_SEED_SERVICES: Record<
  BusinessSegment,
  readonly SeedService[]
> = {
  barbearia: [
    { name: "Corte de cabelo", durationMinutes: 30, priceCents: 4500 },
    { name: "Barba", durationMinutes: 20, priceCents: 3000 },
    { name: "Corte e barba", durationMinutes: 45, priceCents: 6500 },
  ],
  clinica: [
    { name: "Consulta", durationMinutes: 50, priceCents: 20000 },
    { name: "Retorno", durationMinutes: 30, priceCents: 10000 },
    { name: "Avaliação inicial", durationMinutes: 60, priceCents: 25000 },
  ],
  salao: [
    { name: "Corte", durationMinutes: 45, priceCents: 7000 },
    { name: "Escova", durationMinutes: 40, priceCents: 6000 },
    { name: "Coloração", durationMinutes: 90, priceCents: 15000 },
  ],
};

/** Conjunto dos ramos conhecidos, para checagem O(1) de pertencimento. */
const KNOWN_SEGMENTS = new Set<string>(Object.keys(SEGMENT_TERMS));

/**
 * Resolve os termos de um ramo. Devolve `SEGMENT_TERMS[segment]` para ramo
 * conhecido e `GENERIC_TERMS` para `null`/`undefined`/valor fora do enum.
 *
 * Função pura: **nunca lança, nunca devolve `undefined`, nunca string vazia** —
 * garante que a UI sempre tenha um termo, cobrindo tenant legado e qualquer
 * valor sujo que escape por algum caminho.
 */
export function resolveTerms(
  segment: BusinessSegment | null | undefined,
): SegmentTerms {
  if (segment != null && KNOWN_SEGMENTS.has(segment)) {
    return SEGMENT_TERMS[segment];
  }
  return GENERIC_TERMS;
}

/**
 * Resolve o catálogo-semente de um ramo (ADR-06). Devolve a lista do ramo
 * conhecido e uma lista **vazia** para `null`/`undefined`/valor fora do enum —
 * legado não recebe seed, caindo no estado vazio honesto.
 *
 * Função pura: nunca lança, nunca devolve `undefined`. Uma lista vazia é o
 * sinal honesto de "não semear", consumido pelo `useOnboardingSeed`.
 */
export function resolveSeedServices(
  segment: BusinessSegment | null | undefined,
): readonly SeedService[] {
  if (segment != null && KNOWN_SEGMENTS.has(segment)) {
    return SEGMENT_SEED_SERVICES[segment];
  }
  return [];
}
