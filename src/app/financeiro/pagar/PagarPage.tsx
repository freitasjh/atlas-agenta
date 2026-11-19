import { useMemo, useState } from "react";

import { BaixaDialog } from "@/app/financeiro/pagar/BaixaDialog";
import { CancelarDialog } from "@/app/financeiro/pagar/CancelarDialog";
import { NovoLancamentoDialog } from "@/app/financeiro/pagar/NovoLancamentoDialog";
import { EntitlementGate } from "@/components/EntitlementGate";
import { PageHeader } from "@/components/PageHeader";
import { StatePanel } from "@/components/StatePanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePayableKpis, usePayables, useSuppliers } from "@/hooks/usePayables";
import { usePlanEntitlements } from "@/hooks/usePlanEntitlements";
import { PAYABLE_STATUS_META, PAYABLE_STATUSES, type Payable, type PayableStatus } from "@/lib/pagar";
import { formatCentsToBRL } from "@/lib/money";

function formatarData(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/**
 * Contas a pagar (`/app/financeiro/pagar`, Fase 5 ADR-06). Admin-only pela rota
 * (`RequireRole admin`) + RLS no banco. Gating `contasPagar`: `false`/`null` →
 * upsell legível e **zero request** a `suppliers`/`payables` (queries desabilitadas).
 *
 * Filtros status/fornecedor/vencimento; KPI vencido + próximos 7d; tabela
 * fornecedor/descrição/vencimento/valor/estado; Dialog de baixa (valor/data/
 * conta/anexo, parcial mostra o resto); Switch de recorrência no lançamento;
 * fornecedor curto no Dialog.
 */
export function PagarPage() {
  const entitlements = usePlanEntitlements();
  const entitled = entitlements?.contasPagar ?? null;
  const liberado = entitled === true;

  const [statusFiltro, setStatusFiltro] = useState<PayableStatus | "">("");
  const [fornecedorFiltro, setFornecedorFiltro] = useState("");
  const [vencimentoAte, setVencimentoAte] = useState("");
  const [baixaConta, setBaixaConta] = useState<Payable | null>(null);
  const [cancelarConta, setCancelarConta] = useState<Payable | null>(null);
  const [lancamentoAberto, setLancamentoAberto] = useState(false);

  const fornecedores = useSuppliers(liberado);
  const kpis = usePayableKpis(liberado);
  const contas = usePayables(
    {
      status: statusFiltro === "" ? undefined : (statusFiltro as PayableStatus),
      supplierId: fornecedorFiltro === "" ? undefined : fornecedorFiltro,
      ateVencimento: vencimentoAte === "" ? undefined : new Date(vencimentoAte).toISOString(),
    },
    liberado,
  );

  const fornecedorPorId = useMemo(
    () => new Map((fornecedores.data ?? []).map((f) => [f.id, f.nome])),
    [fornecedores.data],
  );
  const linhas = useMemo(() => contas.data ?? [], [contas.data]);

  const carregando = fornecedores.isPending || contas.isPending || kpis.isPending;
  const erro = fornecedores.isError || contas.isError || kpis.isError;

  function recarregar() {
    void fornecedores.refetch();
    void contas.refetch();
    void kpis.refetch();
  }

  const conteudo = (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Vencido</CardTitle>
          </CardHeader>
          <CardContent>
            {kpis.isPending ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <>
                <p className="font-display text-2xl font-semibold tabular-nums tracking-tight text-destructive">
                  {formatCentsToBRL(kpis.data?.vencido_cents ?? 0)}
                </p>
                <p className="text-sm text-muted-foreground">
                  {kpis.data?.vencido_count ?? 0}{" "}
                  {(kpis.data?.vencido_count ?? 0) === 1 ? "conta em atraso" : "contas em atraso"}
                </p>
              </>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Vence em 7 dias</CardTitle>
          </CardHeader>
          <CardContent>
            {kpis.isPending ? (
              <Skeleton className="h-8 w-32" />
            ) : (
              <>
                <p className="font-display text-2xl font-semibold tabular-nums tracking-tight text-foreground">
                  {formatCentsToBRL(kpis.data?.proximos7d_cents ?? 0)}
                </p>
                <p className="text-sm text-muted-foreground">
                  {kpis.data?.proximos7d_count ?? 0}{" "}
                  {(kpis.data?.proximos7d_count ?? 0) === 1 ? "conta a vencer" : "contas a vencer"}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="space-y-2">
          <Label htmlFor="pagar-filtro-status">Estado</Label>
          <select
            id="pagar-filtro-status"
            className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm sm:w-48 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={statusFiltro}
            onChange={(e) => setStatusFiltro(e.target.value as PayableStatus | "")}
          >
            <option value="">Todos</option>
            {PAYABLE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {PAYABLE_STATUS_META[s].rotulo}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="pagar-filtro-fornecedor">Fornecedor</Label>
          <select
            id="pagar-filtro-fornecedor"
            className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm sm:w-56 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={fornecedorFiltro}
            onChange={(e) => setFornecedorFiltro(e.target.value)}
          >
            <option value="">Todos</option>
            {(fornecedores.data ?? []).map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="pagar-filtro-vencimento">Vencimento até</Label>
          <Input
            id="pagar-filtro-vencimento"
            type="date"
            value={vencimentoAte}
            onChange={(e) => setVencimentoAte(e.target.value)}
          />
        </div>
      </div>

      {carregando ? (
        <div className="space-y-2" aria-label="Carregando contas a pagar">
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      ) : erro ? (
        <StatePanel
          titulo="Não foi possível carregar as contas a pagar"
          descricao="Tente novamente. Se o erro continuar, fale com o responsável pelo plano."
        >
          <Button type="button" variant="outline" className="min-h-11" onClick={recarregar}>
            Tentar novamente
          </Button>
        </StatePanel>
      ) : linhas.length === 0 ? (
        <StatePanel
          titulo="Nenhuma conta a pagar aqui"
          descricao="Lance a primeira conta (fornecedor, vencimento e valor) para vê-la nesta lista."
        >
          <Button type="button" className="min-h-11" onClick={() => setLancamentoAberto(true)}>
            Lançar conta
          </Button>
        </StatePanel>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Fornecedor</TableHead>
                <TableHead scope="col">Descrição</TableHead>
                <TableHead scope="col">Vencimento</TableHead>
                <TableHead scope="col" className="text-right">Valor</TableHead>
                <TableHead scope="col">Estado</TableHead>
                <TableHead scope="col">
                  <span className="sr-only">Ações</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((conta) => {
                const meta = PAYABLE_STATUS_META[conta.status];
                const baixavel = conta.status === "pendente" || conta.status === "parcial";
                const cancelavel = conta.status === "pendente";
                return (
                  <TableRow key={conta.id}>
                    <TableCell className="font-medium">
                      {conta.supplier_id ? (fornecedorPorId.get(conta.supplier_id) ?? "Fornecedor") : "—"}
                    </TableCell>
                    <TableCell>
                      {conta.descricao}
                      {conta.categoria ? (
                        <span className="block text-xs font-normal text-muted-foreground">{conta.categoria}</span>
                      ) : null}
                      {conta.recorrencia === "mensal" ? (
                        <span className="block text-xs font-normal text-muted-foreground">Recorrência mensal</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="tabular-nums">{formatarData(conta.vencimento_at)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCentsToBRL(conta.valor_cents)}</TableCell>
                    <TableCell>
                      <Badge variant={meta.variant}>{meta.rotulo}</Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-2">
                        {baixavel ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="min-h-11"
                            aria-label={`Dar baixa em ${conta.descricao}`}
                            onClick={() => setBaixaConta(conta)}
                          >
                            Dar baixa
                          </Button>
                        ) : null}
                        {cancelavel ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="min-h-11"
                            aria-label={`Cancelar ${conta.descricao}`}
                            onClick={() => setCancelarConta(conta)}
                          >
                            Cancelar
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );

  if (!liberado) {
    return (
      <div className="space-y-6">
        <PageHeader
          titulo="Contas a pagar"
          descricao="Fornecedores, vencimentos e baixas parciais em um só lugar."
        />
        <EntitlementGate
          entitled={entitled}
          recurso="Contas a pagar"
          acaoLabel="Lançar conta"
        >
          <StatePanel
            titulo="Contas a pagar disponíveis no plano"
            descricao="O conteúdo gravado continua visível aqui. O lançamento e a baixa são liberados nos planos com esse recurso."
          />
        </EntitlementGate>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Contas a pagar"
        descricao="Fornecedores, vencimentos e baixas parciais em um só lugar."
        acoes={
          <Button type="button" className="min-h-11" onClick={() => setLancamentoAberto(true)}>
            Lançar conta
          </Button>
        }
      />
      {conteudo}
      <BaixaDialog conta={baixaConta} aoFechar={() => setBaixaConta(null)} />
      <CancelarDialog conta={cancelarConta} aoFechar={() => setCancelarConta(null)} />
      <NovoLancamentoDialog aberto={lancamentoAberto} aoAlterarAberto={setLancamentoAberto} />
    </div>
  );
}
