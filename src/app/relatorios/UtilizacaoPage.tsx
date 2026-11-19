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
import { useProfessionals } from "@/hooks/useProfessionals";
import {
  formatRate,
  useUtilizacaoReport,
} from "@/hooks/useRetentionReports";
import { buildCsv, downloadCsv } from "@/lib/retention-csv";
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
 * Utilização de agenda (`/app/relatorios/utilizacao`, ADR-17). Admin only.
 * Minutos ocupados ÷ minutos disponíveis por profissional/serviço, com barras
 * + tabela acessível e export CSV client-side.
 */
export function UtilizacaoPage() {
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
  const reportQuery = useUtilizacaoReport(filter);
  const professionalsQuery = useProfessionals({ activeOnly: false });

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
          titulo="Utilização de agenda"
          descricao="Quanto da grade vira atendimento."
        />
        <StatePanel
          titulo="Acesso indisponível"
          descricao="Você não tem acesso a este relatório."
        />
      </div>
    );
  }

  const professionalNames = new Map(
    (professionalsQuery.data ?? []).map((professional) => [professional.id, professional.name]),
  );
  const rows = (reportQuery.data ?? []).map((row) => ({
    ...row,
    label: professionalNames.get(row.key) ?? row.label,
  }));
  const periodLabel = `${formatShortDate(start)} – ${formatShortDate(end)}`;

  function handleExport() {
    downloadCsv(
      `utilizacao-${start}_a_${end}.csv`,
      buildCsv(rows, [
        { header: "Grupo", value: (row) => row.label },
        {
          header: "Utilização %",
          value: (row) =>
            row.utilization_rate === null
              ? "—"
              : (row.utilization_rate * 100).toFixed(1).replace(".", ","),
        },
        { header: "Minutos ocupados", value: (row) => row.occupied_minutes },
        { header: "Minutos disponíveis", value: (row) => row.available_minutes },
      ]),
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Utilização de agenda"
        descricao="Minutos ocupados sobre minutos disponíveis da grade."
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
        idPrefix="utilizacao"
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
          descricao="Ajuste o período ou os filtros para ver a utilização."
        />
      ) : (
        <>
          <RetentionChart
            data={rows.map((row) => ({
              label: row.label,
              rate: row.utilization_rate,
            }))}
            ariaLabel={`Gráfico de utilização de agenda no período ${periodLabel}`}
          />
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Grupo</TableHead>
                  <TableHead className="text-right">Utilização</TableHead>
                  <TableHead className="text-right">Minutos ocupados</TableHead>
                  <TableHead className="text-right">Minutos disponíveis</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell className="font-medium">{row.label}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatRate(row.utilization_rate)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.occupied_minutes}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {row.available_minutes}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
