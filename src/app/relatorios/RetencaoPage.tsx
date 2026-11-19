import { useEffect, useMemo, useState } from "react";

import { PageHeader } from "@/components/PageHeader";
import { StatePanel } from "@/components/StatePanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  formatRate,
  useRetencaoReport,
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
 * Retenção e no-show (`/app/relatorios/retencao`, ADR-17). Admin only (o guard
 * de rota já barra não-admin; aqui o estado neutro sem request).
 * Rebooking + no-show por profissional/serviço (barras + tabela) e retenção
 * por coorte (tabela). Export CSV client-side a partir do JSON da RPC.
 */
export function RetencaoPage() {
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
  const reportQuery = useRetencaoReport(filter);

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
          titulo="Retenção e no-show"
          descricao="Quem volta, quem falta e quem fica."
        />
        <StatePanel
          titulo="Acesso indisponível"
          descricao="Você não tem acesso a este relatório."
        />
      </div>
    );
  }

  const rebooking = reportQuery.data?.rebooking ?? [];
  const noshow = reportQuery.data?.noshow ?? [];
  const cohorts = reportQuery.data?.cohorts ?? [];
  const periodLabel = `${formatShortDate(start)} – ${formatShortDate(end)}`;

  function handleExport(kind: "rebooking" | "noshow" | "coortes") {
    const stamp = `${start}_a_${end}`;
    if (kind === "coortes") {
      downloadCsv(
        `retencao-coortes-${stamp}.csv`,
        buildCsv(cohorts, [
          { header: "Coorte", value: (row) => row.cohort },
          { header: "Clientes", value: (row) => row.cohort_size },
          { header: "Retidos", value: (row) => row.retained_count },
          {
            header: "Retenção %",
            value: (row) =>
              row.retention_rate === null
                ? "—"
                : (row.retention_rate * 100).toFixed(1).replace(".", ","),
          },
        ]),
      );
      return;
    }
    const rows = kind === "rebooking" ? rebooking : noshow;
    downloadCsv(
      `retencao-${kind}-${stamp}.csv`,
      buildCsv(rows, [
        { header: "Grupo", value: (row) => row.label },
        { header: "Taxa %", value: (row) => (row.rate === null ? "—" : (row.rate * 100).toFixed(1).replace(".", ",")) },
        { header: "Numerador", value: (row) => row.numerator },
        { header: "Denominador", value: (row) => row.denominator },
      ]),
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Retenção e no-show"
        descricao="Quem volta, quem falta e quem fica por coorte."
      />

      <p className="text-sm text-muted-foreground tabular-nums">
        Período: {periodLabel}
      </p>

      <RetentionFilters
        idPrefix="retencao"
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
      ) : rebooking.length === 0 && noshow.length === 0 && cohorts.length === 0 ? (
        <StatePanel
          titulo="Sem dados neste período"
          descricao="Ajuste o período ou os filtros para ver as taxas."
        />
      ) : (
        <div className="space-y-8">
          <section aria-labelledby="retencao-rebooking-titulo" className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="retencao-rebooking-titulo" className="font-display text-lg font-semibold tracking-tight">
                Rebooking no período
              </h2>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleExport("rebooking")}
                disabled={rebooking.length === 0}
              >
                <Download className="mr-2 h-4 w-4" aria-hidden="true" />
                Exportar CSV
              </Button>
            </div>
            {rebooking.length === 0 ? (
              <StatePanel
                titulo="Sem dados de rebooking"
                descricao="Nenhum grupo com movimento neste período."
              />
            ) : (
              <>
                <RetentionChart
                  data={rebooking.map((row) => ({ label: row.label, rate: row.rate }))}
                  ariaLabel={`Rebooking no período ${periodLabel}`}
                />
                <div className="overflow-x-auto rounded-lg border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Grupo</TableHead>
                        <TableHead className="text-right">Taxa</TableHead>
                        <TableHead className="text-right">Clientes que voltaram</TableHead>
                        <TableHead className="text-right">Clientes ativos</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rebooking.map((row) => (
                        <TableRow key={row.key}>
                          <TableCell className="font-medium">{row.label}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatRate(row.rate)}</TableCell>
                          <TableCell className="text-right tabular-nums">{row.numerator}</TableCell>
                          <TableCell className="text-right tabular-nums">{row.denominator}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </section>

          <section aria-labelledby="retencao-noshow-titulo" className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="retencao-noshow-titulo" className="font-display text-lg font-semibold tracking-tight">
                No-show no período
              </h2>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleExport("noshow")}
                disabled={noshow.length === 0}
              >
                <Download className="mr-2 h-4 w-4" aria-hidden="true" />
                Exportar CSV
              </Button>
            </div>
            {noshow.length === 0 ? (
              <StatePanel
                titulo="Sem dados de no-show"
                descricao="Nenhum grupo com movimento neste período."
              />
            ) : (
              <>
                <RetentionChart
                  data={noshow.map((row) => ({ label: row.label, rate: row.rate }))}
                  ariaLabel={`No-show no período ${periodLabel}`}
                />
                <div className="overflow-x-auto rounded-lg border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Grupo</TableHead>
                        <TableHead className="text-right">Taxa</TableHead>
                        <TableHead className="text-right">Faltas</TableHead>
                        <TableHead className="text-right">Agendamentos</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {noshow.map((row) => (
                        <TableRow key={row.key}>
                          <TableCell className="font-medium">{row.label}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatRate(row.rate)}</TableCell>
                          <TableCell className="text-right tabular-nums">{row.numerator}</TableCell>
                          <TableCell className="text-right tabular-nums">{row.denominator}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </section>

          <section aria-labelledby="retencao-coorte-titulo" className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="retencao-coorte-titulo" className="font-display text-lg font-semibold tracking-tight">
                Retenção da coorte
              </h2>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleExport("coortes")}
                disabled={cohorts.length === 0}
              >
                <Download className="mr-2 h-4 w-4" aria-hidden="true" />
                Exportar CSV
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Coorte do mês inicial do período (mês da primeira visita concluída);
              janela única de 90 dias.
            </p>
            {cohorts.length === 0 ? (
              <StatePanel
                titulo="Sem coortes neste período"
                descricao="Ajuste o período para ver a retenção por coorte."
              />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {cohorts.map((row) => (
                  <Card key={row.cohort} role="group" aria-label={`Coorte ${row.cohort}: ${formatRate(row.retention_rate)}`}>
                    <CardContent className="space-y-1 p-5">
                      <p className="text-sm font-medium text-muted-foreground">
                        Coorte {row.cohort}
                      </p>
                      <p className="font-display text-3xl font-semibold tabular-nums tracking-tight text-foreground">
                        {formatRate(row.retention_rate)}
                      </p>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {row.retained_count} de {row.cohort_size} clientes retidos
                      </p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
