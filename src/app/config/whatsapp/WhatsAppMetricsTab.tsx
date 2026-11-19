import { useMemo, useState } from "react";

import { StatePanel } from "@/components/StatePanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { WhatsAppStatusBadge } from "@/components/WhatsAppStatusBadge";
import {
  EMPTY_LOG_FILTER,
  filterMessageLog,
  useWhatsAppMetrics,
  type MessageLogFilter,
} from "@/hooks/useWhatsAppMetrics";
import { useCustomers } from "@/hooks/useCustomers";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { formatDateInTenantTz, formatTimeInTenantTz } from "@/lib/datetime";
import {
  getMessageTemplateLabel,
  getMessageStatusLabel,
} from "@/lib/whatsapp";
import { MESSAGE_STATUSES, MESSAGE_TEMPLATES } from "@/types/domain";
import { whatsappMetricasMessages } from "@/app/config/whatsapp/whatsapp-metricas-messages";

const t = whatsappMetricasMessages;

function MetricTile({
  rotulo,
  valor,
  nota,
}: {
  rotulo: string;
  valor: string;
  nota?: string;
}) {
  return (
    <div
      role="group"
      aria-label={`${rotulo}: ${valor}`}
      className="rounded-lg border border-border p-3"
    >
      <p className="text-xs font-medium text-muted-foreground">{rotulo}</p>
      <p className="font-display text-2xl font-semibold tabular-nums tracking-tight text-foreground">
        {valor}
      </p>
      {nota ? (
        <p className="mt-1 text-xs text-muted-foreground">{nota}</p>
      ) : null}
    </div>
  );
}

function percent(value: number | null): string {
  if (value === null) return t.kpis.unavailable;
  return `${(value * 100).toFixed(1).replace(".", ",")}%`;
}

function banVariant(level: "baixo" | "atencao" | "alto") {
  switch (level) {
    case "alto":
      return "destructive" as const;
    case "atencao":
      return "outline" as const;
    case "baixo":
      return "secondary" as const;
  }
}

/**
 * Aba Métricas do WhatsApp (RF-40): KPIs do canal, risco de ban e log
 * filtrável por status/mensagem/busca. Leitura sob RLS, projeção sem PII (o
 * nome do cliente vem do mapa de `useCustomers`; telefone nunca exibido).
 * Admin only — a negação vive no `WhatsAppPage`; aqui, só conteúdo autorizado.
 */
export function WhatsAppMetricsTab() {
  const { tenant } = useCurrentUser();
  const timeZone = tenant?.timezone ?? "America/Sao_Paulo";
  const metrics = useWhatsAppMetrics(100);
  const customersQuery = useCustomers();

  const [filter, setFilter] = useState<MessageLogFilter>(EMPTY_LOG_FILTER);

  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const customer of customersQuery.data ?? []) {
      map.set(customer.id, customer.name);
    }
    return map;
  }, [customersQuery.data]);

  const visible = useMemo(
    () =>
      filterMessageLog(metrics.messages, filter, (id) => nameById.get(id) ?? ""),
    [metrics.messages, filter, nameById],
  );

  const { kpis, banRisk } = metrics;

  return (
    <div className="space-y-6">
      <Card aria-label={t.kpis.title}>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base">{t.kpis.title}</CardTitle>
              <CardDescription>{t.kpis.description}</CardDescription>
            </div>
            <Badge variant={banVariant(banRisk.level)}>
              {t.ban.title}: {t.ban[banRisk.level]}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {metrics.isLoading ? (
            <div
              className="grid grid-cols-2 gap-2 sm:grid-cols-4"
              aria-busy="true"
              aria-label={t.kpis.loading}
            >
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : metrics.isError ? (
            <StatePanel
              titulo={t.kpis.errorTitle}
              descricao={t.kpis.errorDescription}
            >
              <Button variant="outline" onClick={() => metrics.refetch()}>
                {t.kpis.retry}
              </Button>
            </StatePanel>
          ) : kpis.total === 0 ? (
            <StatePanel
              titulo={t.kpis.emptyTitle}
              descricao={t.kpis.emptyDescription}
            />
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <MetricTile rotulo={t.kpis.enviadas} valor={String(kpis.enviadas)} />
                <MetricTile rotulo={t.kpis.entregues} valor={String(kpis.entregues)} />
                <MetricTile rotulo={t.kpis.falhas} valor={String(kpis.falhas)} />
                <MetricTile rotulo={t.kpis.pendentes} valor={String(kpis.pendentes)} />
                <MetricTile
                  rotulo={t.kpis.taxaEntrega}
                  valor={percent(kpis.taxaEntrega)}
                />
                <MetricTile
                  rotulo={t.kpis.taxaFalha}
                  valor={percent(kpis.taxaFalha)}
                />
                <MetricTile
                  rotulo={t.kpis.lidas}
                  valor={t.kpis.unavailable}
                  nota="em breve"
                />
                <MetricTile
                  rotulo={t.kpis.respostas}
                  valor={t.kpis.unavailable}
                  nota="em breve"
                />
              </div>
              <p className="text-xs text-muted-foreground">{t.kpis.partialNote}</p>
              <p className="text-sm text-muted-foreground" role="note">
                {banRisk.recomendacao}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card aria-label={t.log.title}>
        <CardHeader>
          <CardTitle className="text-base">{t.log.title}</CardTitle>
          <CardDescription>{t.log.description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="metricas-status">{t.log.statusLabel}</Label>
              <Select
                value={filter.status}
                onValueChange={(value) =>
                  setFilter((prev) => ({
                    ...prev,
                    status: value as MessageLogFilter["status"],
                  }))
                }
              >
                <SelectTrigger id="metricas-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">{t.log.all}</SelectItem>
                  {MESSAGE_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {getMessageStatusLabel(status)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="metricas-template">{t.log.templateLabel}</Label>
              <Select
                value={filter.template}
                onValueChange={(value) =>
                  setFilter((prev) => ({
                    ...prev,
                    template: value as MessageLogFilter["template"],
                  }))
                }
              >
                <SelectTrigger id="metricas-template">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">{t.log.allTemplates}</SelectItem>
                  {MESSAGE_TEMPLATES.map((template) => (
                    <SelectItem key={template} value={template}>
                      {getMessageTemplateLabel(template)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="metricas-busca">{t.log.searchLabel}</Label>
              <Input
                id="metricas-busca"
                placeholder={t.log.searchPlaceholder}
                value={filter.busca}
                onChange={(event) =>
                  setFilter((prev) => ({ ...prev, busca: event.target.value }))
                }
              />
            </div>
          </div>

          {visible.length === 0 ? (
            <StatePanel
              titulo={t.log.emptyTitle}
              descricao={t.log.emptyDescription}
            />
          ) : (
            <>
              <div className="hidden rounded-lg border border-border md:block">
                <Table>
                  <caption className="px-4 py-2 text-left text-sm text-muted-foreground">
                    {t.log.caption}
                  </caption>
                  <TableHeader>
                    <TableRow>
                      <TableHead scope="col">{t.log.colCliente}</TableHead>
                      <TableHead scope="col">{t.log.colMensagem}</TableHead>
                      <TableHead scope="col">{t.log.colStatus}</TableHead>
                      <TableHead scope="col">{t.log.colQuando}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visible.map((message) => (
                      <TableRow key={message.id}>
                        <TableCell className="font-medium text-foreground">
                          {nameById.get(message.customer_id) ?? "Cliente"}
                        </TableCell>
                        <TableCell>
                          {getMessageTemplateLabel(message.template)}
                        </TableCell>
                        <TableCell>
                          <WhatsAppStatusBadge messageStatus={message.status} />
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDateInTenantTz(message.created_at, timeZone)}{" "}
                          às{" "}
                          {formatTimeInTenantTz(message.created_at, timeZone)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <ul className="space-y-3 md:hidden">
                {visible.map((message) => (
                  <li
                    key={message.id}
                    className="rounded-lg border border-border p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="font-medium text-foreground">
                          {nameById.get(message.customer_id) ?? "Cliente"}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {getMessageTemplateLabel(message.template)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatDateInTenantTz(message.created_at, timeZone)}{" "}
                          às{" "}
                          {formatTimeInTenantTz(message.created_at, timeZone)}
                        </p>
                      </div>
                      <WhatsAppStatusBadge messageStatus={message.status} />
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
