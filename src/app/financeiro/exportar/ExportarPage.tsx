import { useEffect, useMemo, useState, type FormEvent } from "react";
import { FileDown, ShieldCheck } from "lucide-react";
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useExportLedger, useExportLogs } from "@/hooks/useExportContabil";
import { usePlanEntitlements } from "@/hooks/usePlanEntitlements";
import { useSegmentFeatures } from "@/hooks/useSegmentFeatures";
import { tenantRangeUtc } from "@/lib/datetime";
import {
  EXPORT_ESCOPOS,
  EXPORT_ESCOPO_META,
  EXPORT_FORMATOS,
  EXPORT_FORMATO_LABEL,
  EXPORT_FORMATO_META,
  EXPORT_TIPO_LABEL,
  OFX_ESCOPO_AVISO,
  exportErrorMessage,
  formatExportDate,
  saveExportBlob,
  type ExportEscopo,
  type ExportFormato,
  type ExportLog,
} from "@/lib/export-contabil";
import { resolvePresetRange, todayIsoInTenantTz } from "@/lib/period-presets";

/**
 * Export contábil (`/app/financeiro/exportar`, Fase 5 ADR-10).
 *
 * Admin-only pela rota (`RequireRole admin`) + RLS no banco. Três portões:
 * segmento (`payments === true`), entitlement (`exportContabil`) e o papel da
 * rota. Qualquer um bloqueado → estado legível e **zero request** — nem de
 * arquivo, nem da trilha de logs.
 *
 * Form: período + formato (CSV / OFX / SPED-resumo) + escopo (a receber / a
 * pagar / fiscal). Download direto + tabela da trilha (`export_logs`, ADR-09).
 * Período sem movimento devolve mensagem legível, nunca arquivo vazio.
 */

const EXPORT_PRESETS: readonly PeriodPresetOption[] = [
  { value: "mes", label: "Este mês" },
  { value: "mes-passado", label: "Mês passado" },
  { value: "personalizado", label: "Personalizado" },
];

function TabelaLogs({
  logs,
  carregando,
  erro,
  aoTentarNovamente,
}: {
  logs: readonly ExportLog[];
  carregando: boolean;
  erro: boolean;
  aoTentarNovamente: () => void;
}) {
  if (carregando) {
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Carregando trilha de exports">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (erro) {
    return (
      <StatePanel
        titulo="Não foi possível carregar a trilha de exports"
        descricao="Tente novamente. O arquivo já baixado continua válido."
      >
        <Button type="button" variant="outline" className="min-h-11" onClick={aoTentarNovamente}>
          Tentar novamente
        </Button>
      </StatePanel>
    );
  }

  if (logs.length === 0) {
    return (
      <StatePanel
        titulo="Nenhum export registrado"
        descricao="Ao gerar um arquivo, ele aparece aqui com formato, período, autor e data."
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableCaption>Últimos 50 arquivos entregues ao contador.</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Arquivo</TableHead>
            <TableHead scope="col">Tipo</TableHead>
            <TableHead scope="col">Período</TableHead>
            <TableHead scope="col" className="hidden sm:table-cell">
              Formato
            </TableHead>
            <TableHead scope="col" className="hidden md:table-cell">
              Autor
            </TableHead>
            <TableHead scope="col" className="text-right">
              Data
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {logs.map((log) => (
            <TableRow key={log.id}>
              <TableCell className="max-w-56 truncate font-medium">
                {log.arquivoPath ?? "—"}
              </TableCell>
              <TableCell>{EXPORT_TIPO_LABEL[log.tipo] ?? log.tipo}</TableCell>
              <TableCell className="whitespace-nowrap">{log.periodo}</TableCell>
              <TableCell className="hidden sm:table-cell">
                {EXPORT_FORMATO_LABEL[log.formato] ?? log.formato}
              </TableCell>
              <TableCell className="hidden md:table-cell">{log.autorNome ?? "—"}</TableCell>
              <TableCell className="text-right whitespace-nowrap text-muted-foreground">
                {formatExportDate(log.createdAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function ExportarPage() {
  const entitlements = usePlanEntitlements();
  const entitled = entitlements?.exportContabil ?? null;
  const { payments } = useSegmentFeatures();
  const segmentoLiberado = payments === true;
  const liberado = entitled === true && segmentoLiberado;

  const { tenant } = useCurrentUser();
  const timeZone = tenant?.timezone ?? "America/Sao_Paulo";

  const [preset, setPreset] = useState<PeriodPreset>("mes");
  const today = todayIsoInTenantTz(timeZone);
  const initialRange = useMemo(() => resolvePresetRange("mes", today), [today]);
  const [start, setStart] = useState(initialRange.start);
  const [end, setEnd] = useState(initialRange.end);
  const [formato, setFormato] = useState<ExportFormato>("csv");
  const [escopo, setEscopo] = useState<ExportEscopo>("receber");
  const [mensagemVazia, setMensagemVazia] = useState<string | null>(null);

  useEffect(() => {
    if (preset === "personalizado") return;
    const range = resolvePresetRange(preset, today);
    setStart(range.start);
    setEnd(range.end);
  }, [preset, today]);

  const exportMutation = useExportLedger();
  const logsQuery = useExportLogs(liberado);
  const logs = logsQuery.data ?? [];

  function handlePresetChange(next: PeriodPreset) {
    if (next === "personalizado") {
      setPreset(next);
      return;
    }
    const range = resolvePresetRange(next, today);
    setPreset(next);
    setStart(range.start);
    setEnd(range.end);
    setMensagemVazia(null);
  }

  function handleExport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMensagemVazia(null);
    const range = tenantRangeUtc(start, end, timeZone);
    if (!range) {
      toast.error("Período inválido. Confira as datas de início e fim.");
      return;
    }

    exportMutation.mutate(
      {
        periodoIni: start,
        periodoFim: end,
        ini: range.startUtc.toISOString(),
        fim: range.endUtc.toISOString(),
        formato,
        escopo,
      },
      {
        onSuccess: ({ filename, blob }) => {
          saveExportBlob(filename, blob);
          toast.success("Arquivo gerado.", {
            description: `${filename} — a entrega foi registrada na trilha.`,
          });
        },
        onError: (error) => {
          if (error.code === "EMPTY_PERIOD") {
            setMensagemVazia(
              exportErrorMessage("EMPTY_PERIOD", "Sem movimentos no período."),
            );
            return;
          }
          toast.error(error.message);
        },
      },
    );
  }

  const header = (
    <PageHeader
      titulo="Exportar para o contador"
      descricao="Período, formato e escopo em um arquivo; cada entrega fica registrada com autor e data."
    />
  );

  if (!segmentoLiberado) {
    return (
      <div className="space-y-6">
        {header}
        <StatePanel
          titulo={
            payments === null
              ? "Carregando export contábil"
              : "Export disponível para salões e barbearias"
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
          recurso="Export contábil"
          acaoLabel="Baixar arquivo"
          descricao="Enquanto o plano não incluir o export contábil, nenhum movimento é consultado e nenhum arquivo é gerado."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Período</CardTitle>
            <CardDescription>
              Datas no fuso {timeZone.replace("_", " ")}. O arquivo cobre o período fechado.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <PeriodFilter
              preset={preset}
              start={start}
              end={end}
              onPresetChange={handlePresetChange}
              onStartChange={(value) => {
                setStart(value);
                setMensagemVazia(null);
              }}
              onEndChange={(value) => {
                setEnd(value);
                setMensagemVazia(null);
              }}
              idPrefix="export-contabil"
              presets={EXPORT_PRESETS}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Formato</CardTitle>
            <CardDescription>{EXPORT_FORMATO_META[formato].descricao}</CardDescription>
          </CardHeader>
          <CardContent>
            <form id="form-export-contabil" onSubmit={handleExport} className="space-y-5">
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Formato do arquivo</legend>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Formato do arquivo">
                  {EXPORT_FORMATOS.map((opcao) => (
                    <Button
                      key={opcao}
                      type="button"
                      variant={formato === opcao ? "default" : "outline"}
                      className="min-h-11"
                      aria-pressed={formato === opcao}
                      onClick={() => {
                        setFormato(opcao);
                        setMensagemVazia(null);
                      }}
                    >
                      {EXPORT_FORMATO_META[opcao].rotulo}
                    </Button>
                  ))}
                </div>
              </fieldset>

              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Escopo</legend>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Escopo do export">
                  {EXPORT_ESCOPOS.map((opcao) => (
                    <Button
                      key={opcao}
                      type="button"
                      variant={escopo === opcao ? "default" : "outline"}
                      className="min-h-11"
                      aria-pressed={escopo === opcao}
                      onClick={() => {
                        setEscopo(opcao);
                        setMensagemVazia(null);
                      }}
                    >
                      {EXPORT_ESCOPO_META[opcao].rotulo}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  {formato === "ofx" ? OFX_ESCOPO_AVISO : EXPORT_ESCOPO_META[escopo].descricao}
                </p>
              </fieldset>

              <div className="flex items-start gap-2 rounded-md border border-border/60 bg-muted/40 p-3 text-xs text-muted-foreground">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <p>
                  O arquivo sai com os dados desta empresa apenas. Período sem movimento não gera
                  arquivo — a tela avisa e nada é registrado como entrega.
                </p>
              </div>

              {mensagemVazia ? (
                <div
                  role="status"
                  className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
                >
                  {mensagemVazia}
                </div>
              ) : null}

              <Button type="submit" className="min-h-11 w-full sm:w-auto" disabled={exportMutation.isPending}>
                <FileDown className="mr-2 h-4 w-4" aria-hidden="true" />
                {exportMutation.isPending ? "Gerando arquivo…" : "Baixar arquivo"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Trilha de exports</CardTitle>
          <CardDescription>
            Toda entrega fica registrada com formato, período, autor e data.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <TabelaLogs
            logs={logs}
            carregando={logsQuery.isPending}
            erro={logsQuery.isError}
            aoTentarNovamente={() => void logsQuery.refetch()}
          />
        </CardContent>
      </Card>
    </div>
  );
}
