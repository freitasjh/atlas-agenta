import { useMemo } from "react";
import { ChevronLeft, ChevronRight, Info } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { WEEKDAYS } from "@/types/domain";
import type {
  DayGrade,
  DayGradeStatus,
} from "@/app/config/profissionais/horarios/deriveMonthlyGrade";

/** Ordem de exibição seg→dom (mesma da grade semanal). */
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

/**
 * Posição (0–6) de um weekday (`getUTCDay`, 0=dom) na ordem seg→dom.
 * `(wd + 6) % 7`: dom(0)→6, seg(1)→0, …, sáb(6)→5.
 */
function columnIndexOf(weekday: number): number {
  return (weekday + 6) % 7;
}

export interface MonthlyGradeViewProps {
  /** Grade derivada do mês (`deriveMonthlyGrade`). */
  days: DayGrade[];
  /** Mês exibido `YYYY-MM`. */
  month: string;
  /** Vigência legível (ex.: "Sem início · sem término"). */
  validityLabel: string;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  /** Contagem opcional de appointments ativos por data `YYYY-MM-DD`. */
  appointmentCounts?: Map<string, number>;
  /** Dia clicável (só quando editável) — abre o Dialog de exceção. */
  onDayClick?: (date: string) => void;
  /** Leitura (recepção/outro profissional/assinatura bloqueada): dia não clicável. */
  readOnly: boolean;
  onMonthChange: (month: string) => void;
}

const STATUS_LABEL: Record<DayGradeStatus, string> = {
  "fora-vigencia": "Fora da vigência",
  folga: "FOLGA",
  atipico: "ATÍPICO",
  grade: "GRADE",
  livre: "LIVRE",
};

const STATUS_VARIANT: Record<
  DayGradeStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  "fora-vigencia": "outline",
  folga: "destructive",
  atipico: "secondary",
  grade: "default",
  livre: "outline",
};

function shortWeekday(weekday: number): string {
  return WEEKDAYS.find((day) => day.value === weekday)?.label.slice(0, 3) ?? "";
}

function formatDayWithWeekday(day: DayGrade): string {
  const label =
    WEEKDAYS.find((item) => item.value === day.weekday)?.label ?? "";
  const [year, month, date] = day.date.split("-");
  const data = `${date}/${month}/${year}`;
  if (day.status === "grade") {
    const windows = day.windows
      .map((w) => `${w.startTime}–${w.endTime}`)
      .join(", ");
    return `${label}, ${data}: atendimento ${windows}`;
  }
  if (day.status === "atipico") {
    const window = day.windows[0];
    return `${label}, ${data}: horário atípico ${window ? `${window.startTime}–${window.endTime}` : ""}`;
  }
  if (day.status === "folga") return `${label}, ${data}: folga, sem atendimento`;
  if (day.status === "fora-vigencia")
    return `${label}, ${data}: fora da vigência`;
  return `${label}, ${data}: dia livre, sem grade`;
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1 + delta, 1));
  const yy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${yy}-${mm}`;
}

function monthTitle(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const names = [
    "Janeiro",
    "Fevereiro",
    "Março",
    "Abril",
    "Maio",
    "Junho",
    "Julho",
    "Agosto",
    "Setembro",
    "Outubro",
    "Novembro",
    "Dezembro",
  ];
  return `${names[m - 1]} de ${y}`;
}

/**
 * Calendário mensal read-only da grade resolvida (FE-03): vigência →
 * exceção → grade, com badge textual + cor (nunca só cor), legenda,
 * navegação de mês e alvo ≥44px no mobile (setas). Nenhuma célula edita a
 * grade — o único caminho de exceção é o Dialog aberto do dia (FE-04), com
 * label claro. Texto e aria-labels em pt-BR; horários em `tabular-nums`.
 */
export function MonthlyGradeView({
  days,
  month,
  validityLabel,
  isLoading = false,
  isError = false,
  onRetry,
  appointmentCounts,
  onDayClick,
  readOnly,
  onMonthChange,
}: MonthlyGradeViewProps) {
  const ordered = useMemo(
    () => [...days].sort((a, b) => a.date.localeCompare(b.date)),
    [days],
  );

  const prevMonth = shiftMonth(month, -1);
  const nextMonth = shiftMonth(month, 1);

  // Colunas do cabeçalho seg→dom (ícones curtos pt-BR).
  const headers = DISPLAY_ORDER.map((index) => WEEKDAYS[index]);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-base">
              Calendário mensal — {monthTitle(month)}
            </CardTitle>
            <CardDescription>
              Vigência: {validityLabel}. Grade resolvida por dia (leitura).
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-11 w-11"
              onClick={() => onMonthChange(prevMonth)}
              aria-label={`Mês anterior: ${monthTitle(prevMonth)}`}
            >
              <ChevronLeft aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-11 w-11"
              onClick={() => onMonthChange(nextMonth)}
              aria-label={`Próximo mês: ${monthTitle(nextMonth)}`}
            >
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
        </div>
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <li>
            <Badge variant="default" className="mr-1">GRADE</Badge>
            grade semanal do dia
          </li>
          <li>
            <Badge variant="secondary" className="mr-1">ATÍPICO</Badge>
            exceção com janela própria
          </li>
          <li>
            <Badge variant="destructive" className="mr-1">FOLGA</Badge>
            sem atendimento
          </li>
          <li>
            <Badge variant="outline" className="mr-1">LIVRE</Badge>
            sem grade no dia
          </li>
          <li>
            <Badge variant="outline" className="mr-1">Fora da vigência</Badge>
            fora do período de atendimento
          </li>
        </ul>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2" aria-busy="true" aria-label="Carregando calendário mensal">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : isError ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center">
            <p className="text-sm text-muted-foreground">
              Não foi possível carregar o calendário.
            </p>
            {onRetry ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3 min-h-[44px]"
                onClick={onRetry}
              >
                Tentar novamente
              </Button>
            ) : null}
          </div>
        ) : ordered.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center">
            <p className="text-sm text-muted-foreground">
              Nenhum dia para exibir neste mês.
            </p>
          </div>
        ) : (
          <>
            <p className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
              <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {readOnly
                ? "Toque num dia apenas para consultar a exceção — a grade é só leitura."
                : "Toque num dia para registrar folga ou horário atípico."}
            </p>
            <div
              role="group"
              aria-label={`Grade mensal de ${monthTitle(month)}`}
            >
              <div
                aria-hidden="true"
                className="grid grid-cols-7 gap-1.5 pb-1"
              >
                {headers.map((day) => (
                  <span
                    key={day.value}
                    className="px-1 text-center text-xs font-medium text-muted-foreground"
                  >
                    {shortWeekday(day.value)}
                  </span>
                ))}
              </div>
              <ul className="grid grid-cols-7 gap-1.5">
                {Array.from({ length: ordered.length ? columnIndexOf(ordered[0]!.weekday) : 0 }).map(
                  (_, index) => (
                    <li key={`blank-${index}`} data-blank-cell aria-hidden="true" />
                  ),
                )}
                {ordered.map((day) => {
                  const ariaLabel = formatDayWithWeekday(day);
                  const count = appointmentCounts?.get(day.date);
                  const inner = (
                    <>
                      <span className="block text-xs tabular-nums text-muted-foreground">
                        {day.date.slice(8, 10)}
                      </span>
                      <Badge
                        variant={STATUS_VARIANT[day.status]}
                        className="mt-1 w-full justify-center"
                      >
                        {STATUS_LABEL[day.status]}
                      </Badge>
                      <span className="mt-1 block text-[11px] tabular-nums">
                        {day.status === "grade"
                          ? day.windows.map((w) => `${w.startTime}–${w.endTime}`).join(", ")
                          : day.status === "atipico" && day.windows[0]
                            ? `${day.windows[0].startTime}–${day.windows[0].endTime}`
                            : day.status === "folga"
                              ? "Sem atendimento"
                              : "—"}
                      </span>
                      {count ? (
                        <span className="mt-1 block text-[11px] tabular-nums text-muted-foreground">
                          {count} {count === 1 ? "agendamento" : "agendamentos"}
                        </span>
                      ) : null}
                    </>
                  );
                  const cellClass =
                    "flex min-h-[44px] flex-col items-stretch rounded-md border border-border p-1.5 text-left";
                  if (readOnly) {
                    return (
                      <li
                        key={day.date}
                        data-day-cell
                        aria-label={ariaLabel}
                        className={cellClass}
                      >
                        <span aria-hidden="true" className="contents">
                          {inner}
                        </span>
                      </li>
                    );
                  }
                  return (
                    <li key={day.date} data-day-cell>
                      <button
                        type="button"
                        aria-label={`${ariaLabel}. Registrar exceção neste dia.`}
                        className={`${cellClass} h-full w-full transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
                        onClick={() => onDayClick?.(day.date)}
                      >
                        <span aria-hidden="true" className="contents">
                          {inner}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
