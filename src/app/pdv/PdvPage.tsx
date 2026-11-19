import { useEffect, useMemo, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Minus } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { StatePanel } from "@/components/StatePanel";
import { EntitlementGate } from "@/components/EntitlementGate";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { PaymentCaptureDialog } from "@/app/agenda/pagamentos/PaymentCaptureDialog";
import { paymentsMessages } from "@/app/agenda/pagamentos/payments-messages";
import { fidelidadeMessages } from "@/app/fidelidade/fidelidade-messages";
import { WalkInBadge } from "@/app/pdv/WalkInBadge";
import { LoyaltyApplyPanel, type LoyaltyApplied } from "@/app/pdv/LoyaltyApplyPanel";

import { usePermissions } from "@/hooks/usePermissions";
import { useSegmentFeatures } from "@/hooks/useSegmentFeatures";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useApplyCouponToClosing, useRedeemGiftCard } from "@/hooks/useFidelidade";
import { useProfessionals } from "@/hooks/useProfessionals";
import { useServices } from "@/hooks/useServices";
import { useCombos } from "@/hooks/useCombos";
import { useProducts } from "@/hooks/useProducts";
import { usePlanEntitlements } from "@/hooks/usePlanEntitlements";
import { useAppointments } from "@/hooks/useAppointments";
import { useCreateCustomer } from "@/hooks/useCustomers";
import { newCreationKey, useCreateWalkIn } from "@/hooks/useWalkIn";
import { walkInSchema, type WalkInInput } from "@/lib/validations/pdv";
import { toE164BR } from "@/lib/phone";
import { formatCentsToBRL } from "@/lib/money";
import { paymentErrorMessage } from "@/app/agenda/pagamentos/payment-error-message";
import { PaymentApiError, PAYMENT_ERROR_MAP } from "@/lib/payment-errors";
import { toast } from "sonner";
import type { AppointmentWithRelations } from "@/types/domain";
import type { Product } from "@/types/domain";

const messages = paymentsMessages;

/** `YYYY-MM-DD` de hoje no fuso do tenant (base de "A concluir hoje"). */
function todayInTenantTz(timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function initialWalkInValues(professionalId: string): WalkInInput {
  return {
    professionalId,
    selection: { kind: "service", serviceId: "" },
    customerName: "",
    customerPhone: "",
    whatsappOptIn: false,
  };
}

const initialLoyalty: LoyaltyApplied = {
  couponCode: null,
  discountCents: 0,
  giftCode: null,
  giftCents: 0,
  totalFinalCents: 0,
};

/** Chave de idempotência por aplicação de fidelidade (um cupom + um gift por venda). */
function newLoyaltyKey(): string {
  const random = globalThis.crypto?.randomUUID?.();
  if (typeof random === "string" && random.length > 0) return random;
  return `loyalty-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

type SaleKind = "service" | "product" | "combo";

export function PdvPage() {
  const { canRegisterPayments, canScheduleForAnyProfessional, canViewCommission } = usePermissions();
  const { payments, combos: combosFeature } = useSegmentFeatures();
  const entitlements = usePlanEntitlements();
  const { tenant, userId } = useCurrentUser();
  const timeZone = tenant?.timezone ?? "America/Sao_Paulo";

  const professionalsQuery = useProfessionals({ activeOnly: true });
  const servicesQuery = useServices({ activeOnly: true });
  const combosQuery = useCombos({ activeOnly: true });
  const productsQuery = useProducts({ activeOnly: true, enabled: entitlements?.estoque === true });
  const createWalkIn = useCreateWalkIn();
  const createCustomer = useCreateCustomer();
  const applyCoupon = useApplyCouponToClosing();
  const redeemGift = useRedeemGiftCard();

  const today = todayInTenantTz(timeZone);
  const todayQuery = useAppointments({
    day: today,
    professionalId: canScheduleForAnyProfessional ? undefined : undefined,
  });

  const [captureTarget, setCaptureTarget] = useState<{
    appointment: {
      id: string;
      customerName: string;
      serviceName: string;
      professionalName: string;
      totalCents: number;
      status: "em_atendimento" | "concluido";
    };
  } | null>(null);

  const [identify, setIdentify] = useState(false);
  const [loyalty, setLoyalty] = useState<LoyaltyApplied>(initialLoyalty);
  const [activeKind, setActiveKind] = useState<SaleKind>("service");
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [selectedComboId, setSelectedComboId] = useState("");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [qty, setQty] = useState(1);

  const form = useForm<WalkInInput>({
    resolver: zodResolver(walkInSchema),
    defaultValues: initialWalkInValues(""),
  });

  const professionals = professionalsQuery.data ?? [];
  const services = servicesQuery.data ?? [];
  const combos = combosFeature ? (combosQuery.data ?? []) : [];
  const products = entitlements?.estoque ? (productsQuery.data ?? []) : [];
  const estoqueEntitled = entitlements?.estoque === true;
  const comissaoProdutoEntitled = entitlements?.comissaoProduto === true;

  const ownProfessional = useMemo(() => {
    if (canScheduleForAnyProfessional || !userId) return null;
    return professionals.find((p) => p.profile_id === userId) ?? null;
  }, [canScheduleForAnyProfessional, userId, professionals]);

  useEffect(() => {
    if (ownProfessional) form.setValue("professionalId", ownProfessional.id);
  }, [ownProfessional, form]);

  const selection = useMemo<WalkInInput["selection"]>(() => {
    if (activeKind === "service") return { kind: "service", serviceId: selectedServiceId };
    if (activeKind === "product") return { kind: "product", productId: selectedProductId, qty };
    return { kind: "combo", comboId: selectedComboId };
  }, [activeKind, selectedServiceId, selectedProductId, qty, selectedComboId]);

  useEffect(() => {
    form.setValue("selection", selection);
  }, [selection, form]);

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === selectedProductId) ?? null,
    [products, selectedProductId],
  );

  const selectedTotal = useMemo(() => {
    if (selection.kind === "service") {
      return services.find((s) => s.id === selection.serviceId)?.price_cents ?? 0;
    }
    if (selection.kind === "combo") {
      return combos.find((c) => c.id === selection.comboId)?.price_cents ?? 0;
    }
    return selectedProduct ? selectedProduct.price_cents * qty : 0;
  }, [selection, services, combos, selectedProduct, qty]);

  const selectedServiceName = useMemo(() => {
    if (selection.kind === "service") {
      return services.find((s) => s.id === selection.serviceId)?.name ?? "";
    }
    if (selection.kind === "combo") {
      return combos.find((c) => c.id === selection.comboId)?.name ?? "";
    }
    return selectedProduct?.name ?? "";
  }, [selection, services, combos, selectedProduct]);

  const selectionError = (() => {
    const errors = form.formState.errors.selection as
      | { message?: string; serviceId?: { message?: string }; comboId?: { message?: string }; productId?: { message?: string } }
      | undefined;
    return (
      errors?.serviceId?.message ??
      errors?.comboId?.message ??
      errors?.productId?.message ??
      errors?.message
    );
  })();

  const insufficientStock =
    selectedProduct !== null && qty > selectedProduct.stock_qty;
  const outOfStock = selectedProduct !== null && selectedProduct.stock_qty <= 0;

  const canPreviewCommission =
    canViewCommission && comissaoProdutoEntitled && selectedProduct !== null;

  const commissionCents = selectedProduct
    ? Math.round((selectedProduct.price_cents * qty * selectedProduct.commission_pct) / 100)
    : 0;

  const pendingToday = (todayQuery.data ?? []).filter(
    (a) => a.status === "em_atendimento" || a.status === "confirmado",
  );

  function resetSaleForm() {
    form.reset(initialWalkInValues(ownProfessional?.id ?? ""));
    setActiveKind("service");
    setSelectedServiceId("");
    setSelectedComboId("");
    setSelectedProductId("");
    setQty(1);
    setIdentify(false);
    // Fidelidade nunca vaza para a próxima venda (cupom/gift da anterior).
    setLoyalty(initialLoyalty);
    form.clearErrors();
  }

  if (payments === null) {
    return (
      <div className="space-y-6" aria-busy="true">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (payments === false) {
    return (
      <div className="space-y-6">
        <PageHeader titulo={messages.pdv.title} descricao={messages.pdv.description} />
        <StatePanel
          titulo={messages.pdv.segmentOnlyTitle}
          descricao={messages.pdv.segmentOnlyDescription}
        />
      </div>
    );
  }

  async function onSubmit(input: WalkInInput) {
    if (input.selection.kind === "product") {
      const sel = input.selection;
      const product = products.find((p) => p.id === sel.productId);
      if (!product) {
        toast.error(messages.pdv.createdError);
        return;
      }
      if (sel.qty < 1 || sel.qty > product.stock_qty) {
        toast.error(messages.pdv.insufficientStock);
        return;
      }
    }
    const hasCustomer =
      (input.customerName?.trim().length ?? 0) > 0 &&
      (input.customerPhone?.trim().length ?? 0) > 0;
    try {
      let customerId: string | null = null;
      if (hasCustomer) {
        const phone = toE164BR((input.customerPhone ?? "").trim());
        if (!phone) {
          toast.error("Informe um telefone com DDD (ex.: (11) 99999-8888).");
          return;
        }
        const customer = await createCustomer.mutateAsync({
          name: (input.customerName ?? "").trim(),
          phone,
          email: null,
          whatsappOptIn: input.whatsappOptIn,
          active: true,
        });
        customerId = customer.id;
      }
      const created = await createWalkIn.mutateAsync({
        professionalId: input.professionalId,
        selection: input.selection,
        customerId,
        creationIdempotencyKey: newCreationKey(),
      });
      // Aplicação autoritativa pós-criação (atendimento real): cupom via
      // `apply_coupon_to_closing` + gift via `redeem_gift_card`, ambos
      // idempotentes e com trilha em `audit_log`. O fechamento captura o
      // total final do servidor (settlement já é coupon-aware).
      const saleLoyalty: LoyaltyApplied = { ...loyalty };
      let totalFinal = selectedTotal;
      if (saleLoyalty.couponCode) {
        try {
          const applied = await applyCoupon.mutateAsync({
            appointmentId: created.appointmentId,
            code: saleLoyalty.couponCode,
            idempotencyKey: newLoyaltyKey(),
          });
          totalFinal =
            applied.total_final_cents ??
            Math.max(0, totalFinal - applied.discount_cents);
          saleLoyalty.discountCents = applied.discount_cents;
        } catch {
          saleLoyalty.couponCode = null;
          saleLoyalty.discountCents = 0;
          toast.error(fidelidadeMessages.pdv.couponInvalid);
        }
      }
      if (saleLoyalty.giftCode && saleLoyalty.giftCents > 0) {
        const amount = Math.min(saleLoyalty.giftCents, totalFinal);
        if (amount > 0) {
          try {
            await redeemGift.mutateAsync({
              appointmentId: created.appointmentId,
              code: saleLoyalty.giftCode,
              amountCents: amount,
              idempotencyKey: newLoyaltyKey(),
            });
            totalFinal = Math.max(0, totalFinal - amount);
            saleLoyalty.giftCents = amount;
          } catch {
            saleLoyalty.giftCode = null;
            saleLoyalty.giftCents = 0;
            toast.error(fidelidadeMessages.pdv.giftInvalid);
          }
        }
      }
      saleLoyalty.totalFinalCents = totalFinal;
      setLoyalty(saleLoyalty);
      toast.success(messages.pdv.successCreated);
      setCaptureTarget({
        appointment: {
          id: created.appointmentId,
          customerName: hasCustomer
            ? (input.customerName ?? "").trim()
            : messages.pdv.anonymous,
          serviceName: selectedServiceName,
          professionalName: selectedProfessional?.name ?? "",
          totalCents: totalFinal,
          status: "em_atendimento",
        },
      });
      setIdentify(false);
      form.setValue("customerName", "");
      form.setValue("customerPhone", "");
      form.setValue("whatsappOptIn", false);
      form.clearErrors(["customerName", "customerPhone"]);
    } catch (error) {
      if (error instanceof PaymentApiError) {
        const message = Object.prototype.hasOwnProperty.call(PAYMENT_ERROR_MAP, error.code)
          ? paymentErrorMessage(messages, error.code)
          : messages.pdv.createdError;
        toast.error(message);
      } else {
        toast.error(messages.pdv.createdError);
      }
    }
  }

  const busy =
    createWalkIn.isPending ||
    createCustomer.isPending ||
    applyCoupon.isPending ||
    redeemGift.isPending;
  const selectedProfessional = professionals.find(
    (p) => p.id === form.watch("professionalId"),
  );

  const submitDisabled =
    busy ||
    !canRegisterPayments ||
    (activeKind === "product" && (selectedProduct === null || insufficientStock || outOfStock));

  return (
    <div className="space-y-6">
      <PageHeader titulo={messages.pdv.title} descricao={messages.pdv.description} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{messages.pdv.newSale}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-1">
                <Label htmlFor="pdv-profissional">{messages.pdv.professional}</Label>
                <Controller
                  control={form.control}
                  name="professionalId"
                  render={({ field }) => (
                    <Select
                      value={field.value || "nenhum"}
                      onValueChange={(value) => {
                        if (!value || value === "nenhum") return;
                        field.onChange(value);
                      }}
                      disabled={!canScheduleForAnyProfessional || !!ownProfessional}
                    >
                      <SelectTrigger id="pdv-profissional" className="w-full">
                        <SelectValue placeholder={messages.pdv.professional} />
                      </SelectTrigger>
                      <SelectContent>
                        {professionals.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
                {form.formState.errors.professionalId ? (
                  <p className="text-sm text-destructive" role="alert">
                    {form.formState.errors.professionalId.message}
                  </p>
                ) : null}
              </div>

              <Tabs value={activeKind} onValueChange={(value) => setActiveKind(value as SaleKind)} className="w-full">
                <TabsList aria-label={messages.pdv.segmentedAria} className="w-full">
                  <TabsTrigger value="service" className="flex-1" onClick={() => setActiveKind("service")}>
                    {messages.pdv.segmentedService}
                  </TabsTrigger>
                  <TabsTrigger value="product" className="flex-1" onClick={() => setActiveKind("product")}>
                    {messages.pdv.segmentedProduct}
                  </TabsTrigger>
                  {combosFeature ? (
                    <TabsTrigger value="combo" className="flex-1" onClick={() => setActiveKind("combo")}>
                      {messages.pdv.segmentedCombo}
                    </TabsTrigger>
                  ) : null}
                </TabsList>
                <TabsContent value={activeKind} className="space-y-1 mt-0">
                  <Label htmlFor="pdv-servico">{messages.pdv.service}</Label>
                {activeKind === "service" ? (
                  <Controller
                    control={form.control}
                    name="selection.serviceId"
                    render={({ field }) => (
                      <Select
                        value={field.value || "nenhum"}
                        onValueChange={(value) => {
                          if (!value || value === "nenhum") return;
                          setSelectedServiceId(value);
                        }}
                      >
                        <SelectTrigger id="pdv-servico" className="w-full">
                          <SelectValue placeholder={messages.pdv.service} />
                        </SelectTrigger>
                        <SelectContent>
                          {services.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.name} — {formatCentsToBRL(s.price_cents)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                ) : activeKind === "product" ? (
                  <EntitlementGate entitled={estoqueEntitled} recurso="Estoque" acaoLabel="Operar estoque">
                    <div className="space-y-3">
                      {productsQuery.isLoading ? (
                      <Skeleton className="h-10 w-full" />
                    ) : productsQuery.isError ? (
                      <StatePanel
                        titulo={messages.pdv.createdError}
                        descricao={messages.pdv.createdError}
                      >
                        <Button variant="outline" onClick={() => void productsQuery.refetch()}>
                          Tentar novamente
                        </Button>
                      </StatePanel>
                    ) : products.length === 0 ? (
                      <StatePanel
                        titulo={messages.pdv.productPlaceholder}
                        descricao={messages.pdv.productPlaceholder}
                      />
                    ) : (
                      <Controller
                        control={form.control}
                        name="selection.productId"
                        render={({ field }) => (
                          <Select
                            value={field.value || "nenhum"}
                            onValueChange={(value) => {
                              if (!value || value === "nenhum") return;
                              setSelectedProductId(value);
                            }}
                          >
                            <SelectTrigger id="pdv-servico" className="w-full">
                              <SelectValue placeholder={messages.pdv.productPlaceholder} />
                            </SelectTrigger>
                            <SelectContent>
                              {products.map((p: Product) => (
                                <SelectItem key={p.id} value={p.id} disabled={p.stock_qty <= 0}>
                                  {p.name} — {formatCentsToBRL(p.price_cents)}
                                  {p.stock_qty <= 0 ? ` (${messages.pdv.outOfStock})` : ""}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      />
                    )}
                    {products.some((p: Product) => p.stock_qty <= 0) ? (
                      <p className="text-sm text-destructive" role="alert">
                        {messages.pdv.outOfStockAlert}
                      </p>
                    ) : null}
                    <div className="space-y-1">
                      <Label htmlFor="pdv-qty">{messages.pdv.qty}</Label>
                      <div className="flex items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => setQty((q) => Math.max(1, q - 1))}
                          aria-label={messages.pdv.decreaseQty}
                        >
                          <Minus aria-hidden="true" />
                        </Button>
                        <Input
                          id="pdv-qty"
                          type="number"
                          min={1}
                          max={selectedProduct?.stock_qty}
                          value={qty}
                          onChange={(e) => {
                            const next = Number(e.target.value);
                            setQty(Number.isFinite(next) && next > 0 ? next : 1);
                          }}
                          aria-valuenow={qty}
                          className="w-20 text-center"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() =>
                            setQty((q) =>
                              selectedProduct ? Math.min(selectedProduct.stock_qty, q + 1) : q + 1,
                            )
                          }
                          aria-label={messages.pdv.increaseQty}
                        >
                          <Plus aria-hidden="true" />
                        </Button>
                      </div>
                      {selectedProduct ? (
                        <p className="text-xs text-muted-foreground">
                          {messages.pdv.stockAvailable.replace("{qty}", String(selectedProduct.stock_qty))}
                        </p>
                      ) : null}
                    </div>
                    <div className="space-y-1">
                      <Label>{messages.pdv.unitPrice}</Label>
                      <p className="text-sm font-medium tabular-nums">
                        {selectedProduct ? formatCentsToBRL(selectedProduct.price_cents) : "—"}
                      </p>
                    </div>
                    {insufficientStock ? (
                      <p className="text-sm text-destructive" role="alert">
                        {messages.pdv.insufficientStock}
                      </p>
                    ) : null}
                    {canPreviewCommission ? (
                      <p className="text-sm text-muted-foreground">
                        {messages.pdv.commissionPreview.replace("{value}", formatCentsToBRL(commissionCents))}
                      </p>
                    ) : null}
                  </div>
                  </EntitlementGate>
                ) : (
                  <Controller
                    control={form.control}
                    name="selection.comboId"
                    render={({ field }) => (
                      <Select
                        value={field.value || "nenhum"}
                        onValueChange={(value) => {
                          if (!value || value === "nenhum") return;
                          setSelectedComboId(value);
                        }}
                      >
                        <SelectTrigger id="pdv-servico" className="w-full">
                          <SelectValue placeholder={messages.pdv.combo} />
                        </SelectTrigger>
                        <SelectContent>
                          {combos.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              {c.name} — {formatCentsToBRL(c.price_cents)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                )}
                {selectionError ? (
                  <p className="text-sm text-destructive" role="alert">
                    {selectionError}
                  </p>
                ) : null}
              </TabsContent>
              </Tabs>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="pdv-identificar"
                  checked={identify}
                  onCheckedChange={(checked) => {
                    const next = checked === true;
                    setIdentify(next);
                    if (!next) {
                      form.setValue("customerName", "", { shouldValidate: true });
                      form.setValue("customerPhone", "", { shouldValidate: true });
                      form.setValue("whatsappOptIn", false);
                    }
                  }}
                />
                <Label htmlFor="pdv-identificar">{messages.pdv.identifiedToggle}</Label>
              </div>
              {identify ? (
                <div className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label htmlFor="pdv-cliente-nome">{messages.pdv.customerName}</Label>
                      <Input
                        id="pdv-cliente-nome"
                        autoFocus
                        aria-invalid={Boolean(form.formState.errors.customerName)}
                        aria-describedby={
                          form.formState.errors.customerName ? "pdv-cliente-nome-erro" : undefined
                        }
                        {...form.register("customerName")}
                      />
                      {form.formState.errors.customerName ? (
                        <p
                          id="pdv-cliente-nome-erro"
                          className="text-sm text-destructive"
                          role="alert"
                        >
                          {form.formState.errors.customerName.message}
                        </p>
                      ) : null}
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor="pdv-cliente-fone">{messages.pdv.customerPhone}</Label>
                      <Input
                        id="pdv-cliente-fone"
                        aria-invalid={Boolean(form.formState.errors.customerPhone)}
                        aria-describedby={
                          form.formState.errors.customerPhone ? "pdv-cliente-fone-erro" : undefined
                        }
                        {...form.register("customerPhone")}
                      />
                      {form.formState.errors.customerPhone ? (
                        <p
                          id="pdv-cliente-fone-erro"
                          className="text-sm text-destructive"
                          role="alert"
                        >
                          {form.formState.errors.customerPhone.message}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <Controller
                    control={form.control}
                    name="whatsappOptIn"
                    render={({ field }) => (
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="pdv-whatsapp-optin"
                          checked={field.value}
                          onCheckedChange={(checked) => field.onChange(checked === true)}
                        />
                        <Label htmlFor="pdv-whatsapp-optin">{messages.pdv.whatsappOptIn}</Label>
                      </div>
                    )}
                  />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{messages.pdv.anonymousHint}</p>
              )}

              <div className="flex items-center justify-between pt-2">
                <p className="text-sm text-muted-foreground">{messages.pdv.total}</p>
                <p className="font-display text-2xl font-semibold tabular-nums">
                  {formatCentsToBRL(selectedTotal)}
                </p>
              </div>

              <Button type="submit" disabled={submitDisabled} className="w-full">
                <Plus aria-hidden="true" />
                {busy ? messages.pdv.creating : messages.pdv.createSale}
              </Button>
            </form>
            <div className="pt-4">
              <LoyaltyApplyPanel
                totalCents={selectedTotal}
                hasCustomer={identify}
                entitled={entitlements?.fidelidade === true}
                onApplied={(applied) => setLoyalty(applied)}
              />
              {loyalty.discountCents > 0 || loyalty.giftCents > 0 ? (
                <p className="mt-2 text-sm text-muted-foreground" role="status">
                  {loyalty.couponCode ? `Cupom ${loyalty.couponCode} · ` : ""}
                  {loyalty.giftCode ? `Gift ${loyalty.giftCode} · ` : ""}
                  Total final {formatCentsToBRL(loyalty.totalFinalCents)}
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{messages.pdv.pendingList}</CardTitle>
          </CardHeader>
          <CardContent>
            {todayQuery.isLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : pendingToday.length === 0 ? (
              <p className="text-sm text-muted-foreground">{messages.pdv.pendingEmpty}</p>
            ) : (
              <ul className="space-y-3">
                {pendingToday.map((appointment: AppointmentWithRelations) => (
                  <li
                    key={appointment.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 font-medium">
                        {appointment.customers?.name ??
                          (appointment.customer_id == null
                            ? messages.pdv.anonymous
                            : "Cliente removido")}
                        {appointment.origin === "walk_in" ? <WalkInBadge /> : null}
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {appointment.combos?.name ??
                          appointment.services?.name ??
                          "Serviço removido"}
                        {" · "}
                        {appointment.professionals?.name ?? "Profissional removido"} ·{" "}
                        {formatCentsToBRL(appointment.price_cents)}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!canRegisterPayments}
                      onClick={() =>
                        setCaptureTarget({
                          appointment: {
                            id: appointment.id,
                            customerName:
                              appointment.customers?.name ?? messages.pdv.anonymous,
                            serviceName:
                              appointment.combos?.name ??
                              appointment.services?.name ??
                              "",
                            professionalName: appointment.professionals?.name ?? "",
                            totalCents: appointment.price_cents,
                            status: appointment.status as "em_atendimento" | "concluido",
                          },
                        })
                      }
                    >
                      {messages.pdv.openPayment}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {captureTarget ? (
        <PaymentCaptureDialog
          open
          mode="close"
          appointment={captureTarget.appointment}
          onOpenChange={(open) => {
            if (!open) setCaptureTarget(null);
          }}
          onCompleted={() => {
            setCaptureTarget(null);
            resetSaleForm();
            toast.success(messages.pdv.saleCompleted);
            void todayQuery.refetch();
          }}
        />
      ) : null}
    </div>
  );
}
