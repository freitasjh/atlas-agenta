import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { Download, TableProperties } from "lucide-react";
import { toast } from "sonner";

import {
  PeriodFilter,
  type PeriodPreset,
  type PeriodPresetOption,
} from "@/app/relatorios/PeriodFilter";
import { EntitlementGate } from "@/components/EntitlementGate";
import { PageHeader } from "@/components/PageHeader";
import { StatePanel } from "@/components/StatePanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCashflow30d, useDreReport, useLogDreExport } from "@/hooks/useDre";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { usePlanEntitlements } from "@/hooks/usePlanEntitlements";
import { useSegmentFeatures } from "@/hooks/useSegmentFeatures";
import { downloadCsv } from "@/lib/retention-csv";
import { resolvePresetRange, todayIsoInTenantTz } from "@/lib/period-presets";
import { formatCentsToBRL } from "@/lib/money";
import {
  DRE_REGIMES,
  DRE_REGIME_META,
  buildDreCsv,
  comAcumulado,
  diaLabel,
  dreCsvFileName,
  mesLabel,
  semMovimento,
  ultimosMeses,
  type Cashflow,
  type DreMes,
  type DreRegime,
  type DreReport,
} from "@/lib/dre";

/**
 * DRE + fluxo de caixa (`/app/financeiro/dre`, Fase 5 ADR-09).
 *
 * Admin-only pela rota (`RequireRole admin`) + RLS no banco. Dois portões na
 * própria página: segmento (`payments === true`, PRD §7) e entitlement
 * (`dreFluxo`). Qualquer um bloqueado → estado legível e **zero request**.
 *
 * Regime segmentado (Competência / Caixa) + período; o preset padrão é
 * "Últimos 6 meses" (a série do gráfico tem uma barra por mês do período).
 * Tabela DRE Receitas − Custos = Margem − Despesas = Resultado; linha de
 * acumulado e tabela alternativa acessível; fluxo de 30 dias com saldo
 * acumulado; export CSV com registro em `export_logs`.
 *
 * Os gráficos Recharts entram por `lazy` (peso) e são decorativos: cada um tem
 * uma tabela irmã com os mesmos números.
 */

const DRE_PRESETS: readonly PeriodPresetOption[] = [
  { value: "6m", label: "Últimos 6 meses" },
  { value: "mes", label: "Este mês" },
  { value: "mes-passado", label: "Mês passado" },
  { value: "personalizado", label: "Personalizado" },
];

const LazyDreMensalChart = lazy(() =>
  import("@/app/financeiro/dre/DreCharts").then((module) => ({
    default: module.DreMensalChart,
  })),
);

const LazyFluxoChart = lazy(() =>
  import("@/app/financeiro/dre/DreCharts").then((module) => ({
    default: module.FluxoChart,
  })),
);

function valor(cents: number): string {
  return formatCentsToBRL(cents);
}

function TabelaDre({ report }: { report: DreReport }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>DRE do período</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableCaption>
            {DRE_REGIME_META[report.regime].rotulo}: Receitas − Custos = Margem − Despesas =
            Resultado.
          </TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col">Linha</TableHead>
              <TableHead scope="col" className="text-right">
                Valor
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableHead scope="row" className="font-semibold">
                Receitas
              </TableHead>
              <TableCell className="text-right font-semibold tabular-nums">
                {valor(report.receitas.total_cents)}
              </TableCell>
            </TableRow>
            {report.receitas.grupos.map((grupo) => (
              <TableRow key={`receita-${grupo.categoria}`}>
                <TableCell className="pl-6 text-muted-foreground">{grupo.categoria}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {valor(grupo.valor_cents)}
                </TableCell>
              </TableRow>
            ))}

            <TableRow>
              <TableHead scope="row" className="font-semibold">
                Custos
              </TableHead>
              <TableCell className="text-right font-semibold tabular-nums text-destructive">
                −{valor(report.custos.total_cents)}
              </TableCell>
            </TableRow>
            {report.custos.grupos.map((grupo) => (
              <TableRow key={`custo-${grupo.categoria}`}>
                <TableCell className="pl-6 text-muted-foreground">{grupo.categoria}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  −{valor(grupo.valor_cents)}
                </TableCell>
              </TableRow>
            ))}

            <TableRow>
              <TableHead scope="row" className="font-semibold">
                Margem
              </TableHead>
              <TableCell className="text-right font-semibold tabular-nums">
                {valor(report.margem_cents)}
              </TableCell>
            </TableRow>

            <TableRow>
              <TableHead scope="row" className="font-semibold">
                Despesas
              </TableHead>
              <TableCell className="text-right font-semibold tabular-nums text-destructive">
                −{valor(report.despesas.total_cents)}
              </TableCell>
            </TableRow>
            {report.despesas.grupos.map((grupo) => (
              <TableRow key={`despesa-${grupo.categoria}`}>
                <TableCell className="pl-6 text-muted-foreground">{grupo.categoria}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  −{valor(grupo.valor_cents)}
                </TableCell>
              </TableRow>
            ))}

            <TableRow>
              <TableHead scope="row" className="font-semibold">
                Resultado
              </TableHead>
              <TableCell className="text-right font-display text-base font-semibold tabular-nums">
                {valor(report.resultado_cents)}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
        {report.gorjeta_ignorada_cents > 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Gorjetas recebidas no período: {valor(report.gorjeta_ignorada_cents)}. Gorjeta fica
            fora da receita, da margem e do resultado.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function TabelaMensal({ meses }: { meses: DreMes[] }) {
  const linhas = comAcumulado(meses);
  return (
    <Table>
      <TableCaption>Série mensal do resultado (mesma base do gráfico).</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Mês</TableHead>
          <TableHead scope="col" className="text-right">
            Receitas
          </TableHead>
          <TableHead scope="col" className="text-right">
            Custos
          </TableHead>
          <TableHead scope="col" className="text-right">
            Despesas
          </TableHead>
          <TableHead scope="col" className="text-right">
            Resultado
          </TableHead>
          <TableHead scope="col" className="text-right">
            Acumulado
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {linhas.map(({ mes, acumulado_cents }) => (
          <TableRow key={mes.mes}>
            <TableHead scope="row" className="font-medium">
              {mesLabel(mes.mes)}
            </TableHead>
            <TableCell className="text-right tabular-nums">
              {valor(mes.receitas_cents)}
            </TableCell>
            <TableCell className="text-right tabular-nums">−{valor(mes.custos_cents)}</TableCell>
            <TableCell className="text-right tabular-nums">
              −{valor(mes.despesas_cents)}
            </TableCell>
            <TableCell className="text-right tabular-nums">{valor(mes.resultado_cents)}</TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">
              {valor(acumulado_cents)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function TabelaFluxo({ fluxo }: { fluxo: Cashflow }) {
  return (
    <Table>
      <TableCaption>
        Fluxo diário dos 30 dias a partir de {diaLabel(fluxo.base)} (saldo acumulado na janela).
      </TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead scope="col">Dia</TableHead>
          <TableHead scope="col" className="text-right">
            Entradas
          </TableHead>
          <TableHead scope="col" className="text-right">
            Saídas
          </TableHead>
          <TableHead scope="col" className="text-right">
            Saldo do dia
          </TableHead>
          <TableHead scope="col" className="text-right">
            Saldo acumulado
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {fluxo.dias.map((dia) => (
          <TableRow key={dia.dia}>
            <TableHead scope="row" className="font-medium">
              {diaLabel(dia.dia)}
            </TableHead>
            <TableCell className="text-right tabular-nums">
              {valor(dia.entradas_cents)}
            </TableCell>
            <TableCell className="text-right tabular-nums text-destructive">
              −{valor(dia.saidas_cents)}
            </TableCell>
            <TableCell className="text-right tabular-nums">{valor(dia.saldo_dia_cents)}</TableCell>
            <TableCell className="text-right tabular-nums text-muted-foreground">
              {valor(dia.saldo_acumulado_cents)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function DrePage() {
  const entitlements = usePlanEntitlements();
  const entitled = entitlements?.dreFluxo ?? null;
  // PRD §7: Financeiro inteiro exige segmento `payments`. A sidebar só esconde
  // o item; a página repete o portão (URL direta, link antigo, deep link).
  const { payments } = useSegmentFeatures();
  const segmentoLiberado = payments === true;
  const liberado = entitled === true && segmentoLiberado;

  const { tenant } = useCurrentUser();
  const timeZone = tenant?.timezone ?? "America/Sao_Paulo";

  const [regime, setRegime] = useState<DreRegime>("competencia");
  const [preset, setPreset] = useState<PeriodPreset>("6m");
  const today = todayIsoInTenantTz(timeZone);
  const initialRange = useMemo(() => resolvePresetRange("6m", today), [today]);
  const [start, setStart] = useState(initialRange.start);
  const [end, setEnd] = useState(initialRange.end);

  useEffect(() => {
    if (preset === "personalizado") return;
    const range = resolvePresetRange(preset, today);
    setStart(range.start);
    setEnd(range.end);
  }, [preset, today]);

  const reportQuery = useDreReport({ startDate: start, endDate: end, regime, enabled: liberado });
  const fluxoQuery = useCashflow30d({ baseDate: today, enabled: liberado });
  const logExport = useLogDreExport();

  const report = reportQuery.data ?? null;
  const fluxo = fluxoQuery.data ?? null;
  const meses = useMemo(() => ultimosMeses(report?.meses ?? [], 6), [report]);
  const periodo = `${start}..${end}`;
  const vazio = report !== null && semMovimento(report);
  const erro = reportQuery.isError || fluxoQuery.isError;

  function handlePresetChange(next: PeriodPreset) {
    if (next === "personalizado") {
      setPreset(next);
      return;
    }
    const range = resolvePresetRange(next, today);
    const semMudanca = next === preset && range.start === start && range.end === end;
    setPreset(next);
    setStart(range.start);
    setEnd(range.end);
    if (semMudanca) void reportQuery.refetch();
  }

  function exportar() {
    if (!report) return;
    const arquivo = dreCsvFileName(report.regime, start, end);
    downloadCsv(arquivo, buildDreCsv(report, periodo));
    logExport.mutate(
      { periodo, arquivoPath: arquivo },
      {
        onSuccess: () =>
          toast.success("CSV exportado.", {
            description: "A exportação foi registrada para auditoria.",
          }),
        onError: (e) =>
          toast.error(
            e instanceof Error
              ? `CSV baixado, mas o registro falhou: ${e.message}`
              : "CSV baixado, mas o registro falhou.",
          ),
      },
    );
  }

  const header = (
    <PageHeader
      titulo="DRE e fluxo de caixa"
      descricao="Resultado por competência ou caixa, série de 6 meses e saldo dos próximos 30 dias."
      acoes={
        liberado ? (
          <Button
            type="button"
            className="min-h-11"
            disabled={report === null || vazio || logExport.isPending}
            onClick={exportar}
          >
            <Download className="mr-2 h-4 w-4" aria-hidden="true" />
            {logExport.isPending ? "Exportando…" : "Exportar CSV"}
          </Button>
        ) : null
      }
    />
  );

  if (!segmentoLiberado) {
    return (
      <div className="space-y-6">
        {header}
        <StatePanel
          titulo={
            payments === null
              ? "Carregando DRE e fluxo de caixa"
              : "DRE disponível para salões e barbearias"
          }
          descricao={
            payments === null
              ? "Assim que o ramo da empresa carregar, o conteúdo aparece aqui."
              : "O ramo desta empresa não usa o fluxo de pagamentos. Nenhum dado financeiro foi consultado."
          }
        />
      </div>
    );
  }

  if (!liberado) {
    return (
      <div className="space-y-6">
        {header}
        <EntitlementGate
          entitled={entitled}
          recurso="DRE e fluxo de caixa"
          acaoLabel="Exportar CSV"
          descricao="O DRE é somente leitura: não altera nada e não projeta movimento futuro. Enquanto o plano não incluir o recurso, nenhum número é consultado."
        />
      </div>
    );
  }

  const carregando = reportQuery.isPending || fluxoQuery.isPending;

  return (
    <div className="space-y-6">
      {header}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <p className="text-sm font-medium">Regime</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Regime do DRE">
            {DRE_REGIMES.map((opcao) => (
              <Button
                key={opcao}
                type="button"
                variant={regime === opcao ? "default" : "outline"}
                className="min-h-11"
                aria-pressed={regime === opcao}
                onClick={() => setRegime(opcao)}
              >
                {DRE_REGIME_META[opcao].rotulo}
              </Button>
            ))}
          </div>
          <p className="max-w-md text-xs text-muted-foreground">
            {DRE_REGIME_META[regime].descricao}
          </p>
        </div>

        <div className="lg:min-w-96">
          <PeriodFilter
            preset={preset}
            start={start}
            end={end}
            onPresetChange={handlePresetChange}
            onStartChange={setStart}
            onEndChange={setEnd}
            idPrefix="dre"
            presets={DRE_PRESETS}
          />
        </div>
      </div>

      {carregando ? (
        <div className="space-y-3" aria-busy="true" aria-label="Carregando DRE">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : erro ? (
        <StatePanel
          titulo="Não foi possível carregar o DRE"
          descricao="Tente novamente. Se o erro continuar, confira o período escolhido."
        >
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={() => {
              void reportQuery.refetch();
              void fluxoQuery.refetch();
            }}
          >
            Tentar novamente
          </Button>
        </StatePanel>
      ) : report === null ? (
        <StatePanel
          titulo="Sem dados para o período"
          descricao="Ajuste o período ou registre os recebimentos e as baixas do mês."
        />
      ) : (
        <>
          <h2 className="sr-only">Resumo do DRE</h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Card>
              <CardHeader>
                <CardTitle>Receitas</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="font-display text-2xl font-semibold tabular-nums tracking-tight text-emerald-700 dark:text-emerald-400">
                  {valor(report.receitas.total_cents)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Margem</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="font-display text-2xl font-semibold tabular-nums tracking-tight">
                  {valor(report.margem_cents)}
                </p>
                <p className="text-sm text-muted-foreground">
                  Custos {valor(report.custos.total_cents)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Despesas</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="font-display text-2xl font-semibold tabular-nums tracking-tight text-red-700 dark:text-red-400">
                  {valor(report.despesas.total_cents)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Resultado</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="font-display text-2xl font-semibold tabular-nums tracking-tight">
                  {valor(report.resultado_cents)}
                </p>
              </CardContent>
            </Card>
          </div>

          {vazio ? (
            <StatePanel
              titulo="Sem movimento no período"
              descricao="Não há recebimento, comissão ou baixa neste regime e período. O CSV fica indisponível para não gerar arquivo vazio."
            />
          ) : null}

          <TabelaDre report={report} />

          <Card>
            <CardHeader>
              <CardTitle>Resultado por mês</CardTitle>
              <p className="text-sm text-muted-foreground">
                Até 6 meses do período selecionado. As barras somam o resultado da tabela.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <Suspense
                fallback={
                  <div aria-busy="true" aria-label="Carregando gráfico">
                    <Skeleton className="h-64 w-full" />
                  </div>
                }
              >
                <LazyDreMensalChart
                  ariaLabel={`Resultado mensal no regime ${DRE_REGIME_META[report.regime].rotulo}`}
                  data={comAcumulado(meses).map(({ mes, acumulado_cents }) => ({
                    label: mesLabel(mes.mes),
                    resultado_cents: mes.resultado_cents,
                    acumulado_cents,
                  }))}
                />
              </Suspense>
              <TabelaMensal meses={meses} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Fluxo de caixa · 30 dias</CardTitle>
              <p className="text-sm text-muted-foreground">
                Movimento realizado a partir de hoje — não projeta contas pendentes. O saldo
                acumulado é a soma corrente da janela.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {fluxo === null ? (
                <p className="text-sm text-muted-foreground">Sem dados de fluxo.</p>
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <p className="text-sm">
                      <span className="text-muted-foreground">Entradas: </span>
                      <span className="font-medium tabular-nums">
                        {valor(fluxo.total_entradas_cents)}
                      </span>
                    </p>
                    <p className="text-sm">
                      <span className="text-muted-foreground">Saídas: </span>
                      <span className="font-medium tabular-nums text-destructive">
                        −{valor(fluxo.total_saidas_cents)}
                      </span>
                    </p>
                    <p className="text-sm">
                      <span className="text-muted-foreground">Saldo final: </span>
                      <span className="font-medium tabular-nums">
                        {valor(fluxo.saldo_final_cents)}
                      </span>
                    </p>
                  </div>
                  <Suspense
                    fallback={
                      <div aria-busy="true" aria-label="Carregando gráfico">
                        <Skeleton className="h-64 w-full" />
                      </div>
                    }
                  >
                    <LazyFluxoChart
                      ariaLabel="Fluxo de caixa dos próximos 30 dias com saldo acumulado"
                      data={fluxo.dias.map((dia) => ({
                        label: diaLabel(dia.dia),
                        entradas_cents: dia.entradas_cents,
                        saidas_cents: dia.saidas_cents,
                        saldo_acumulado_cents: dia.saldo_acumulado_cents,
                      }))}
                    />
                  </Suspense>
                  {/* Região focável: a tabela rola dentro do card e precisa
                      receber teclado (setas/PageDown) sem mouse. */}
                  <div
                    className="max-h-80 overflow-y-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    role="region"
                    tabIndex={0}
                    aria-label="Tabela do fluxo de caixa de 30 dias"
                  >
                    <TabelaFluxo fluxo={fluxo} />
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <TableProperties className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            Receita de atendimento vem do ledger de recebimentos; avulsas e recorrência aparecem em
            categorias próprias. Gorjeta nunca entra nos totais.
          </p>
        </>
      )}
    </div>
  );
}
