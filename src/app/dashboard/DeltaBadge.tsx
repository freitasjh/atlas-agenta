import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Comparativo de uma métrica vs. o período anterior. A direção é **semântica
 * por métrica** (analysis-frontend §2.2): a prop `melhorQuando` encoda se
 * "subir" ou "cair" é bom, de modo que a cor nunca segue a direção bruta. Para
 * a taxa de no-show, `melhorQuando="cai"` — queda de faltas é melhora.
 *
 * A cor **nunca** é o único sinal: a seta (ícone) + o sinal numérico (+/−) + o
 * rótulo textual ("melhora"/"piora"/"estável") carregam o significado. A seta é
 * `aria-hidden` e um `aria-label` em pt-BR verbaliza direção e magnitude.
 */

export type MelhorQuando = "sobe" | "cai";

interface DeltaBadgeProps {
  /**
   * Valor atual da métrica; `null` quando não há dado (ex.: taxa com
   * denominador 0, D5). Sem atual não há variação a mostrar — ausência de
   * dado não é regressão.
   */
  atual: number | null;
  /** Valor do período anterior; `null` quando não há base de comparação. */
  anterior: number | null;
  /** Qual direção representa melhora para esta métrica. */
  melhorQuando: MelhorQuando;
  /**
   * Formata a magnitude da variação (ex.: "3 p.p." para taxas, "2" para
   * contagens). Recebe o delta absoluto (sempre ≥ 0).
   */
  formatarMagnitude: (deltaAbsoluto: number) => string;
  className?: string;
}

type Direcao = "melhora" | "piora" | "estavel";

function classificar(
  atual: number,
  anterior: number,
  melhorQuando: MelhorQuando,
): Direcao {
  if (atual === anterior) return "estavel";
  const subiu = atual > anterior;
  const foiBom = melhorQuando === "sobe" ? subiu : !subiu;
  return foiBom ? "melhora" : "piora";
}

const DIRECAO_STYLE: Record<Direcao, string> = {
  // Reusa os tokens de status theme-aware (AA nos dois temas): melhora = jade
  // de "confirmado", piora = vermelho de "cancelado", estável = neutro.
  melhora: "bg-status-confirmado text-status-confirmado-foreground",
  piora: "bg-status-cancelado text-status-cancelado-foreground",
  estavel: "bg-muted text-muted-foreground",
};

const DIRECAO_LABEL: Record<Direcao, string> = {
  melhora: "melhora",
  piora: "piora",
  estavel: "estável",
};

export function DeltaBadge({
  atual,
  anterior,
  melhorQuando,
  formatarMagnitude,
  className,
}: DeltaBadgeProps) {
  // Sem dado atual (taxa com denominador 0, D5) ou sem base de comparação
  // anterior (D6): não há variação real a mostrar. Ramo neutro, sem seta nem
  // cor — ausência de dado nunca pode virar sinal falso de "piora" (RF-DASH-09,
  // AC-10), espelhando o `temDados` do HeroNoShowCard.
  if (atual === null || anterior === null) {
    // Sem atual: não dá para comparar nada ("Sem comparação"). Com atual mas
    // sem anterior: mostra o atual sem seta ("Sem período anterior", D6).
    const rotulo = atual === null ? "Sem comparação" : "Sem período anterior";
    return (
      <span
        className={cn(
          "inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground",
          className,
        )}
      >
        {rotulo}
      </span>
    );
  }

  const direcao = classificar(atual, anterior, melhorQuando);
  const deltaAbsoluto = Math.abs(atual - anterior);
  const magnitude = formatarMagnitude(deltaAbsoluto);
  const subiu = atual > anterior;

  const Icon =
    direcao === "estavel" ? Minus : subiu ? ArrowUpRight : ArrowDownRight;
  const sinal = direcao === "estavel" ? "" : subiu ? "+" : "−";

  const ariaLabel =
    direcao === "estavel"
      ? "Estável em relação ao período anterior"
      : `${DIRECAO_LABEL[direcao]} de ${magnitude} ${subiu ? "a mais" : "a menos"} que o período anterior`;

  return (
    <span
      aria-label={ariaLabel}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium tabular-nums",
        DIRECAO_STYLE[direcao],
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-3.5" />
      <span aria-hidden="true">
        {direcao === "estavel"
          ? DIRECAO_LABEL[direcao]
          : `${sinal}${magnitude} · ${DIRECAO_LABEL[direcao]}`}
      </span>
    </span>
  );
}
