import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/MoneyInput";
import { PackageBalanceCard } from "@/app/pacotes/PackageBalanceCard";
import { usePackageBalance, useSellPackage, mapPackageError } from "@/hooks/usePackageCredits";
import { useCustomers } from "@/hooks/useCustomers";
import { useServices } from "@/hooks/useServices";
import { usePermissions } from "@/hooks/usePermissions";
import {
  SELL_PACKAGE_DEFAULTS,
  sellPackageSchema,
  type SellPackageInput,
} from "@/lib/validations/pacotes";
import { formatCentsToBRL } from "@/lib/money";

interface SellPackageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pré-seleciona o cliente (fluxo Clientes → Pacote). */
  defaultCustomerId?: string | null;
  /** Chamado com o id do crédito criado (para encadear Renovação). */
  onSold?: (creditId: string) => void;
}

function formatExpiryPreview(validityDays: number): string {
  const date = new Date(Date.now() + validityDays * 86400000);
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

/**
 * Dialog de venda de pacote (UX-SPEC T3, ADR-06): seleciona cliente + serviço
 * (1 serviço por pacote, default §8 #1), N sessões, preço e validade; mostra o
 * resumo ("5 sessões · R$ 600,00 · expira em D") + saldos atuais do cliente e
 * confirma via `sell_package`. Recepção vende (sem ver preço de custo — só o
 * resumo da venda); o gate de entitlement vive no chamador (sem entitlement o
 * Dialog nem abre e nenhuma RPC é disparada).
 *
 * Selects nativos estilizados (em vez do `Select` Radix): escolha
 * determinística em testes happy-dom sem perder label/ids acessíveis.
 */
export function SellPackageDialog({
  open,
  onOpenChange,
  defaultCustomerId,
  onSold,
}: SellPackageDialogProps) {
  const { isAdmin } = usePermissions();
  const customersQuery = useCustomers({ activeOnly: true });
  const servicesQuery = useServices({ activeOnly: true });
  const sellPackage = useSellPackage();

  const form = useForm<SellPackageInput>({
    resolver: zodResolver(sellPackageSchema),
    defaultValues: SELL_PACKAGE_DEFAULTS,
  });

  useEffect(() => {
    if (!open) return;
    form.reset({
      ...SELL_PACKAGE_DEFAULTS,
      customerId: defaultCustomerId ?? "",
    });
  }, [open, defaultCustomerId, form]);

  const watchedCustomerId = form.watch("customerId");
  const watchedServiceId = form.watch("serviceId");
  const watchedSessions = form.watch("totalSessions");
  const watchedPrice = form.watch("priceCents");
  const watchedValidity = form.watch("validityDays");

  const balanceQuery = usePackageBalance(open ? watchedCustomerId || null : null);
  const balances = balanceQuery.data ?? [];
  const services = servicesQuery.data ?? [];
  const customers = customersQuery.data ?? [];
  const serviceName =
    services.find((s) => s.id === watchedServiceId)?.name ?? null;

  async function onSubmit(values: SellPackageInput) {
    try {
      const creditId = await sellPackage.mutateAsync(values);
      toast.success("Pacote vendido. O saldo já está disponível.");
      onSold?.(creditId);
      onOpenChange(false);
    } catch (error) {
      toast.error(mapPackageError(error));
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Vender pacote</DialogTitle>
          <DialogDescription>
            O pacote vale desde a venda. A baixa de 1 sessão é automática ao
            concluir o atendimento.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-5"
            noValidate
          >
            <FormField
              control={form.control}
              name="customerId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Cliente</FormLabel>
                  <FormControl>
                    <select
                      aria-label="Cliente"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      value={field.value}
                      onChange={(e) => field.onChange(e.target.value)}
                      onBlur={field.onBlur}
                      name={field.name}
                      ref={field.ref}
                    >
                      <option value="">Selecione o cliente</option>
                      {customers.map((customer) => (
                        <option key={customer.id} value={customer.id}>
                          {customer.name}
                        </option>
                      ))}
                    </select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="serviceId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Serviço do pacote</FormLabel>
                  <FormControl>
                    <select
                      aria-label="Serviço do pacote"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      value={field.value}
                      onChange={(e) => field.onChange(e.target.value)}
                      onBlur={field.onBlur}
                      name={field.name}
                      ref={field.ref}
                    >
                      <option value="">Selecione o serviço</option>
                      {services.map((service) => (
                        <option key={service.id} value={service.id}>
                          {service.name}
                        </option>
                      ))}
                    </select>
                  </FormControl>
                  <FormDescription>
                    Cada pacote vale para 1 serviço.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="totalSessions"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Número de sessões</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={100}
                        value={Number.isNaN(field.value) ? "" : field.value}
                        onChange={(e) =>
                          field.onChange(e.target.valueAsNumber)
                        }
                        onBlur={field.onBlur}
                        name={field.name}
                        ref={field.ref}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="validityDays"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Validade (dias)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={730}
                        value={Number.isNaN(field.value) ? "" : field.value}
                        onChange={(e) =>
                          field.onChange(e.target.valueAsNumber)
                        }
                        onBlur={field.onBlur}
                        name={field.name}
                        ref={field.ref}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="priceCents"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Preço do pacote</FormLabel>
                  <FormControl>
                    <MoneyInput
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      name={field.name}
                      ref={field.ref}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Resumo da venda (único preço que a recepção vê). */}
            {watchedServiceId && watchedSessions >= 1 ? (
              <div
                className="rounded-md border border-border bg-muted/30 p-3 text-sm"
                aria-live="polite"
              >
                <p className="font-medium text-foreground">Resumo da venda</p>
                <p className="text-muted-foreground">
                  {watchedSessions}{" "}
                  {watchedSessions === 1 ? "sessão" : "sessões"}
                  {serviceName ? ` de ${serviceName}` : ""} ·{" "}
                  <span className="font-medium tabular-nums text-foreground">
                    {formatCentsToBRL(watchedPrice)}
                  </span>{" "}
                  · válido por {watchedValidity}{" "}
                  {watchedValidity === 1 ? "dia" : "dias"} (expira em{" "}
                  {formatExpiryPreview(watchedValidity)})
                </p>
              </div>
            ) : null}

            {/* Saldos atuais do cliente (só leitura, servidor é SSoT). */}
            {watchedCustomerId && balances.length > 0 ? (
              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground">
                  Saldos atuais do cliente
                </p>
                {balances.map((b) => (
                  <PackageBalanceCard
                    key={b.credit_id}
                    balance={b}
                    serviceName={
                      services.find((s) => s.id === b.service_id)?.name
                    }
                    canSeePrice={isAdmin}
                  />
                ))}
              </div>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={sellPackage.isPending}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={sellPackage.isPending}>
                {sellPackage.isPending ? (
                  <>
                    <Loader2 className="animate-spin" aria-hidden="true" />
                    Vendendo…
                  </>
                ) : (
                  "Confirmar venda"
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
