import { useMemo, useState } from "react";

import { CancelarRecebivelDialog } from "@/app/financeiro/receber/CancelarRecebivelDialog";
import { StatePanel } from "@/components/StatePanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { useCustomers } from "@/hooks/useCustomers";
import { useCancelReceivableCharge, useReceivables } from "@/hooks/useReceivables";
import { formatCentsToBRL } from "@/lib/money";
import {
  progressoRecebido,
  receivableChargeExpired,
  receivableHasActiveCharge,
  receivableVencida,
  RECEBIVEL_STATUSES,
  RECEBIVEL_STATUS_META,
  type Receivable,
  type RecebivelStatus,
} from "@/lib/receber";

function formatarData(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Barra pago vs total com leitura acessível (RF-20). */
function BarraRecebimento({ valorCents, recebidoCents }: { valorCents: number; recebidoCents: number }) {
  const pct = progressoRecebido(valorCents, recebidoCents);
  return (
    <div className="min-w-32 space-y-1">
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={`Recebido ${formatCentsToBRL(recebidoCents)} de ${formatCentsToBRL(valorCents)} (${pct}%)`}
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
      >
        <div
          className="h-2 rounded-full bg-primary transition-[width] motion-reduce:transition-none"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs tabular-nums text-muted-foreground">
        {formatCentsToBRL(recebidoCents)} de {formatCentsToBRL(valorCents)} · {pct}%
      </p>
    </div>
  );
}

interface AvulsasTabProps {
  onCobrar: (conta: Receivable) => void;
  onReceber: (conta: Receivable) => void;
  onNova: () => void;
}

/**
 * Aba Avulsas (ADR-07 RF-19/20/21): cobrança fora do ledger, categoria própria
 * (`avulsa`, consumida pelo DRE em ADR-09). Tabela com cliente, descrição,
 * vencimento, estado, barra pago vs total e ações cobrar/receber/cancelar.
 *
 * Regra de ouro do PIX vivo: com `asaas_payment_id` a conta só é baixada pelo
 * webhook do gateway. Por isso "Receber" e "Cancelar" somem e aparece "Cancelar
 * PIX" (Edge `cancel-receivable-charge`), que devolve a conta ao estado sem
 * cobrança — evita registrar 10k numa conta cujo PIX de 14k o cliente pagou.
 *
 * Filtros são client-side (computed) — a lista já vem limitada pelo RLS admin.
 */
export function AvulsasTab({ onCobrar, onReceber, onNova }: AvulsasTabProps) {
  const [statusFiltro, setStatusFiltro] = useState<RecebivelStatus | "">("");
  const [busca, setBusca] = useState("");
  const [cancelar, setCancelar] = useState<Receivable | null>(null);
  const [cancelandoPix, setCancelandoPix] = useState<string | null>(null);
  const [erroPix, setErroPix] = useState<string | null>(null);

  const contas = useReceivables(true);
  const clientes = useCustomers({ enabled: true });
  const cancelarPix = useCancelReceivableCharge();

  const clientePorId = useMemo(
    () => new Map((clientes.data ?? []).map((c) => [c.id, c.name])),
    [clientes.data],
  );

  const linhas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return (contas.data ?? []).filter((conta) => {
      if (statusFiltro !== "" && conta.status !== statusFiltro) return false;
      if (termo === "") return true;
      const cliente = (clientePorId.get(conta.customer_id) ?? "").toLowerCase();
      return conta.descricao.toLowerCase().includes(termo) || cliente.includes(termo);
    });
  }, [contas.data, statusFiltro, busca, clientePorId]);

  const carregando = contas.isPending;
  const erro = contas.isError;

  async function acionarCancelamentoPix(conta: Receivable) {
    setErroPix(null);
    setCancelandoPix(conta.id);
    try {
      await cancelarPix.mutateAsync({ receivable_id: conta.id });
    } catch (e) {
      setErroPix(e instanceof Error ? e.message : "Não foi possível cancelar o PIX.");
    } finally {
      setCancelandoPix(null);
    }
  }

  if (carregando) {
    return (
      <div className="space-y-2" aria-label="Carregando contas a receber avulsas">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    );
  }

  if (erro) {
    return (
      <StatePanel
        titulo="Não foi possível carregar as cobranças avulsas"
        descricao="Tente novamente. Nenhum valor do ledger foi tocado."
      >
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          onClick={() => {
            void contas.refetch();
          }}
        >
          Tentar novamente
        </Button>
      </StatePanel>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="space-y-2">
          <Label htmlFor="receber-filtro-status">Estado</Label>
          <select
            id="receber-filtro-status"
            className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm sm:w-44 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={statusFiltro}
            onChange={(e) => setStatusFiltro(e.target.value as RecebivelStatus | "")}
          >
            <option value="">Todos</option>
            {RECEBIVEL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {RECEBIVEL_STATUS_META[s].rotulo}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-2 sm:min-w-64">
          <Label htmlFor="receber-filtro-busca">Buscar</Label>
          <Input
            id="receber-filtro-busca"
            type="search"
            placeholder="Cliente ou descrição"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>
      </div>

      {erroPix ? (
        <p role="alert" className="text-sm text-destructive">
          {erroPix}
        </p>
      ) : null}

      {linhas.length === 0 ? (
        <StatePanel
          titulo="Nenhuma cobrança avulsa aqui"
          descricao="Crie a primeira cobrança com cliente, valor e vencimento. Ela não entra no ledger de atendimentos."
        >
          <Button type="button" className="min-h-11" onClick={onNova}>
            Nova cobrança
          </Button>
        </StatePanel>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Cliente</TableHead>
                <TableHead scope="col">Descrição</TableHead>
                <TableHead scope="col">Vencimento</TableHead>
                <TableHead scope="col">Recebido</TableHead>
                <TableHead scope="col">Estado</TableHead>
                <TableHead scope="col">
                  <span className="sr-only">Ações</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {linhas.map((conta) => {
                const recebido = conta.recebido_cents;
                const meta = RECEBIVEL_STATUS_META[conta.status];
                const vencida = receivableVencida(conta);
                const pixVivo = receivableHasActiveCharge(conta);
                const pixExpirado = pixVivo && receivableChargeExpired(conta);
                const podeCobrar = conta.status === "pendente";
                // Com PIX vivo a baixa manual fica bloqueada (a RPC recusa).
                const podeReceber =
                  !pixVivo && (conta.status === "pendente" || conta.status === "parcial");
                const podeCancelar = conta.status === "pendente" && !pixVivo;
                const cancelando = cancelandoPix === conta.id;
                return (
                  <TableRow key={conta.id}>
                    <TableCell className="font-medium">
                      {clientePorId.get(conta.customer_id) ?? "Cliente"}
                    </TableCell>
                    <TableCell>
                      {conta.descricao}
                      <span className="block text-xs font-normal text-muted-foreground">
                        Categoria: {conta.categoria}
                      </span>
                      {pixVivo ? (
                        <span className="block text-xs font-normal text-muted-foreground">
                          {pixExpirado ? "PIX expirado — gere um novo" : "PIX em aberto"}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="tabular-nums">{formatarData(conta.vencimento_at)}</TableCell>
                    <TableCell>
                      <BarraRecebimento valorCents={conta.valor_cents} recebidoCents={recebido} />
                    </TableCell>
                    <TableCell>
                      {vencida ? (
                        <Badge variant="destructive">Vencida</Badge>
                      ) : (
                        <Badge variant={meta.variant}>{meta.rotulo}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        {podeCobrar ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="min-h-11"
                            aria-label={`Cobrar ${conta.descricao}`}
                            onClick={() => onCobrar(conta)}
                          >
                            {pixExpirado ? "Gerar novo PIX" : "Cobrar"}
                          </Button>
                        ) : null}
                        {pixVivo ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="min-h-11"
                            aria-label={`Cancelar PIX de ${conta.descricao}`}
                            disabled={cancelando}
                            onClick={() => void acionarCancelamentoPix(conta)}
                          >
                            {cancelando ? "Cancelando…" : "Cancelar PIX"}
                          </Button>
                        ) : null}
                        {podeReceber ? (
                          <Button
                            type="button"
                            size="sm"
                            className="min-h-11"
                            aria-label={`Registrar recebimento de ${conta.descricao}`}
                            onClick={() => onReceber(conta)}
                          >
                            Receber
                          </Button>
                        ) : null}
                        {podeCancelar ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="min-h-11"
                            aria-label={`Cancelar ${conta.descricao}`}
                            onClick={() => setCancelar(conta)}
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

      <p className="text-sm text-muted-foreground">
        Cobranças avulsas ficam fora do ledger de atendimento e entram no DRE pela
        categoria própria. Conta com PIX em aberto só é baixada pelo pagamento do
        gateway: cancele o PIX antes de registrar recebimento manual.
      </p>

      <CancelarRecebivelDialog conta={cancelar} aoFechar={() => setCancelar(null)} />
    </div>
  );
}
