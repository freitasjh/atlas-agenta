import * as React from "react";

import { Card, CardContent } from "@/components/ui/card";
import { StatePanel } from "@/components/StatePanel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatCentsToBRL } from "@/lib/money";
import type { MaskedDaySummary } from "@/app/agenda/model/financialMask";

interface MetricCardProps {
  rotulo: string;
  valor: string;
  apoio: string;
  ariaPressed?: boolean;
  onSelect: () => void;
}

/**
 * KPI clicável (arquétipo D do guia: Card com `role="button"`, teclado
 * Enter/Espaço, anel de foco visível). Valor em `font-display tabular-nums`.
 */
function MetricCard({ rotulo, valor, apoio, ariaPressed, onSelect }: MetricCardProps) {
  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect();
    }
  }

  return (
    <Card
      role="button"
      tabIndex={0}
      aria-label={`${rotulo}: ${valor}. ${apoio}`}
      aria-pressed={ariaPressed}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
      className={cn(
        "cursor-pointer transition-all duration-200 hover:shadow-md",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        ariaPressed
          ? "border-primary bg-primary/5 ring-1 ring-primary"
          : "border-border hover:border-primary/40",
      )}
    >
      <CardContent className="space-y-2 p-5">
        <p className="text-sm font-medium text-muted-foreground">{rotulo}</p>
        <p
          aria-hidden="true"
          className="break-words font-display text-2xl font-semibold tabular-nums tracking-tight text-foreground sm:text-3xl"
        >
          {valor}
        </p>
        <p aria-hidden="true" className="text-xs text-muted-foreground">
          {apoio}
        </p>
      </CardContent>
    </Card>
  );
}

export interface ResumoDoDiaProps {
  /** `null` enquanto carrega (com `isLoading`) ou quando não há dados. */
  summary: MaskedDaySummary | null;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  /** Ocupação + Previsto: voltam para "todos" (limpam o filtro de status). */
  onSelectTodos: () => void;
  /** A confirmar + Risco: filtram `status=pendente` (o acionável do dia). */
  onSelectAConfirmar: () => void;
  aConfirmarAtivo: boolean;
}

/**
 * Resumo do dia da agenda (ADR-02): 4 MetricCards clicáveis sobre o
 * `computeDaySummary` da ADR-01 já mascarado por papel (`previstoCents=null`
 * para receptionist → "—", sem nenhum "R$" no DOM).
 */
export function ResumoDoDia({
  summary,
  isLoading,
  isError,
  onRetry,
  onSelectTodos,
  onSelectAConfirmar,
  aConfirmarAtivo,
}: ResumoDoDiaProps) {
  if (isLoading || summary === null) {
    if (!isLoading && !isError) return null;
    if (isError && !isLoading) {
      return (
        <StatePanel
          titulo="Não foi possível carregar o resumo do dia"
          descricao="Verifique sua conexão e tente novamente."
        >
          <Button variant="outline" onClick={onRetry}>
            Tentar novamente
          </Button>
        </StatePanel>
      );
    }
    return (
      <div
        data-testid="resumo-do-dia-loading"
        aria-busy="true"
        aria-label="Carregando resumo do dia"
        className="grid grid-cols-2 gap-3 lg:grid-cols-4"
      >
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-[118px] w-full" />
        ))}
      </div>
    );
  }

  const ocupacaoValor =
    summary.ocupacaoPct === null ? `${summary.horariosOcupados}` : `${summary.ocupacaoPct}%`;
  const ocupacaoApoio =
    summary.capacidade === null
      ? `${summary.horariosOcupados === 1 ? "1 agendado" : `${summary.horariosOcupados} agendados`}`
      : `${summary.horariosOcupados} de ${summary.capacidade} horários`;

  return (
    <section aria-label="Resumo do dia" data-testid="resumo-do-dia">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          rotulo="Ocupação"
          valor={ocupacaoValor}
          apoio={ocupacaoApoio}
          onSelect={onSelectTodos}
        />
        <MetricCard
          rotulo="Previsto"
          valor={summary.previstoCents === null ? "—" : formatCentsToBRL(summary.previstoCents)}
          apoio={
            summary.numAtendimentos === 1 ? "1 atendimento" : `${summary.numAtendimentos} atendimentos`
          }
          onSelect={onSelectTodos}
        />
        <MetricCard
          rotulo="A confirmar"
          valor={`${summary.aConfirmar}`}
          apoio={
            summary.aConfirmar === 1
              ? "1 agendamento pendente"
              : `${summary.aConfirmar} agendamentos pendentes`
          }
          ariaPressed={aConfirmarAtivo}
          onSelect={onSelectAConfirmar}
        />
        <MetricCard
          rotulo="Risco no-show"
          valor={`${summary.riscoNoShow}`}
          apoio="Sem opt-in + faltas 7d"
          ariaPressed={aConfirmarAtivo}
          onSelect={onSelectAConfirmar}
        />
      </div>
    </section>
  );
}
