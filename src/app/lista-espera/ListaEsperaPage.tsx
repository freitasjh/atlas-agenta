import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, Clock, Plus } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/PageHeader";
import { EntitlementGate } from "@/components/EntitlementGate";
import { StatePanel } from "@/components/StatePanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { usePlanEntitlements } from "@/hooks/usePlanEntitlements";
import {
  useEnqueueWaitlist,
  useMarkWaitlistAttended,
  useMarkWaitlistExpired,
  useRemoveWaitlistEntry,
  useReorderWaitlistEntry,
  useRespondWaitlistOffer,
  useWaitlistEntries,
} from "@/hooks/useWaitlist";
import { useCustomers } from "@/hooks/useCustomers";
import { useServices } from "@/hooks/useServices";
import { useProfessionals } from "@/hooks/useProfessionals";
import {
  createWaitlistFilter,
  filterWaitlistEntries,
  isActiveStatus,
  priorityLabel,
  sortWaitlistEntries,
  WAITLIST_STATUSES,
  type WaitlistEntry,
  type WaitlistEntryView,
  type WaitlistStatus,
} from "@/app/lista-espera/model";
import { WaitlistEnrollDialog, type WaitlistEnrollValues } from "@/app/lista-espera/WaitlistEnrollDialog";
import { WaitlistOfferDialog } from "@/app/lista-espera/WaitlistOfferDialog";
import {
  formatWaitlistMessage,
  waitlistMessages,
} from "@/app/lista-espera/waitlist-messages";

const messages = waitlistMessages;

function statusVariant(status: WaitlistStatus): "default" | "secondary" | "destructive" | "outline" {
  if (status === "aguardando") return "default";
  if (status === "ofertado") return "secondary";
  if (status === "confirmado" || status === "atendido") return "outline";
  return "destructive";
}

function toView(
  entry: WaitlistEntry,
  names: { customers: Map<string, string>; services: Map<string, string>; professionals: Map<string, string> },
): WaitlistEntryView {
  return {
    ...entry,
    customerName: names.customers.get(entry.customer_id) ?? entry.customer_id,
    serviceName: names.services.get(entry.service_id) ?? entry.service_id,
    professionalName: entry.professional_id
      ? (names.professionals.get(entry.professional_id) ?? entry.professional_id)
      : messages.enroll.anyProfessional,
  };
}

/**
 * Página da lista de espera (`/app/lista-espera`, RF-07..RF-11, UX-SPEC B).
 *
 * Admin/recepção: tabela (desktop) + cards (mobile 375px) com filtros
 * (busca/status/serviço/profissional), inclusão idempotente via
 * `waitlist_enqueue` (replay sem duplicata), oferta com countdown +
 * Confirmar/Recusar via `waitlist_respond`, gestão manual (reordenar via
 * `set_priority`, atendida, expirada, remoção = `cancelado`) e gating
 * `waitlist` (sem entitlement: upsell, zero request sensível — queries com
 * `enabled`).
 */
export function ListaEsperaPage() {
  const entitlements = usePlanEntitlements();
  const entitled = entitlements?.waitlist === true;

  const entriesQuery = useWaitlistEntries({ enabled: entitled });
  const customersQuery = useCustomers({ activeOnly: false });
  const servicesQuery = useServices();
  const professionalsQuery = useProfessionals({ activeOnly: true });

  const enqueue = useEnqueueWaitlist();
  const respond = useRespondWaitlistOffer();
  const markAttended = useMarkWaitlistAttended();
  const markExpired = useMarkWaitlistExpired();
  const removeEntry = useRemoveWaitlistEntry();
  const reorder = useReorderWaitlistEntry();

  const [filter, setFilter] = useState(createWaitlistFilter);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [offerId, setOfferId] = useState<string | null>(null);

  const names = useMemo(() => {
    const customers = new Map((customersQuery.data ?? []).map((c) => [c.id, c.name]));
    const services = new Map((servicesQuery.data ?? []).map((s) => [s.id, s.name]));
    const professionals = new Map((professionalsQuery.data ?? []).map((p) => [p.id, p.name]));
    return { customers, services, professionals };
  }, [customersQuery.data, servicesQuery.data, professionalsQuery.data]);

  const views = useMemo(
    () => sortWaitlistEntries((entriesQuery.data ?? []).map((e) => toView(e, names))),
    [entriesQuery.data, names],
  );
  const visible = useMemo(() => filterWaitlistEntries(views, filter), [views, filter]);

  const offerEntry = offerId ? views.find((e) => e.id === offerId) ?? null : null;

  const isLoading = entriesQuery.isLoading;
  const isError = entriesQuery.isError;
  const responding = respond.isPending;

  async function handleEnroll(values: WaitlistEnrollValues) {
    try {
      const { created } = await enqueue.mutateAsync({
        customer_id: values.customer_id,
        service_id: values.service_id,
        professional_id: values.professional_id || null,
        desired_start_from: values.desired_start_from,
        desired_start_to: values.desired_start_to,
        priority: values.priority,
        expires_at: values.expires_at || null,
      });
      toast.success(created ? messages.enroll.success : messages.enroll.duplicate);
      setEnrollOpen(false);
    } catch {
      toast.error(messages.enroll.error);
    }
  }

  async function handleRespond(accept: boolean) {
    if (!offerEntry) return;
    try {
      const result = await respond.mutateAsync({ id: offerEntry.id, accept });
      if (result.expired) {
        toast.warning(messages.offer.expiredDescription);
      } else {
        toast.success(accept ? messages.offer.confirmed : messages.offer.declined);
      }
      setOfferId(null);
    } catch {
      toast.error(messages.offer.error);
    }
  }

  async function handleExpire() {
    if (!offerEntry || offerEntry.status !== "ofertado") return;
    // Expiração lazy: o RPC marca `expirado` e repassa ao próximo.
    await markExpired.mutateAsync(offerEntry.id).catch(() => undefined);
  }

  async function handleAttended(id: string) {
    try {
      await markAttended.mutateAsync(id);
      toast.success(messages.manage.attendedSuccess);
    } catch {
      toast.error(messages.manage.error);
    }
  }

  async function handleRemove(id: string) {
    try {
      await removeEntry.mutateAsync(id);
      toast.success(messages.manage.removedSuccess);
    } catch {
      toast.error(messages.manage.error);
    }
  }

  async function handleExpireEntry(id: string) {
    try {
      await markExpired.mutateAsync(id);
      toast.success(messages.manage.expiredSuccess);
    } catch {
      toast.error(messages.manage.error);
    }
  }

  async function handleReorder(id: string, priority: number) {
    const clamped = Math.min(3, Math.max(1, priority));
    try {
      await reorder.mutateAsync({ id, priority: clamped });
      toast.success(messages.manage.reordered);
    } catch {
      toast.error(messages.manage.error);
    }
  }

  const t = messages.page;

  function rowActions(entry: WaitlistEntryView, compact: boolean) {
    const buttons = (
      <>
        <Button
          variant="ghost"
          size={compact ? "sm" : "icon"}
          aria-label={formatWaitlistMessage(t.reorderUpAria, { cliente: entry.customerName })}
          onClick={() => void handleReorder(entry.id, entry.priority + 1)}
        >
          <ArrowUp className="h-4 w-4" aria-hidden="true" />
          {compact ? t.reorderUp : null}
        </Button>
        <Button
          variant="ghost"
          size={compact ? "sm" : "icon"}
          aria-label={formatWaitlistMessage(t.reorderDownAria, { cliente: entry.customerName })}
          onClick={() => void handleReorder(entry.id, entry.priority - 1)}
        >
          <ArrowDown className="h-4 w-4" aria-hidden="true" />
          {compact ? t.reorderDown : null}
        </Button>
        {entry.status === "ofertado" ? (
          <>
            <Button
              variant="outline"
              size="sm"
              aria-label={formatWaitlistMessage(t.viewOfferAria, { cliente: entry.customerName })}
              onClick={() => setOfferId(entry.id)}
            >
              <Clock className="h-4 w-4" aria-hidden="true" />
              {t.viewOffer}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={formatWaitlistMessage(t.markExpiredAria, { cliente: entry.customerName })}
              onClick={() => void handleExpireEntry(entry.id)}
            >
              {t.markExpired}
            </Button>
          </>
        ) : null}
        {isActiveStatus(entry.status) ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              aria-label={formatWaitlistMessage(t.markAttendedAria, { cliente: entry.customerName })}
              onClick={() => void handleAttended(entry.id)}
            >
              {t.markAttended}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={formatWaitlistMessage(t.removeAria, { cliente: entry.customerName })}
              onClick={() => void handleRemove(entry.id)}
            >
              {t.remove}
            </Button>
          </>
        ) : null}
      </>
    );
    return compact ? (
      <div className="mt-3 flex min-h-[44px] flex-wrap gap-2">{buttons}</div>
    ) : (
      <div className="flex justify-end gap-1">{buttons}</div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        titulo={t.title}
        descricao={t.description}
        acoes={
          <Button onClick={() => setEnrollOpen(true)} disabled={!entitled}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t.newEntry}
          </Button>
        }
      />

      <EntitlementGate
        entitled={entitled}
        recurso={messages.gating.resource}
        acaoLabel={messages.gating.action}
      >
        {/* Filtros */}
        <div
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
          role="search"
          aria-label={t.filtersTitle}
        >
          <div className="space-y-1">
            <Label htmlFor="waitlist-search">{t.searchLabel}</Label>
            <Input
              id="waitlist-search"
              placeholder={t.searchPlaceholder}
              value={filter.search}
              onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="waitlist-status">{t.statusLabel}</Label>
            <Select
              value={filter.status}
              onValueChange={(v) => setFilter((f) => ({ ...f, status: v as WaitlistStatus | "todas" }))}
            >
              <SelectTrigger id="waitlist-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">{t.allStatuses}</SelectItem>
                {WAITLIST_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {messages.status[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="waitlist-service">{t.serviceLabel}</Label>
            <Select
              value={filter.serviceId}
              onValueChange={(v) => setFilter((f) => ({ ...f, serviceId: v }))}
            >
              <SelectTrigger id="waitlist-service">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">{t.allServices}</SelectItem>
                {(servicesQuery.data ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="waitlist-professional">{t.professionalLabel}</Label>
            <Select
              value={filter.professionalId}
              onValueChange={(v) => setFilter((f) => ({ ...f, professionalId: v }))}
            >
              <SelectTrigger id="waitlist-professional">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">{t.allProfessionals}</SelectItem>
                {(professionalsQuery.data ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2" aria-busy="true" aria-label={t.loading}>
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : isError ? (
          <StatePanel titulo={t.errorTitle} descricao={t.errorDescription}>
            <Button variant="outline" onClick={() => void entriesQuery.refetch()}>
              {t.retry}
            </Button>
          </StatePanel>
        ) : visible.length === 0 ? (
          <StatePanel titulo={t.emptyTitle} descricao={t.emptyDescription} />
        ) : (
          <>
            {/* Tabela (desktop) */}
            <div className="hidden rounded-lg border border-border md:block">
              <Table>
                <caption className="px-4 py-2 text-left text-sm text-muted-foreground">
                  {t.tableCaption}
                </caption>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">{t.colCustomer}</TableHead>
                    <TableHead scope="col">{t.colService}</TableHead>
                    <TableHead scope="col">{t.colProfessional}</TableHead>
                    <TableHead scope="col">{t.colPriority}</TableHead>
                    <TableHead scope="col">{t.colValidUntil}</TableHead>
                    <TableHead scope="col">{t.colStatus}</TableHead>
                    <TableHead scope="col" className="text-right">{t.colActions}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="font-medium text-foreground">
                        {entry.customerName}
                      </TableCell>
                      <TableCell>{entry.serviceName}</TableCell>
                      <TableCell>{entry.professionalName}</TableCell>
                      <TableCell>
                        <Badge variant={entry.priority >= 3 ? "destructive" : entry.priority === 2 ? "secondary" : "outline"}>
                          {messages.priority[priorityLabel(entry.priority)]}
                        </Badge>
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {entry.expires_at ?? t.noValidity}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(entry.status)}>
                          {messages.status[entry.status]}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {rowActions(entry, false)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Cards (mobile) */}
            <ul className="space-y-3 md:hidden">
              {visible.map((entry) => (
                <li
                  key={entry.id}
                  className="rounded-lg border border-border p-4"
                  aria-label={`${entry.customerName} · ${messages.status[entry.status]}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="font-medium text-foreground">{entry.customerName}</p>
                      <p className="text-sm text-muted-foreground">
                        {entry.serviceName} · {entry.professionalName}
                      </p>
                    </div>
                    <Badge variant={statusVariant(entry.status)}>
                      {messages.status[entry.status]}
                    </Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge variant="outline">
                      {messages.priority[priorityLabel(entry.priority)]}
                    </Badge>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {entry.expires_at ?? t.noValidity}
                    </span>
                  </div>
                  {rowActions(entry, true)}
                </li>
              ))}
            </ul>
          </>
        )}
      </EntitlementGate>

      <WaitlistEnrollDialog
        open={enrollOpen}
        onOpenChange={setEnrollOpen}
        messages={messages}
        customers={(customersQuery.data ?? []).map((c) => ({ id: c.id, name: c.name }))}
        services={(servicesQuery.data ?? []).map((s) => ({ id: s.id, name: s.name }))}
        professionals={(professionalsQuery.data ?? []).map((p) => ({ id: p.id, name: p.name }))}
        submitting={enqueue.isPending}
        onSubmit={(values) => void handleEnroll(values)}
      />

      <WaitlistOfferDialog
        open={offerEntry !== null}
        onOpenChange={(open) => {
          if (!open) setOfferId(null);
        }}
        messages={messages}
        customerName={offerEntry?.customerName ?? ""}
        slotLabel={offerEntry ? `${offerEntry.serviceName} · ${offerEntry.professionalName}` : ""}
        expiresAt={offerEntry?.offer_expires_at ?? null}
        confirming={responding}
        declining={responding}
        onConfirm={() => void handleRespond(true)}
        onDecline={() => void handleRespond(false)}
        onExpire={() => void handleExpire()}
      />

      <p className="text-sm text-muted-foreground">
        <Link to="/app/agenda" className="underline underline-offset-4">
          {messages.cta.backToAgenda}
        </Link>
      </p>
    </div>
  );
}
