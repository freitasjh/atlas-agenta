import { useMemo, useState } from "react";

import { AssinaturaDrawer } from "@/app/financeiro/assinaturas/AssinaturaDrawer";
import {
  statusAssinaturaMeta,
  statusNaAba,
  type AbaAssinatura,
} from "@/app/financeiro/assinaturas/assinaturaMeta";
import { EntitlementGate } from "@/components/EntitlementGate";
import { PageHeader } from "@/components/PageHeader";
import { StatePanel } from "@/components/StatePanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePlanEntitlements } from "@/hooks/usePlanEntitlements";
import {
  useMembershipCustomers,
  useMembershipPlans,
  useMembershipSubscriptions,
  type AssinaturaLinha,
} from "@/hooks/useMembership";
import { formatCentsToBRL } from "@/lib/money";

function formatarData(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

const ABAS: { valor: AbaAssinatura; rotulo: string }[] = [
  { valor: "ativas", rotulo: "Ativas" },
  { valor: "inadimplentes", rotulo: "Inadimplentes" },
  { valor: "canceladas", rotulo: "Canceladas" },
];

/**
 * Assinaturas (`/app/financeiro/assinaturas`, Fase 5 ADR-05). Admin-only pela
 * rota (`RequireRole admin`) + RLS no banco. Gating `recorrencia`:
 * `false`/`null` → upsell legível e **zero request** a `membership_*`
 * (queries desabilitadas).
 *
 * Tabs Ativas (ativa+pausada)/Inadimplentes/Canceladas; tabela
 * cliente/plano/próxima cobrança/status; drawer por assinatura (histórico,
 * pausar/retomar/cancelar-com-motivo/regularizar, auditoria); banner de
 * inadimplência com contagem.
 */
export function AssinaturasPage() {
  const entitlements = usePlanEntitlements();
  const entitled = entitlements?.recorrencia ?? null;
  const liberado = entitled === true;

  const [aba, setAba] = useState<AbaAssinatura>("ativas");
  const [selecionada, setSelecionada] = useState<AssinaturaLinha | null>(null);

  const planos = useMembershipPlans(liberado);
  const assinaturas = useMembershipSubscriptions(liberado);
  const clientes = useMembershipCustomers(liberado);

  const linhas = useMemo<AssinaturaLinha[]>(() => {
    const subs = assinaturas.data ?? [];
    const planoPorId = new Map((planos.data ?? []).map((p) => [p.id, p]));
    const clientePorId = new Map((clientes.data ?? []).map((c) => [c.id, c]));
    return subs.map((s) => {
      const plano = planoPorId.get(s.plan_id);
      const cliente = clientePorId.get(s.customer_id);
      return {
        subscription: s,
        planName: plano?.name ?? "Plano",
        planAmountCents: plano?.amount_cents ?? 0,
        billingPeriod: plano?.billing_period ?? "mensal",
        customerName: cliente?.name ?? "Cliente",
        customerOptIn: cliente?.whatsapp_opt_in ?? false,
      };
    });
  }, [assinaturas.data, planos.data, clientes.data]);

  const inadimplentes = useMemo(
    () => linhas.filter((l) => l.subscription.status === "inadimplente"),
    [linhas],
  );

  const linhasAba = useMemo(
    () => linhas.filter((l) => statusNaAba(l.subscription.status, aba)),
    [linhas, aba],
  );

  const carregando = planos.isPending || assinaturas.isPending || clientes.isPending;
  const erro = planos.isError || assinaturas.isError || clientes.isError;

  function recarregar() {
    void planos.refetch();
    void assinaturas.refetch();
    void clientes.refetch();
  }

  const conteudo = (
    <>
      {inadimplentes.length > 0 ? (
        <div
          role="alert"
          aria-label={`${inadimplentes.length} ${inadimplentes.length === 1 ? "assinatura inadimplente" : "assinaturas inadimplentes"}`}
          className="rounded-lg border border-destructive/40 bg-destructive/10 p-4"
        >
          <p className="text-sm font-semibold text-foreground">
            {inadimplentes.length}{" "}
            {inadimplentes.length === 1
              ? "assinatura inadimplente precisa de atenção"
              : "assinaturas inadimplentes precisam de atenção"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Abra os detalhes para regularizar a cobrança do ciclo ou reenviar o
            lembrete no WhatsApp (só com opt-in do cliente).
          </p>
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Plano de recorrência</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-6" aria-label="Resumo das assinaturas">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Ativas</p>
              <p className="font-display text-2xl font-semibold tabular-nums tracking-tight text-foreground">
                {linhas.filter((l) => statusNaAba(l.subscription.status, "ativas")).length}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Inadimplentes</p>
              <p className="font-display text-2xl font-semibold tabular-nums tracking-tight text-foreground">
                {inadimplentes.length}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Canceladas</p>
              <p className="font-display text-2xl font-semibold tabular-nums tracking-tight text-foreground">
                {linhas.filter((l) => statusNaAba(l.subscription.status, "canceladas")).length}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs
        value={aba}
        onValueChange={(v) => setAba(v as AbaAssinatura)}
        aria-label="Filtrar assinaturas por estado"
      >
        <TabsList>
          {ABAS.map(({ valor, rotulo }) => (
            <TabsTrigger
              key={valor}
              value={valor}
              className="min-h-11"
              onClick={() => setAba(valor)}
            >
              {rotulo}
            </TabsTrigger>
          ))}
        </TabsList>
        {ABAS.map(({ valor }) => (
          <TabsContent key={valor} value={valor}>
            {carregando ? (
              <div className="space-y-2" aria-label="Carregando assinaturas">
                <Skeleton className="h-11 w-full" />
                <Skeleton className="h-11 w-full" />
                <Skeleton className="h-11 w-full" />
              </div>
            ) : erro ? (
              <StatePanel
                titulo="Não foi possível carregar as assinaturas"
                descricao="Tente novamente. Se o erro continuar, fale com o responsável pelo plano."
              >
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  onClick={recarregar}
                >
                  Tentar novamente
                </Button>
              </StatePanel>
            ) : linhasAba.length === 0 ? (
              <StatePanel
                titulo="Nenhuma assinatura aqui"
                descricao="Quando houver assinaturas neste estado, elas aparecem nesta lista."
              />
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead scope="col">Cliente</TableHead>
                      <TableHead scope="col">Plano</TableHead>
                      <TableHead scope="col">Próxima cobrança</TableHead>
                      <TableHead scope="col">Estado</TableHead>
                      <TableHead scope="col">
                        <span className="sr-only">Ações</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {linhasAba.map((l) => {
                      const meta = statusAssinaturaMeta[l.subscription.status];
                      return (
                        <TableRow key={l.subscription.id}>
                          <TableCell className="font-medium">{l.customerName}</TableCell>
                          <TableCell>
                            {l.planName}
                            <span className="block text-xs font-normal text-muted-foreground">
                              {formatCentsToBRL(l.planAmountCents)} · {l.billingPeriod}
                            </span>
                          </TableCell>
                          <TableCell className="tabular-nums">
                            {formatarData(l.subscription.next_charge_at)}
                          </TableCell>
                          <TableCell>
                            <Badge variant={meta.variant}>{meta.rotulo}</Badge>
                          </TableCell>
                          <TableCell>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="min-h-11"
                              aria-label={`Ver detalhes de ${l.customerName}`}
                              onClick={() => setSelecionada(l)}
                            >
                              Detalhes
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </>
  );

  if (!liberado) {
    return (
      <div className="space-y-6">
        <PageHeader
          titulo="Assinaturas"
          descricao="Planos recorrentes, inadimplência e régua de cobrança."
        />
        <EntitlementGate
          entitled={entitled}
          recurso="Assinaturas"
          acaoLabel="Gerenciar assinaturas"
        >
          <StatePanel
            titulo="Assinaturas disponíveis no plano"
            descricao="O conteúdo gravado continua visível aqui. A operação de recorrência é liberada nos planos com esse recurso."
          />
        </EntitlementGate>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Assinaturas"
        descricao="Planos recorrentes, inadimplência e régua de cobrança."
      />
      {conteudo}
      {selecionada !== null ? (
        <AssinaturaDrawer
          linha={selecionada}
          aberto
          aoAlterarAberto={(v) => {
            if (!v) setSelecionada(null);
          }}
        />
      ) : null}
    </div>
  );
}
