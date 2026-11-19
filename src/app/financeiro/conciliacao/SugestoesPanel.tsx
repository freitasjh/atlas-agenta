import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { StatePanel } from "@/components/StatePanel";
import {
  CONCILIACAO_STATUS_META,
  RECONCILIACAO_ALVO_META,
  RECONCILIACAO_TOLERANCIA_DIAS,
  formatarDataExtrato,
  valorAssinado,
  type BankLine,
  type MatchCandidate,
  type ReconciliationLink,
} from "@/lib/conciliacao";
import { formatCentsToBRL } from "@/lib/money";

interface SugestoesPanelProps {
  linha: BankLine | null;
  sugestoes: MatchCandidate[];
  carregando: boolean;
  erro: boolean;
  vinculo: ReconciliationLink | null;
  aoConciliar: (candidato: MatchCandidate) => void;
  aoCriarLancamento: () => void;
  aoIgnorar: () => void;
}

/**
 * Painel direito da conciliação: o match do banco para a linha em foco
 * (ADR-08, RF-23). Só chegam candidatos de valor EXATO dentro de ±2 dias —
 * a decisão é do banco (`reconciliation_suggest_matches`), esta camada apenas
 * apresenta e dispara a ação.
 */
export function SugestoesPanel({
  linha,
  sugestoes,
  carregando,
  erro,
  vinculo,
  aoConciliar,
  aoCriarLancamento,
  aoIgnorar,
}: SugestoesPanelProps) {
  if (!linha) {
    return (
      <Card className="h-full">
        <CardHeader>
          <CardTitle>Lançamentos</CardTitle>
        </CardHeader>
        <CardContent>
          <StatePanel
            titulo="Selecione uma linha do extrato"
            descricao="O match mostra os lançamentos de mesmo valor com data a até dois dias de distância."
          />
        </CardContent>
      </Card>
    );
  }

  const meta = CONCILIACAO_STATUS_META[linha.status];

  return (
    <Card className="h-full">
      <CardHeader className="space-y-1">
        <CardTitle className="flex flex-wrap items-center gap-2">
          <span>Lançamentos</span>
          <Badge variant={meta.variant}>{meta.rotulo}</Badge>
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {formatarDataExtrato(linha.data)} · {linha.descricao} ·{" "}
          <span className={linha.valor_cents < 0 ? "text-destructive" : undefined}>
            {valorAssinado(linha.valor_cents)}
          </span>
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {linha.status === "ignorado" ? (
          <StatePanel
            titulo="Linha ignorada"
            descricao={linha.motivo_ignorado ?? "Esta linha foi ignorada na conciliação."}
          />
        ) : linha.status === "conciliado" ? (
          <StatePanel
            titulo="Linha conciliada"
            descricao={
              vinculo
                ? `Vinculada a ${RECONCILIACAO_ALVO_META[vinculo.alvo_tipo].toLowerCase()}.`
                : "Esta linha já está conciliada."
            }
          />
        ) : erro ? (
          <StatePanel
            titulo="Não foi possível buscar o match"
            descricao="Tente selecionar a linha novamente. Se o erro continuar, recarregue a página."
          />
        ) : carregando ? (
          <div className="space-y-2" aria-label="Buscando lançamentos compatíveis">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : sugestoes.length === 0 ? (
          <StatePanel
            titulo="Nenhum lançamento compatível"
            descricao={`Não há lançamento de valor exato com data a até ${RECONCILIACAO_TOLERANCIA_DIAS} dias. Crie o lançamento a partir desta linha ou ignore com motivo.`}
          >
            <div className="flex flex-wrap justify-center gap-2">
              <Button type="button" className="min-h-11" onClick={aoCriarLancamento}>
                Criar lançamento
              </Button>
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={aoIgnorar}
              >
                Ignorar com motivo
              </Button>
            </div>
          </StatePanel>
        ) : (
          <ul className="space-y-2" aria-label="Lançamentos compatíveis">
            {sugestoes.map((candidato) => (
              <li
                key={`${candidato.alvo_tipo}:${candidato.alvo_id}`}
                className="rounded-md border p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{candidato.descricao}</p>
                    <p className="text-xs text-muted-foreground">
                      {RECONCILIACAO_ALVO_META[candidato.alvo_tipo]} ·{" "}
                      {formatarDataExtrato(candidato.data)} ·{" "}
                      {candidato.delta_dias === 0
                        ? "mesmo dia"
                        : `${candidato.delta_dias} dia(s) de diferença`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="whitespace-nowrap tabular-nums">
                      {formatCentsToBRL(candidato.valor_cents)}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      className="min-h-11"
                      aria-label={`Conciliar com ${candidato.descricao}`}
                      onClick={() => aoConciliar(candidato)}
                    >
                      Conciliar
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
