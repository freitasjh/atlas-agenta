import { useEffect, useMemo, useState } from "react";

import { PageHeader } from "@/components/PageHeader";
import { StatePanel } from "@/components/StatePanel";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePermissions } from "@/hooks/usePermissions";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useTicketReport } from "@/hooks/useRetentionReports";
import { buildCsv, downloadCsv } from "@/lib/retention-csv";
import { formatCentsToBRL } from "@/lib/money";
import { RetentionFilters } from "@/app/relatorios/RetentionFilters";
import { RetentionChart } from "@/app/relatorios/RetentionChart";
import type { PeriodPreset } from "@/app/relatorios/PeriodFilter";
import {
  formatShortDate,
  resolvePresetRange,
  todayIsoInTenantTz,
} from "@/app/relatorios/retention-period";
import { Download } from "lucide-react";

/**
 * Ticket médio (`/app/relatorios/ticket`, ADR-17). Admin only (financeiro).
 * Soma ÷ atendimentos concluídos por profissional/serviço, com barras +
 * tabela acessível e export CSV client-side. Centavos inteiros, nunca float.
 */
export function TicketPage() {
  const { tenant } = useCurrentUser();
  const timeZone = tenant?.timezone ?? "America/Sao_Paulo";
  const { isAdmin } = usePermissions();

  const [preset, setPreset] = useState<PeriodPreset>("mes");
  const today = todayIsoInTenantTz(timeZone);
  const initialRange = useMemo(() => resolvePresetRange("mes", today), [today]);
  const [start, setStart] = useState(initialRange.start);
  const [end, setEnd] = useState(initialRange.end);
  const [professionalId, setProfessionalId] = useState("todos");
  const [serviceId, setServiceId] = useState("todos");

  useEffect(() => {
    if (preset === "personalizado") return;
    const range = resolvePresetRange(preset, today);
    setStart(range.start);
    setEnd(range.end);
  }, [preset, today]);

  const filter = {
    startDate: start,
    endDate: end,
    professionalId: professionalId === "todos" ? null : professionalId,
    serviceId: serviceId === "todos" ? null : serviceId,
  };
  const reportQuery = useTicketReport(filter);

  function handlePresetChange(next: PeriodPreset) {
    if (next === "personalizado") {
      const unchanged = next === preset;
      setPreset(next);
      if (unchanged) void reportQuery.refetch();
      return;
    }
    const range = resolvePresetRange(next, today);
    const unchanged =
      next === preset && range.start === start && range.end === end;
    setStart(range.start);
    setEnd(range.end);
    setPreset(next);
    if (unchanged) void reportQuery.refetch();
  }

  if (!isAdmin) {
    return (
      <div className="space-y-6">
        <PageHeader
          titulo="Ticket médio"
          descricao="Valor médio por atendimento concluído."
        />
        <StatePanel
          titulo="Acesso indisponível"
          descricao="Você não tem acesso a este relatório."
        />
      </div>
    );
  }

  const rows = reportQuery.data ?? [];
  const periodLabel = `${formatShortDate(start)} – ${formatShortDate(end)}`;
  const maxCents = rows.reduce(
    (max, row) => Math.max(max, row.ticket_medio_cents ?? 0),
    0,
  );

  function handleExport() {
    downloadCsv(
      `ticket-medio-${start}_a_${end}.csv`,
      buildCsv(rows, [
        { header: "Grupo", value: (row) => row.label },
        {
          header: "Ticket médio (R$)",
          value: (row) =>
            row.ticket_medio_cents === null
              ? "—"
              : (row.ticket_medio_cents / 100).toFixed(2).replace(".", ","),
        },
        { header: "Atendimentos", value: (row) => row.appointment_count },
        {
          header: "Total (R$)",
          value: (row) => (row.total_cents / 100).toFixed(2).replace(".", ","),
        },
      ]),
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Ticket médio"
        descricao="Receita por atendimento concluído, por grupo."
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground tabular-nums">
          Período: {periodLabel}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleExport}
          disabled={rows.length === 0}
        >
          <Download className="mr-2 h-4 w-4" aria-hidden="true" />
          Exportar CSV
        </Button>
      </div>

      <RetentionFilters
        idPrefix="ticket"
        preset={preset}
        start={start}
        end={end}
        onPresetChange={handlePresetChange}
        onStartChange={setStart}
        onEndChange={setEnd}
        professionalId={professionalId}
        onProfessionalChange={setProfessionalId}
        serviceId={serviceId}
        onServiceChange={setServiceId}
      />

      {reportQuery.isLoading ? (
        <div className="space-y-2" aria-busy="true" aria-label="Carregando relatório">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : reportQuery.isError ? (
        <StatePanel
          titulo="Não foi possível carregar o relatório"
          descricao="Verifique sua conexão e tente novamente."
        >
          <Button variant="outline" onClick={() => void reportQuery.refetch()}>
            Tentar novamente
          </Button>
        </StatePanel>
      ) : rows.length === 0 ? (
        <StatePanel
          titulo="Sem dados neste período"
          descricao="Ajuste o período ou os filtros para ver o ticket médio."
        />
      ) : (
        <>
          <RetentionChart
            data={rows.map((row) => ({
              label: row.label,
              rate: row.ticket_medio_cents,
            }))}
            unit="currency"
            ariaLabel={`Gráfico de ticket médio por grupo no período ${periodLabel}`}
          />
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Grupo</TableHead>
                  <TableHead className="text-right">Ticket médio</TableHead>
                  <TableHead className="text-right">Atendimentos</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell className="font-medium">{row.label}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.ticket_medio_cents === null
                        ? "—"
                        : formatCentsToBRL(row.ticket_medio_cents)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.appointment_count}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCentsToBRL(row.total_cents)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="sr-only" aria-live="polite">
            Maior ticket médio do período:{" "}
            {maxCents > 0 ? formatCentsToBRL(maxCents) : "—"}
          </p>
        </>
      )}
    </div>
  );
}
