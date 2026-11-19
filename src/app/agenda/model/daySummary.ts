import type { AppointmentWithRelations } from "@/types/domain";

/**
 * Resumo do dia da agenda (ADR-01).
 *
 * Camada pura: opera sobre a lista já buscada (nenhuma chamada, RLS intacta).
 * Dinheiro em centavos inteiros; `null` só em `ocupacaoPct` (sem capacidade).
 */
export interface DaySummary {
  ocupacaoPct: number | null;
  horariosOcupados: number;
  capacidade: number | null;
  previstoCents: number;
  numAtendimentos: number;
  aConfirmar: number;
  riscoNoShow: number;
}

/**
 * Entrada mínima que `computeDaySummary` lê. Compatível com
 * `AppointmentWithRelations` (passar a linha cheia funciona); `price_cents`
 * aceita `null` defensivo (banco legado) e é tratado como 0.
 */
export type DaySummaryInput = Omit<
  Pick<
    AppointmentWithRelations,
    "id" | "status" | "professional_id" | "price_cents" | "customers"
  >,
  "price_cents"
> & {
  price_cents: number | null;
};

export interface DaySummaryOptions {
  /**
   * Janela de 7 dias já filtrada pelo chamador (sem relógio aqui).
   * Só linhas com `status === "nao_compareceu"` contam.
   */
  history?: DaySummaryInput[];
  /** Quando informado, o histórico conta só o mesmo profissional. */
  professionalId?: string;
}

/**
 * Risco no-show — fórmula simples fixada pelo fundador (Q1, ADR-01):
 * `count(nao_compareceu 7d [, mesmo profissional]) + count(sem opt-in no dia)`.
 * `customers === null` ou `whatsapp_opt_in === false` conta como sem opt-in
 * (sem canal de confirmação D-1). Sem ML, sem peso, sem relógio.
 */
export function computeDaySummary(
  appts: DaySummaryInput[],
  capacidade: number | null | undefined,
  opts: DaySummaryOptions = {},
): DaySummary {
  const validos = appts.filter((a) => a.status !== "cancelado");

  const horariosOcupados = validos.length;

  const cap =
    typeof capacidade === "number" && Number.isFinite(capacidade) && capacidade > 0
      ? capacidade
      : null;
  const ocupacaoPct =
    cap === null ? null : Math.round((horariosOcupados / cap) * 100);

  let previstoCents = 0;
  for (const a of validos) {
    previstoCents += typeof a.price_cents === "number" ? a.price_cents : 0;
  }

  let aConfirmar = 0;
  let semOptIn = 0;
  for (const a of validos) {
    if (a.status === "pendente") aConfirmar += 1;
    if (a.customers === null || a.customers.whatsapp_opt_in === false) {
      semOptIn += 1;
    }
  }

  const history = opts.history ?? [];
  let noShowHistorico = 0;
  for (const h of history) {
    if (h.status !== "nao_compareceu") continue;
    if (
      opts.professionalId !== undefined &&
      h.professional_id !== opts.professionalId
    ) {
      continue;
    }
    noShowHistorico += 1;
  }

  return {
    ocupacaoPct,
    horariosOcupados,
    capacidade: cap,
    previstoCents,
    numAtendimentos: validos.length,
    aConfirmar,
    riscoNoShow: semOptIn + noShowHistorico,
  };
}
