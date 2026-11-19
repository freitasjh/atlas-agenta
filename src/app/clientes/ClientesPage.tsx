import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import { Loader2, MessageCircle, Package, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/PageHeader";
import { SendMessageDialog } from "@/app/whatsapp/SendMessageDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

import { CustomerFormDialog } from "@/app/clientes/CustomerFormDialog";
import { CustomerCrmFilters } from "@/app/clientes/CustomerCrmFilters";
import { CustomerDrawer } from "@/app/clientes/CustomerDrawer";
import { crmMessages } from "@/app/clientes/crm-messages";
import { filterCrmCustomers, type CrmCustomerRow } from "@/app/clientes/crm-model";
import { SellPackageDialog } from "@/app/config/pacotes/SellPackageDialog";
import { useCustomers, useDeactivateCustomer } from "@/hooks/useCustomers";
import { usePermissions } from "@/hooks/usePermissions";
import { formatPhoneForDisplay } from "@/lib/phone";
import type { Customer } from "@/types/domain";

/** Painel de estado (vazio/erro) desta tela, no mesmo molde da tela de Serviços. */
function StatePanel({
  titulo,
  descricao,
  children,
}: {
  titulo: string;
  descricao: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-2xl rounded-lg border border-dashed border-border p-8 text-center">
      <h2 className="font-display text-lg font-semibold tracking-tight">
        {titulo}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{descricao}</p>
      {children ? (
        <div className="mt-4 flex justify-center">{children}</div>
      ) : null}
    </div>
  );
}

function OptInBadge({ optIn }: { optIn: boolean }) {
  return (
    <Badge variant={optIn ? "secondary" : "outline"}>
      WhatsApp: {optIn ? "sim" : "não"}
    </Badge>
  );
}

/**
 * Ação "Enviar mensagem" por cliente (Agenda e Clientes compartilham o diálogo).
 * Opt-in na borda: sem consentimento, o botão fica desabilitado com o motivo em
 * texto (não só `disabled`) — defesa dupla; a trava real é o servidor.
 */
function SendMessageButton({
  customer,
  onSend,
}: {
  customer: Customer;
  onSend: (customer: Customer) => void;
}) {
  const optIn = customer.whatsapp_opt_in;
  return (
    <div className="inline-flex flex-col items-start">
      <Button
        variant="ghost"
        size="sm"
        disabled={!optIn}
        title={
          optIn
            ? undefined
            : "Este cliente não autorizou receber mensagens no WhatsApp."
        }
        onClick={() => onSend(customer)}
      >
        <MessageCircle aria-hidden="true" />
        Enviar mensagem
      </Button>
      {!optIn ? (
        <span className="sr-only">
          Este cliente não autorizou receber mensagens no WhatsApp.
        </span>
      ) : null}
    </div>
  );
}

/** Valor com debounce leve para a busca client-side (não refaz request). */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

/** Remove acentos e caixa para a busca ser tolerante a digitação. */
function normalizeForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Tela de Clientes (`/app/clientes`): lista os clientes do tenant, cria/edita
 * por diálogo e inativa com confirmação (soft-delete — nunca DELETE físico). No
 * desktop é tabela; no mobile vira cards (sem overflow horizontal). Os botões de
 * escrita só aparecem para quem pode gerenciar clientes
 * (`usePermissions().canManageCustomers`) — defesa em profundidade; a trava real
 * é o RLS. A busca por nome/telefone é client-side (filtra a lista carregada,
 * sem paginação de servidor nesta fase).
 */
export function ClientesPage() {
  const { canManageCustomers, canSendWhatsAppMessage } = usePermissions();
  const customersQuery = useCustomers({ activeOnly: true });
  const deactivateCustomer = useDeactivateCustomer();

  const [formOpen, setFormOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [customerToDeactivate, setCustomerToDeactivate] =
    useState<Customer | null>(null);
  const [messageTarget, setMessageTarget] = useState<Customer | null>(null);
  const [packageTarget, setPackageTarget] = useState<Customer | null>(null);

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search, 150);
  const [fichaCustomer, setFichaCustomer] = useState<Customer | null>(null);
  const [crmFilter, setCrmFilter] = useState({ tag: "", segment: "", minNoShow: 0 });

  function openCreate() {
    setEditingCustomer(null);
    setFormOpen(true);
  }

  function openEdit(customer: Customer) {
    setEditingCustomer(customer);
    setFormOpen(true);
  }

  async function confirmDeactivate() {
    if (!customerToDeactivate) return;
    try {
      await deactivateCustomer.mutateAsync({
        id: customerToDeactivate.id,
        active: false,
      });
      toast.success("Cliente removido.");
      setCustomerToDeactivate(null);
    } catch {
      toast.error("Não foi possível remover o cliente. Tente novamente.");
    }
  }

  const customers = customersQuery.data ?? [];

  const availableTags = useMemo(() => {
    const set = new Set<string>();
    for (const customer of customers) {
      const tags = (customer as unknown as { tags?: unknown }).tags;
      if (Array.isArray(tags)) {
        for (const tag of tags) {
          if (typeof tag === "string" && tag.trim() !== "") set.add(tag);
        }
      }
    }
    return [...set].sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [customers]);

  const filteredCustomers = useMemo(() => {
    // Filtros CRM (RF-29) centralizados em `filterCrmCustomers`: tag/segmento/no-show.
    // Sem contagem de no-show no payload da lista, `noShowCount` cai para 0 —
    // o caminho servidor é o RPC `customer_filter` (ADR-08).
    const crmRows: CrmCustomerRow[] = customers.map((customer) => {
      const raw = customer as unknown as { tags?: unknown; segment?: unknown };
      const tags = Array.isArray(raw.tags)
        ? raw.tags.filter((tag): tag is string => typeof tag === "string")
        : [];
      return {
        id: customer.id,
        name: customer.name,
        tags,
        segment: typeof raw.segment === "string" ? raw.segment : null,
        noShowCount: 0,
      };
    });
    const allowedIds = new Set(filterCrmCustomers(crmRows, crmFilter).map((row) => row.id));
    const term = normalizeForSearch(debouncedSearch.trim());
    return customers.filter((customer) => {
      if (!allowedIds.has(customer.id)) return false;
      const nameMatch = term === "" || normalizeForSearch(customer.name).includes(term);
      const termDigits = term.replace(/\D/g, "");
      const phoneMatch =
        term === "" ||
        nameMatch ||
        (termDigits !== "" && customer.phone.replace(/\D/g, "").includes(termDigits));
      return nameMatch || phoneMatch;
    });
  }, [customers, debouncedSearch, crmFilter]);

  const hasCustomers = customers.length > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Clientes"
        descricao="Quem a sua empresa atende: contato e consentimento de WhatsApp."
        acoes={
          canManageCustomers ? (
            <Button onClick={openCreate}>
              <Plus aria-hidden="true" />
              Novo cliente
            </Button>
          ) : undefined
        }
      />

      {customersQuery.isLoading ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : customersQuery.isError ? (
        <StatePanel
          titulo="Não foi possível carregar os clientes"
          descricao="Verifique sua conexão e tente novamente."
        >
          <Button
            variant="outline"
            onClick={() => void customersQuery.refetch()}
          >
            Tentar novamente
          </Button>
        </StatePanel>
      ) : !hasCustomers ? (
        <StatePanel
          titulo="Nenhum cliente cadastrado"
          descricao={
            canManageCustomers
              ? "Cadastre o primeiro cliente para começar a agendar atendimentos."
              : "Ainda não há clientes cadastrados."
          }
        >
          {canManageCustomers ? (
            <Button onClick={openCreate}>
              <Plus aria-hidden="true" />
              Novo cliente
            </Button>
          ) : null}
        </StatePanel>
      ) : (
        <>
          <div className="max-w-sm">
            <label htmlFor="busca-clientes" className="sr-only">
              Buscar por nome ou telefone
            </label>
            <Input
              id="busca-clientes"
              type="search"
              inputMode="search"
              placeholder="Buscar por nome ou telefone"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <CustomerCrmFilters value={crmFilter} onChange={setCrmFilter} tags={availableTags} />

          {filteredCustomers.length === 0 ? (
            <StatePanel
              titulo="Nenhum cliente encontrado"
              descricao="Ajuste a busca por nome ou telefone."
            />
          ) : (
            <>
              {/* Desktop: tabela com rolagem horizontal em telas estreitas */}
              <div className="hidden overflow-x-auto rounded-lg border border-border md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome</TableHead>
                      <TableHead>Telefone</TableHead>
                      <TableHead>E-mail</TableHead>
                      <TableHead>WhatsApp</TableHead>
                      {canManageCustomers || canSendWhatsAppMessage ? (
                        <TableHead className="text-right">Ações</TableHead>
                      ) : null}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredCustomers.map((customer) => (
                      <TableRow key={customer.id}>
                        <TableCell className="font-medium text-foreground">
                          {customer.name}
                        </TableCell>
                        <TableCell>
                          {formatPhoneForDisplay(customer.phone)}
                        </TableCell>
                        <TableCell>{customer.email ?? "—"}</TableCell>
                        <TableCell>
                          <OptInBadge optIn={customer.whatsapp_opt_in} />
                        </TableCell>
                        {canManageCustomers || canSendWhatsAppMessage ? (
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setFichaCustomer(customer)}
                              >
                                {crmMessages.fichaAcao}
                              </Button>
                              {canSendWhatsAppMessage ? (
                                <SendMessageButton
                                  customer={customer}
                                  onSend={setMessageTarget}
                                />
                              ) : null}
                              {canManageCustomers ? (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => setPackageTarget(customer)}
                                  >
                                    <Package aria-hidden="true" />
                                    Pacote
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => openEdit(customer)}
                                  >
                                    <Pencil aria-hidden="true" />
                                    Editar
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                      setCustomerToDeactivate(customer)
                                    }
                                  >
                                    Remover
                                  </Button>
                                </>
                              ) : null}
                            </div>
                          </TableCell>
                        ) : null}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile: cards */}
              <ul className="space-y-3 md:hidden">
                {filteredCustomers.map((customer) => (
                  <li
                    key={customer.id}
                    className="rounded-lg border border-border p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1">
                        <p className="font-medium text-foreground">
                          {customer.name}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {formatPhoneForDisplay(customer.phone)}
                        </p>
                        {customer.email ? (
                          <p className="text-sm text-muted-foreground">
                            {customer.email}
                          </p>
                        ) : null}
                      </div>
                      <OptInBadge optIn={customer.whatsapp_opt_in} />
                    </div>
                    {canManageCustomers || canSendWhatsAppMessage ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setFichaCustomer(customer)}
                        >
                          {crmMessages.fichaAcao}
                        </Button>
                        {canSendWhatsAppMessage ? (
                          <SendMessageButton
                            customer={customer}
                            onSend={setMessageTarget}
                          />
                        ) : null}
                        {canManageCustomers ? (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setPackageTarget(customer)}
                            >
                              <Package aria-hidden="true" />
                              Pacote
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openEdit(customer)}
                            >
                              <Pencil aria-hidden="true" />
                              Editar
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setCustomerToDeactivate(customer)}
                            >
                              Remover
                            </Button>
                          </>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      <CustomerDrawer
        open={fichaCustomer !== null}
        onOpenChange={(open) => {
          if (!open) setFichaCustomer(null);
        }}
        customer={fichaCustomer}
      />

      {canManageCustomers ? (
        <CustomerFormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          customer={editingCustomer}
        />
      ) : null}

      {/* Confirmação de remover (inativar — soft-delete) */}
      <Dialog
        open={!!customerToDeactivate}
        onOpenChange={(open) => {
          if (!open) setCustomerToDeactivate(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover cliente</DialogTitle>
            <DialogDescription>
              {`"${customerToDeactivate?.name}" deixa de aparecer na lista. O histórico de agendamentos é preservado.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCustomerToDeactivate(null)}
              disabled={deactivateCustomer.isPending}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={confirmDeactivate}
              disabled={deactivateCustomer.isPending}
            >
              {deactivateCustomer.isPending ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden="true" />
                  Removendo…
                </>
              ) : (
                "Remover"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {canSendWhatsAppMessage && messageTarget ? (
        <SendMessageDialog
          open={!!messageTarget}
          onOpenChange={(open) => {
            if (!open) setMessageTarget(null);
          }}
          customerId={messageTarget.id}
          customerName={messageTarget.name}
          whatsappOptIn={messageTarget.whatsapp_opt_in}
        />
      ) : null}

      {canManageCustomers && packageTarget ? (
        <SellPackageDialog
          open={!!packageTarget}
          onOpenChange={(open) => {
            if (!open) setPackageTarget(null);
          }}
          defaultCustomerId={packageTarget.id}
        />
      ) : null}
    </div>
  );
}
