/**
 * Recursos de domínio por ramo (ADR-05, Fase 1b) — **fonte única de verdade**
 * de quais features específicas de segmento a UI habilita. Peça pura e
 * determinística, irmã de `src/lib/segment-presets.ts`: sem rede, sem estado,
 * sem relógio.
 *
 * A fonte de verdade do **ramo** é o banco (`tenants.segment`, lido sob RLS); a
 * **tradução ramo→features** é código versionado. O ramo que a app consome vem
 * SEMPRE de `tenants.segment`, nunca de parâmetro do cliente — mesma regra de
 * fronteira do RLS.
 *
 * Importante (PRD §4): este gating é **só de UI/UX**. O banco NÃO trava
 * comissão por segmento — a trava real de acesso é o RLS por `tenant_id` /
 * `professional_id`. Tornar `segment` uma fronteira de segurança seria
 * anti-padrão e negaria acesso a tenant legado indevidamente.
 */

import type { BusinessSegment } from "@/types/domain";

/**
 * Flags de recursos de domínio derivados do ramo. Chaves semânticas; cada uma
 * liga/desliga a visibilidade de UI de um recurso específico de segmento.
 */
export interface SegmentFeatures {
  /**
   * Comissão por profissional (Fase 1b). Habilitada só para `barbearia`;
   * clínica, salão e legado (`null`) não veem nenhum ponto de entrada.
   */
  commission: boolean;
  /**
   * Pacotes/combos de serviços (Fase 1b). Habilitada só para `salao`;
   * barbearia, clínica e legado (`null`) não veem nenhum ponto de entrada.
   */
  combos: boolean;
}

/** Flags com tudo desligado — fallback para legado/valor sujo. */
const NO_FEATURES: SegmentFeatures = {
  commission: false,
  combos: false,
};

/**
 * Resolve as features de um ramo. Liga `commission` só para `barbearia` e
 * `combos` só para `salao`; para qualquer outro ramo conhecido,
 * `null`/`undefined` ou valor fora do enum, devolve tudo desligado.
 *
 * Função pura: **nunca lança, nunca devolve `undefined`** — a UI sempre recebe
 * um objeto de flags completo, cobrindo tenant legado e qualquer valor sujo.
 */
export function resolveFeatures(
  segment: BusinessSegment | null | undefined,
): SegmentFeatures {
  if (segment === "barbearia") {
    return { commission: true, combos: false };
  }
  if (segment === "salao") {
    return { commission: false, combos: true };
  }
  return NO_FEATURES;
}
