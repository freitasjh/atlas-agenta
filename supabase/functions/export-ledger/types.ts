// Tipos e constantes do export contábil (ADR-10, RF-36..38).
//
// Fronteira: a Edge fala só com dados já normalizados (`Movimento`,
// `FiscalDoc`, `BankLine`). Dinheiro trafega em `*_cents` inteiro; nenhum
// builder formata valor antes de dividir por 100 (nunca float acumulado).

export const FORMATOS = ["csv", "ofx", "sped"] as const;
export type Formato = (typeof FORMATOS)[number];

export const ESCOPOS = ["receber", "pagar", "fiscal"] as const;
export type Escopo = (typeof ESCOPOS)[number];

/** Linha de movimento do CSV/SPED (receita ou despesa). */
export interface Movimento {
  /** `YYYY-MM-DD` no fuso do tenant. */
  data: string;
  /** `receita_atendimento` | `receita_avulsa` | `despesa` | `fiscal`. */
  tipo: string;
  categoria: string;
  descricao: string;
  /** Forma de pagamento legível; vazio quando não se aplica. */
  metodo: string;
  valor_cents: number;
  /** Gorjeta da linha (informativa, FORA da receita — regra de domínio). */
  gorjeta_cents: number;
}

/** Documento fiscal do período. */
export interface FiscalDoc {
  id: string;
  numero: string | null;
  serie: string | null;
  chave_acesso: string | null;
  status: string;
  valor_cents: number;
  /** Data de referência no fuso do tenant (`authorized_at` ?? `created_at`). */
  data: string;
}

/** Linha conciliada do extrato bancário. */
export interface BankLine {
  id: string;
  /** `YYYY-MM-DD` (data de calendário do banco). */
  data: string;
  descricao: string;
  valor_cents: number;
}

export interface BankMeta {
  /** `true` quando o tenant tem mais de uma conta e o OFX é consolidado. */
  consolidado: boolean;
  banco: string;
  contaUltimos4: string;
}

export interface Payload {
  movimentos: Movimento[];
  fiscal: FiscalDoc[];
  bankLines: BankLine[];
  bankMeta: BankMeta | null;
  saldoAberturaCents: number;
  timeZone: string;
}

export const METODO_LABEL: Record<string, string> = {
  dinheiro: "Dinheiro",
  cartao_credito: "Cartão de crédito",
  cartao_debito: "Cartão de débito",
  pix_sistema: "PIX do sistema",
  pix_maquininha: "PIX da maquininha",
  pix: "PIX",
  transferencia: "Transferência",
};

export const FISCAL_STATUS_LABEL: Record<string, string> = {
  autorizada: "Autorizada",
  contingencia: "Contingência",
  cancelada: "Cancelada",
  rejeitada: "Rejeitada",
  pendente: "Pendente",
};
