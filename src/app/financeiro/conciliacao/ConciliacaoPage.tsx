import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { ContaBancariaDialog } from "@/app/financeiro/conciliacao/ContaBancariaDialog";
import { CriarLancamentoDialog } from "@/app/financeiro/conciliacao/CriarLancamentoDialog";
import { DesfazerVinculoDialog, type DesfazerAlvo } from "@/app/financeiro/conciliacao/DesfazerVinculoDialog";
import { ExtratoTable } from "@/app/financeiro/conciliacao/ExtratoTable";
import { IgnorarLinhasDialog } from "@/app/financeiro/conciliacao/IgnorarLinhasDialog";
import { SugestoesPanel } from "@/app/financeiro/conciliacao/SugestoesPanel";
import { UploadExtratoDialog } from "@/app/financeiro/conciliacao/UploadExtratoDialog";
import { EntitlementGate } from "@/components/EntitlementGate";
import { PageHeader } from "@/components/PageHeader";
import { StatePanel } from "@/components/StatePanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  idsDeLinhas,
  resumoExtrato,
  useBankAccounts,
  useBankLines,
  useBankStatements,
  useConciliarLote,
  useLinkLines,
  useReconciliationLinks,
  useSuggestMatches,
  useUndoLinks,
} from "@/hooks/useConciliacao";
import { usePlanEntitlements } from "@/hooks/usePlanEntitlements";
import {
  RECONCILIACAO_ALVO_META,
  formatarDataExtrato,
  type BankAccount,
  type BankLine,
  type BankStatement,
  type MatchCandidate,
} from "@/lib/conciliacao";
import { formatCentsToBRL } from "@/lib/money";
import { cn } from "@/lib/utils";

type Painel = "extrato" | "lancamentos";

function primeiroPorId<T extends { id: string }>(itens: T[], id: string | null): T | null {
  if (itens.length === 0) return null;
  return itens.find((item) => item.id === id) ?? itens[0] ?? null;
}

function ContaResumo({ conta }: { conta: BankAccount }) {
  return (
    <span className="text-sm text-muted-foreground">
      {conta.banco} · final {conta.conta_ultimos4}
    </span>
  );
}

function ExtratoResumo({ extrato }: { extrato: BankStatement | null }) {
  if (!extrato) return <span className="text-sm text-muted-foreground">Nenhum extrato importado.</span>;
  return (
    <span className="text-sm text-muted-foreground">
      {extrato.nome_arquivo} · {extrato.linhas_total} lançamento(s)
    </span>
  );
}

/**
 * Conciliação bancária (`/app/financeiro/conciliacao`, Fase 5 ADR-08).
 *
 * Admin-only pela rota (`RequireRole admin`) + RLS. Gating `conciliacao`:
 * `false`/`null` → upsell legível e **zero request** (queries desabilitadas).
 *
 * Layout: split de 2 colunas no desktop (extrato × lançamentos) e alternância
 * "Extrato / Lançamentos" no mobile (mesmo DOM, sem duplicar request nem texto
 * para leitores de tela). Conta + período + saldos + upload OFX/CSV no topo.
 * Ações: conciliar em lote (só pares de valor exato ±2d sugeridos pelo banco),
 * criar lançamento a partir da órfã, ignorar com motivo e desfazer — 5s pelo
 * toast, depois só com motivo auditado.
 */
export function ConciliacaoPage() {
  const entitlements = usePlanEntitlements();
  const entitled = entitlements?.conciliacao ?? null;
  const liberado = entitled === true;

  const [painel, setPainel] = useState<Painel>("extrato");
  const [contaId, setContaId] = useState<string | null>(null);
  const [extratoId, setExtratoId] = useState<string | null>(null);
  const [selecionadas, setSelecionadas] = useState<string[]>([]);
  const [focoId, setFocoId] = useState<string | null>(null);

  const [contaDialog, setContaDialog] = useState(false);
  const [uploadDialog, setUploadDialog] = useState(false);
  const [ignorarLinhas, setIgnorarLinhas] = useState<BankLine[] | null>(null);
  const [linhaCriar, setLinhaCriar] = useState<BankLine | null>(null);
  const [alvoDesfazer, setAlvoDesfazer] = useState<DesfazerAlvo | null>(null);

  const contasQuery = useBankAccounts(liberado);
  const contaSelecionada = useMemo(
    () => primeiroPorId(contasQuery.data ?? [], contaId),
    [contasQuery.data, contaId],
  );

  const extratosQuery = useBankStatements(contaSelecionada?.id ?? null, liberado);
  const extratoSelecionado = useMemo(
    () => primeiroPorId(extratosQuery.data ?? [], extratoId),
    [extratosQuery.data, extratoId],
  );

  const linhasQuery = useBankLines(extratoSelecionado?.id ?? null, liberado);
  const linhas = useMemo(() => linhasQuery.data ?? [], [linhasQuery.data]);
  const linhasIds = useMemo(() => idsDeLinhas(linhas), [linhas]);

  const vinculosQuery = useReconciliationLinks(
    extratoSelecionado?.id ?? null,
    linhasIds,
    liberado,
  );
  const vinculoPorLinha = useMemo(
    () => new Map((vinculosQuery.data ?? []).map((vinculo) => [vinculo.bank_line_id, vinculo])),
    [vinculosQuery.data],
  );

  const selecionadasSet = useMemo(() => new Set(selecionadas), [selecionadas]);
  const linhaFoco = useMemo(() => {
    const alvo = focoId ?? selecionadas[0] ?? null;
    if (alvo === null) return null;
    return linhas.find((linha) => linha.id === alvo) ?? null;
  }, [linhas, focoId, selecionadas]);

  const sugestoesQuery = useSuggestMatches(
    linhaFoco !== null && linhaFoco.status === "pendente" ? linhaFoco.id : null,
    liberado,
  );

  const conciliarLote = useConciliarLote();
  const conciliar = useLinkLines();
  const desfazer = useUndoLinks();

  const resumo = useMemo(() => resumoExtrato(linhas), [linhas]);
  const carregandoExtrato = linhasQuery.isPending && extratoSelecionado !== null;

  const oferecerUndo = useCallback(
    (linkIds: string[], mensagem: string) => {
      if (linkIds.length === 0) return;
      toast.success(mensagem, {
        duration: 5_000,
        action: {
          label: "Desfazer",
          onClick: () => {
            desfazer.mutate(
              { link_ids: linkIds },
              {
                onSuccess: ({ undone }) =>
                  toast.success(
                    undone === 1 ? "Conciliação desfeita." : `${undone} conciliações desfeitas.`,
                  ),
                onError: (e) =>
                  toast.error(
                    e instanceof Error ? e.message : "Não foi possível desfazer a conciliação.",
                  ),
              },
            );
          },
        },
      });
    },
    [desfazer],
  );

  function alternarLinha(lineId: string) {
    const jaSelecionada = selecionadas.includes(lineId);
    setSelecionadas(
      jaSelecionada ? selecionadas.filter((id) => id !== lineId) : [...selecionadas, lineId],
    );
    if (!jaSelecionada) setFocoId(lineId);
  }

  function aoConciliarCandidato(candidato: MatchCandidate) {
    if (!linhaFoco) return;
    conciliar.mutate(
      [
        {
          bank_line_id: linhaFoco.id,
          alvo_tipo: candidato.alvo_tipo,
          alvo_id: candidato.alvo_id,
        },
      ],
      {
        onSuccess: ({ linked, link_ids }) => {
          setSelecionadas((atual) => atual.filter((id) => id !== linhaFoco.id));
          oferecerUndo(
            link_ids,
            linked === 1 ? "1 linha conciliada." : `${linked} linhas conciliadas.`,
          );
        },
        onError: (e) =>
          toast.error(e instanceof Error ? e.message : "Não foi possível conciliar a linha."),
      },
    );
  }

  function aoConciliarLinha(linha: BankLine) {
    setFocoId(linha.id);
    conciliarLote.mutate([linha.id], {
      onSuccess: ({ linked, link_ids }) => {
        if (linked === 0) {
          toast.info("Nenhum lançamento compatível.", {
            description:
              "Crie o lançamento a partir desta linha ou ignore com motivo. O match exige valor exato e data a até 2 dias.",
          });
          setLinhaCriar(linha);
          return;
        }
        oferecerUndo(link_ids, "1 linha conciliada.");
      },
      onError: (e) =>
        toast.error(e instanceof Error ? e.message : "Não foi possível conciliar a linha."),
    });
  }

  function aoConciliarSelecionadas() {
    if (selecionadas.length === 0) {
      toast.info("Selecione ao menos uma linha do extrato.");
      return;
    }
    conciliarLote.mutate(selecionadas, {
      onSuccess: ({ linked, sem_match, link_ids }) => {
        setSelecionadas([]);
        if (linked === 0) {
          toast.info("Nenhuma das linhas selecionadas tem lançamento compatível.", {
            description: `${sem_match} linha(s) seguem pendentes. Crie o lançamento ou ignore com motivo.`,
          });
          return;
        }
        oferecerUndo(
          link_ids,
          `${linked} ${linked === 1 ? "linha conciliada" : "linhas conciliadas"}${
            sem_match > 0 ? ` · ${sem_match} sem par` : ""
          }.`,
        );
      },
      onError: (e) =>
        toast.error(e instanceof Error ? e.message : "Não foi possível conciliar em lote."),
    });
  }

  const header = (
    <PageHeader
      titulo="Conciliação"
      descricao="Conferir o extrato do banco com os lançamentos, sem divergência."
      acoes={
        <div className="flex flex-wrap gap-2">
          {liberado ? (
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => setContaDialog(true)}
            >
              Nova conta
            </Button>
          ) : null}
          <Button
            type="button"
            className="min-h-11"
            disabled={!liberado || contaSelecionada === null}
            onClick={() => setUploadDialog(true)}
          >
            Importar extrato
          </Button>
        </div>
      }
    />
  );

  if (!liberado) {
    return (
      <div className="space-y-6">
        {header}
        <EntitlementGate entitled={entitled} recurso="Conciliação" acaoLabel="Importar extrato">
          <StatePanel
            titulo="Conciliação disponível no plano"
            descricao="O conteúdo gravado continua visível aqui. Importar extrato e conciliar são liberados nos planos com esse recurso."
          />
        </EntitlementGate>
        <ContaBancariaDialog aberto={contaDialog} aoAlterarAberto={setContaDialog} />
      </div>
    );
  }

  const carregandoInicial = contasQuery.isPending || extratosQuery.isPending;
  const erro = contasQuery.isError || extratosQuery.isError || linhasQuery.isError;

  return (
    <div className="space-y-6">
      {header}

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="min-w-0 space-y-2">
          <Label htmlFor="conciliacao-conta">Conta</Label>
          <select
            id="conciliacao-conta"
            className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm sm:w-64 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={contaSelecionada?.id ?? ""}
            onChange={(e) => {
              setContaId(e.target.value === "" ? null : e.target.value);
              setExtratoId(null);
              setSelecionadas([]);
              setFocoId(null);
            }}
          >
            {(contasQuery.data ?? []).length === 0 ? (
              <option value="">Nenhuma conta cadastrada</option>
            ) : null}
            {(contasQuery.data ?? []).map((conta) => (
              <option key={conta.id} value={conta.id}>
                {conta.nome} · final {conta.conta_ultimos4}
              </option>
            ))}
          </select>
        </div>

        <div className="min-w-0 space-y-2 sm:min-w-56">
          <Label htmlFor="conciliacao-extrato">Período do extrato</Label>
          <select
            id="conciliacao-extrato"
            className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={extratoSelecionado?.id ?? ""}
            disabled={(extratosQuery.data ?? []).length === 0}
            onChange={(e) => {
              setExtratoId(e.target.value === "" ? null : e.target.value);
              setSelecionadas([]);
              setFocoId(null);
            }}
          >
            {(extratosQuery.data ?? []).length === 0 ? (
              <option value="">Nenhum extrato</option>
            ) : (
              (extratosQuery.data ?? []).map((extrato) => (
                <option key={extrato.id} value={extrato.id}>
                  {formatarDataExtrato(extrato.periodo_ini)} a{" "}
                  {formatarDataExtrato(extrato.periodo_fim)}
                </option>
              ))
            )}
          </select>
        </div>

        <div className="flex flex-col gap-1 sm:pb-2">
          {contaSelecionada ? <ContaResumo conta={contaSelecionada} /> : null}
          <ExtratoResumo extrato={extratoSelecionado} />
        </div>
      </div>

      <h2 className="sr-only">Resumo do extrato</h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle>Saldo inicial</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-display text-2xl font-semibold tabular-nums tracking-tight">
              {formatCentsToBRL(
                extratoSelecionado?.saldo_ini_cents ?? contaSelecionada?.saldo_inicial_cents ?? 0,
              )}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Saldo final</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-display text-2xl font-semibold tabular-nums tracking-tight">
              {extratoSelecionado?.saldo_fim_cents === null ||
              extratoSelecionado?.saldo_fim_cents === undefined
                ? "—"
                : formatCentsToBRL(extratoSelecionado.saldo_fim_cents)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Conciliadas</CardTitle>
          </CardHeader>
          <CardContent>
            {carregandoExtrato ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <>
                <p className="font-display text-2xl font-semibold tabular-nums tracking-tight">
                  {resumo.conciliadas}
                  <span className="text-base font-normal text-muted-foreground">
                    {" "}
                    / {linhas.length}
                  </span>
                </p>
                <p className="text-sm text-muted-foreground">{resumo.pendentes} pendente(s)</p>
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Entradas e saídas</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {carregandoExtrato ? (
              <Skeleton className="h-10 w-28" />
            ) : (
              <>
                <p className="text-sm tabular-nums text-emerald-700 dark:text-emerald-400">
                  +{formatCentsToBRL(resumo.entradas_cents)}
                </p>
                <p className="text-sm tabular-nums text-red-700 dark:text-red-400">
                  −{formatCentsToBRL(Math.abs(resumo.saidas_cents))}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {carregandoInicial ? (
        <div className="space-y-2" aria-label="Carregando conciliação">
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      ) : erro ? (
        <StatePanel
          titulo="Não foi possível carregar a conciliação"
          descricao="Tente novamente. Se o erro continuar, recarregue a página."
        >
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
            onClick={() => {
              void contasQuery.refetch();
              void extratosQuery.refetch();
              void linhasQuery.refetch();
            }}
          >
            Tentar novamente
          </Button>
        </StatePanel>
      ) : contaSelecionada === null ? (
        <StatePanel
          titulo="Nenhuma conta bancária cadastrada"
          descricao="Cadastre a conta (banco e 4 últimos dígitos) para importar o primeiro extrato."
        >
          <Button type="button" className="min-h-11" onClick={() => setContaDialog(true)}>
            Cadastrar conta
          </Button>
        </StatePanel>
      ) : extratoSelecionado === null ? (
        <StatePanel
          titulo="Nenhum extrato importado"
          descricao="Importe o OFX do internet banking ou um CSV com data, descrição e valor. Reenviar o mesmo arquivo não duplica nada."
        >
          <Button type="button" className="min-h-11" onClick={() => setUploadDialog(true)}>
            Importar extrato
          </Button>
        </StatePanel>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 lg:hidden" role="group" aria-label="Painel da conciliação">
            {(
              [
                { valor: "extrato", rotulo: "Extrato" },
                { valor: "lancamentos", rotulo: "Lançamentos" },
              ] as const
            ).map((item) => (
              <Button
                key={item.valor}
                type="button"
                variant={painel === item.valor ? "default" : "outline"}
                className="min-h-11 flex-1"
                aria-pressed={painel === item.valor}
                onClick={() => setPainel(item.valor)}
              >
                {item.rotulo}
              </Button>
            ))}
          </div>

          {selecionadas.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 p-3">
              <span className="text-sm font-medium">
                {selecionadas.length} selecionada(s)
              </span>
              <Button
                type="button"
                className="min-h-11"
                disabled={conciliarLote.isPending}
                onClick={aoConciliarSelecionadas}
              >
                {conciliarLote.isPending ? "Conciliando…" : "Conciliar em lote"}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={() =>
                  setIgnorarLinhas(linhas.filter((linha) => selecionadasSet.has(linha.id)))
                }
              >
                Ignorar com motivo
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="min-h-11"
                onClick={() => setSelecionadas([])}
              >
                Limpar seleção
              </Button>
            </div>
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            <section
              aria-label="Extrato bancário"
              className={cn(painel === "extrato" ? "block" : "hidden", "min-w-0 lg:block")}
            >
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="font-display text-lg font-semibold tracking-tight">Extrato</h2>
                  <span className="text-sm text-muted-foreground">
                    {carregandoExtrato
                      ? "Carregando linhas…"
                      : `${resumo.pendentes} pendente(s) · ${resumo.ignoradas} ignorada(s)`}
                  </span>
                </div>
                {carregandoExtrato ? (
                  <div className="space-y-2" aria-label="Carregando linhas do extrato">
                    <Skeleton className="h-11 w-full" />
                    <Skeleton className="h-11 w-full" />
                    <Skeleton className="h-11 w-full" />
                  </div>
                ) : linhas.length === 0 ? (
                  <StatePanel
                    titulo="Extrato sem lançamentos"
                    descricao="Importe outro período ou confira o arquivo enviado."
                  />
                ) : (
                  <ExtratoTable
                    linhas={linhas}
                    selecionadas={selecionadasSet}
                    vinculoPorLinha={vinculoPorLinha}
                    aoAlternar={alternarLinha}
                    aoConciliar={aoConciliarLinha}
                    aoIgnorar={(linha) => setIgnorarLinhas([linha])}
                    aoDesfazer={(linha, vinculo) => setAlvoDesfazer({ linha, vinculo })}
                  />
                )}
              </div>
            </section>

            <section
              aria-label="Lançamentos do match"
              className={cn(painel === "lancamentos" ? "block" : "hidden", "min-w-0 lg:block")}
            >
              <SugestoesPanel
                linha={linhaFoco}
                sugestoes={sugestoesQuery.data ?? []}
                carregando={sugestoesQuery.isPending}
                erro={sugestoesQuery.isError}
                vinculo={linhaFoco ? (vinculoPorLinha.get(linhaFoco.id) ?? null) : null}
                aoConciliar={aoConciliarCandidato}
                aoCriarLancamento={() => setLinhaCriar(linhaFoco)}
                aoIgnorar={() => setIgnorarLinhas(linhaFoco ? [linhaFoco] : null)}
              />              <p className="mt-2 text-xs text-muted-foreground">
                {linhaFoco
                  ? `Match exato em centavos, data a até 2 dias. ${
                      vinculoPorLinha.get(linhaFoco.id)
                        ? `Vínculo: ${RECONCILIACAO_ALVO_META[vinculoPorLinha.get(linhaFoco.id)?.alvo_tipo ?? "manual"]}.`
                        : ""
                    }`
                  : "Selecione uma linha para ver o match."}
              </p>
            </section>
          </div>
        </>
      )}

      <ContaBancariaDialog aberto={contaDialog} aoAlterarAberto={setContaDialog} />
      <UploadExtratoDialog
        aberto={uploadDialog}
        conta={contaSelecionada}
        aoAlterarAberto={setUploadDialog}
      />
      <IgnorarLinhasDialog linhas={ignorarLinhas} aoFechar={() => setIgnorarLinhas(null)} />
      <CriarLancamentoDialog
        linha={linhaCriar}
        liberado={liberado}
        aoFechar={() => setLinhaCriar(null)}
      />
      <DesfazerVinculoDialog alvo={alvoDesfazer} aoFechar={() => setAlvoDesfazer(null)} />
    </div>
  );
}
