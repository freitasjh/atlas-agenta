import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Gift, Loader2, Plus, Ticket } from "lucide-react";
import { toast } from "sonner";

import { AccessDenied } from "@/components/AccessDenied";
import { PageHeader } from "@/components/PageHeader";
import { EntitlementGate } from "@/components/EntitlementGate";
import { StatePanel } from "@/components/StatePanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MoneyInput } from "@/components/MoneyInput";
import { usePlanEntitlements } from "@/hooks/usePlanEntitlements";
import { usePermissions } from "@/hooks/usePermissions";
import {
  useCoupons,
  useGiftCards,
  useIssueGiftCard,
  useLoyaltyAccounts,
  useLoyaltyProgram,
  useLoyaltyTransactions,
  useSaveCoupon,
  useSaveLoyaltyProgram,
} from "@/hooks/useFidelidade";
import {
  couponDiscountCents,
  couponFormSchema,
  formatLevelsText,
  formToProgramPayload,
  giftCardFormSchema,
  loyaltyLevelFor,
  loyaltyProgramFormSchema,
  transactionTypeLabel,
  type Coupon,
  type CouponFormValues,
  type GiftCardFormValues,
  type LoyaltyProgramFormValues,
} from "@/app/fidelidade/model";
import { fidelidadeMessages } from "@/app/fidelidade/fidelidade-messages";
import { formatCentsToBRL } from "@/lib/money";
import { useCustomers } from "@/hooks/useCustomers";

const t = fidelidadeMessages;

function CouponRow({ coupon }: { coupon: Coupon }) {
  const valueLabel =
    coupon.type === "percent" ? `${coupon.value}%` : formatCentsToBRL(coupon.value);
  return (
    <>
      <TableCell className="font-medium text-foreground tabular-nums">{coupon.code}</TableCell>
      <TableCell>{coupon.type === "percent" ? t.coupons.typePercent : t.coupons.typeFixed}</TableCell>
      <TableCell className="tabular-nums">{valueLabel}</TableCell>
      <TableCell className="tabular-nums">{coupon.valid_until ?? "—"}</TableCell>
      <TableCell className="tabular-nums">
        {coupon.used_count}
        {coupon.usage_limit != null ? ` / ${coupon.usage_limit}` : ""}
      </TableCell>
      <TableCell>
        <Badge variant={coupon.active ? "secondary" : "outline"}>
          {coupon.active ? "Ativo" : "Inativo"}
        </Badge>
      </TableCell>
    </>
  );
}

/**
 * Fidelidade (`/app/fidelidade`, admin, ADR-15 RF-17..RF-23, UX-SPEC D).
 *
 * Tabs: Programa (config ativo/pontos/expiração/níveis), Cartão do cliente
 * (saldo + extrato), Cupons e Gift cards. Gating `fidelidade`: sem
 * entitlement, upsell e zero request sensível (queries com `enabled`).
 * Escrita é só admin (trava real no RLS).
 */
export function FidelidadePage() {
  const { isAdmin } = usePermissions();
  const entitlements = usePlanEntitlements();
  const entitled = entitlements?.fidelidade === true;

  const programQuery = useLoyaltyProgram({ enabled: entitled });
  const accountsQuery = useLoyaltyAccounts({ enabled: entitled });
  const couponsQuery = useCoupons({ enabled: entitled });
  const giftsQuery = useGiftCards({ enabled: entitled });
  const customersQuery = useCustomers({ activeOnly: false, enabled: entitled });
  const saveProgram = useSaveLoyaltyProgram();
  const saveCoupon = useSaveCoupon();
  const issueGift = useIssueGiftCard();

  const [tab, setTab] = useState("programa");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [couponOpen, setCouponOpen] = useState(false);
  const [giftOpen, setGiftOpen] = useState(false);

  const txQuery = useLoyaltyTransactions(accountId, { enabled: entitled });

  const program = programQuery.data ?? null;
  const accounts = useMemo(() => accountsQuery.data ?? [], [accountsQuery.data]);
  const coupons = useMemo(() => couponsQuery.data ?? [], [couponsQuery.data]);
  const gifts = useMemo(() => giftsQuery.data ?? [], [giftsQuery.data]);

  const names = useMemo(() => {
    const map = new Map((customersQuery.data ?? []).map((c) => [c.id, c.name]));
    return map;
  }, [customersQuery.data]);

  const selectedAccount = accountId ? (accounts.find((a) => a.id === accountId) ?? null) : null;
  const transactions = txQuery.data ?? [];

  useEffect(() => {
    if (!accountId && accounts.length > 0) setAccountId(accounts[0].id);
  }, [accountId, accounts]);

  const programForm = useForm<LoyaltyProgramFormValues>({
    resolver: zodResolver(loyaltyProgramFormSchema),
    defaultValues: {
      active: program?.active ?? true,
      points_per_real: program?.points_per_real ?? 1,
      rounding: program?.rounding ?? "floor",
      expiry_days: program?.expiry_days != null ? String(program.expiry_days) : "",
      levels_text: formatLevelsText(program?.levels ?? null),
    },
    values: program
      ? {
          active: program.active,
          points_per_real: program.points_per_real,
          rounding: program.rounding,
          expiry_days: program.expiry_days != null ? String(program.expiry_days) : "",
          levels_text: formatLevelsText(program.levels),
        }
      : undefined,
  });

  const couponForm = useForm<CouponFormValues>({
    resolver: zodResolver(couponFormSchema),
    defaultValues: { code: "", type: "percent", value: 10, valid_until: "", usage_limit: "" },
  });

  const giftForm = useForm<GiftCardFormValues>({
    resolver: zodResolver(giftCardFormSchema),
    defaultValues: { code: "", initial_value_cents: 0, valid_until: "" },
  });

  if (!isAdmin) {
    return <AccessDenied backTo="/app" backLabel="Voltar ao painel" />;
  }

  async function handleSaveProgram(values: LoyaltyProgramFormValues) {
    try {
      await saveProgram.mutateAsync(formToProgramPayload(values));
      toast.success(t.config.saveSuccess);
    } catch {
      toast.error(t.config.saveError);
    }
  }

  async function handleSaveCoupon(values: CouponFormValues) {
    try {
      const usage = (values.usage_limit ?? "").trim();
      await saveCoupon.mutateAsync({
        code: values.code.trim(),
        type: values.type,
        value: values.type === "percent" ? Math.min(100, values.value) : values.value,
        valid_until: values.valid_until?.trim() ? values.valid_until.trim() : null,
        usage_limit: usage === "" ? null : Number.parseInt(usage, 10),
      });
      toast.success(t.coupons.saveSuccess);
      setCouponOpen(false);
      couponForm.reset();
    } catch {
      toast.error(t.coupons.saveError);
    }
  }

  async function handleIssueGift(values: GiftCardFormValues) {
    try {
      await issueGift.mutateAsync({
        code: values.code.trim(),
        initial_value_cents: values.initial_value_cents,
        valid_until: values.valid_until?.trim() ? values.valid_until.trim() : null,
      });
      toast.success(t.gifts.saveSuccess);
      setGiftOpen(false);
      giftForm.reset();
    } catch {
      toast.error(t.gifts.saveError);
    }
  }

  const isLoading = programQuery.isLoading || accountsQuery.isLoading;
  const isError = programQuery.isError || accountsQuery.isError;

  return (
    <div className="space-y-6">
      <PageHeader
        titulo={t.page.title}
        descricao={t.page.description}
        acoes={
          <>
            <Button variant="outline" onClick={() => setCouponOpen(true)} disabled={!entitled || saveCoupon.isPending}>
              <Ticket className="h-4 w-4" aria-hidden="true" />
              {t.page.newCoupon}
            </Button>
            <Button onClick={() => setGiftOpen(true)} disabled={!entitled || issueGift.isPending}>
              <Gift className="h-4 w-4" aria-hidden="true" />
              {t.page.newGiftCard}
            </Button>
          </>
        }
      />

      <EntitlementGate entitled={entitled} recurso={t.gating.resource} acaoLabel={t.gating.action}>
        {isLoading ? (
          <div className="space-y-2" aria-busy="true" aria-label={t.page.loading}>
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : isError ? (
          <StatePanel titulo={t.page.errorTitle} descricao={t.page.errorDescription}>
            <Button
              variant="outline"
              onClick={() => {
                void programQuery.refetch();
                void accountsQuery.refetch();
              }}
            >
              {t.page.retry}
            </Button>
          </StatePanel>
        ) : (
          <Tabs value={tab} onValueChange={setTab} className="w-full">
            <TabsList aria-label={t.page.title} className="w-full">
              <TabsTrigger value="programa" className="flex-1" onClick={() => setTab("programa")}>{t.page.tabConfig}</TabsTrigger>
              <TabsTrigger value="cartao" className="flex-1" onClick={() => setTab("cartao")}>{t.page.tabCard}</TabsTrigger>
              <TabsTrigger value="cupons" className="flex-1" onClick={() => setTab("cupons")}>{t.page.tabCoupons}</TabsTrigger>
              <TabsTrigger value="gifts" className="flex-1" onClick={() => setTab("gifts")}>{t.page.tabGifts}</TabsTrigger>
            </TabsList>

            <TabsContent value="programa">
              <Card>
                <CardHeader>
                  <CardTitle>{t.config.title}</CardTitle>
                  <CardDescription>{t.config.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <Form {...programForm}>
                    <form onSubmit={programForm.handleSubmit((v) => void handleSaveProgram(v))} className="space-y-4">
                      <FormField
                        control={programForm.control}
                        name="active"
                        render={({ field }) => (
                          <FormItem className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
                            <div className="space-y-1">
                              <FormLabel>{t.config.activeLabel}</FormLabel>
                              <FormDescription>{t.config.activeHint}</FormDescription>
                            </div>
                            <FormControl>
                              <Switch checked={field.value} onCheckedChange={field.onChange} aria-label={t.config.activeLabel} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                        <FormField
                          control={programForm.control}
                          name="points_per_real"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>{t.config.pointsLabel}</FormLabel>
                              <FormControl>
                                <Input
                                  type="number"
                                  min={0}
                                  inputMode="decimal"
                                  value={field.value}
                                  onChange={(e) => field.onChange(Number(e.target.value))}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={programForm.control}
                          name="rounding"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>{t.config.roundingLabel}</FormLabel>
                              <Select value={field.value} onValueChange={field.onChange}>
                                <FormControl>
                                  <SelectTrigger><SelectValue /></SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="floor">{t.config.roundingFloor}</SelectItem>
                                  <SelectItem value="nearest">{t.config.roundingNearest}</SelectItem>
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={programForm.control}
                          name="expiry_days"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>{t.config.expiryLabel}</FormLabel>
                              <FormControl>
                                <Input inputMode="numeric" placeholder={t.config.expiryPlaceholder} {...field} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                      <FormField
                        control={programForm.control}
                        name="levels_text"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t.config.levelsLabel}</FormLabel>
                            <FormControl>
                              <Textarea
                                placeholder={t.config.levelsPlaceholder}
                                rows={3}
                                {...field}
                              />
                            </FormControl>
                            <FormDescription>{t.config.levelsHint}</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      {!programForm.watch("active") ? (
                        <p className="text-sm text-muted-foreground" role="note">{t.config.inactiveNote}</p>
                      ) : null}
                      <Button type="submit" disabled={saveProgram.isPending}>
                        {saveProgram.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                        {saveProgram.isPending ? t.config.saving : t.config.save}
                      </Button>
                    </form>
                  </Form>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="cartao" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>{t.card.title}</CardTitle>
                  <CardDescription>{t.card.description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-1">
                    <Label htmlFor="fidelidade-cliente">{t.card.customerLabel}</Label>
                    <Select value={accountId ?? "nenhum"} onValueChange={(v) => setAccountId(v === "nenhum" ? null : v)}>
                      <SelectTrigger id="fidelidade-cliente" className="w-full">
                        <SelectValue placeholder={t.card.searchPlaceholder} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="nenhum">{t.card.searchPlaceholder}</SelectItem>
                        {accounts.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {names.get(a.customer_id) ?? a.customer_id} — {a.balance_points} pts
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {accounts.length === 0 ? (
                    <StatePanel titulo={t.card.emptyTitle} descricao={t.card.emptyDescription} />
                  ) : selectedAccount ? (
                    <>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3" role="group" aria-label={t.card.title}>
                        <div className="rounded-lg border border-border p-4">
                          <p className="text-sm font-medium text-muted-foreground">{t.card.balanceLabel}</p>
                          <p className="font-display text-3xl font-semibold tabular-nums tracking-tight text-foreground">
                            {selectedAccount.balance_points}
                          </p>
                        </div>
                        <div className="rounded-lg border border-border p-4">
                          <p className="text-sm font-medium text-muted-foreground">{t.card.lifetimeLabel}</p>
                          <p className="font-display text-3xl font-semibold tabular-nums tracking-tight text-foreground">
                            {selectedAccount.lifetime_points}
                          </p>
                        </div>
                        <div className="rounded-lg border border-border p-4">
                          <p className="text-sm font-medium text-muted-foreground">{t.card.levelLabel}</p>
                          <p className="font-display text-3xl font-semibold tracking-tight text-foreground">
                            {loyaltyLevelFor(program?.levels, selectedAccount.balance_points) ?? t.card.noLevel}
                          </p>
                        </div>
                      </div>
                      {txQuery.isLoading ? (
                        <Skeleton className="h-20 w-full" />
                      ) : transactions.length === 0 ? (
                        <p className="text-sm text-muted-foreground">{t.card.emptyDescription}</p>
                      ) : (
                        <div className="rounded-lg border border-border">
                          <Table>
                            <caption className="px-4 py-2 text-left text-sm text-muted-foreground">{t.card.tableCaption}</caption>
                            <TableHeader>
                              <TableRow>
                                <TableHead scope="col">{t.card.colDate}</TableHead>
                                <TableHead scope="col">{t.card.colType}</TableHead>
                                <TableHead scope="col">{t.card.colPoints}</TableHead>
                                <TableHead scope="col">{t.card.colReason}</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {transactions.map((tx) => (
                                <TableRow key={tx.id}>
                                  <TableCell className="tabular-nums">{new Date(tx.created_at).toLocaleString("pt-BR")}</TableCell>
                                  <TableCell>
                                    <Badge variant={tx.type === "credit" ? "secondary" : tx.type === "void" ? "destructive" : "outline"}>
                                      {transactionTypeLabel(tx.type)}
                                    </Badge>
                                  </TableCell>
                                  <TableCell className="tabular-nums font-medium text-foreground">{tx.points}</TableCell>
                                  <TableCell>{tx.reason ?? "—"}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">{t.card.searchPlaceholder}</p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="cupons">
              <Card>
                <CardHeader>
                  <CardTitle>{t.coupons.title}</CardTitle>
                  <CardDescription>{t.coupons.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  {couponsQuery.isLoading ? (
                    <Skeleton className="h-20 w-full" />
                  ) : coupons.length === 0 ? (
                    <StatePanel titulo={t.coupons.emptyTitle} descricao={t.coupons.emptyDescription}>
                      <Button variant="outline" onClick={() => setCouponOpen(true)}>
                        <Plus className="h-4 w-4" aria-hidden="true" />
                        {t.page.newCoupon}
                      </Button>
                    </StatePanel>
                  ) : (
                    <div className="rounded-lg border border-border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead scope="col">{t.coupons.colCode}</TableHead>
                            <TableHead scope="col">{t.coupons.colType}</TableHead>
                            <TableHead scope="col">{t.coupons.colValue}</TableHead>
                            <TableHead scope="col">{t.coupons.colValidity}</TableHead>
                            <TableHead scope="col">{t.coupons.colUsed}</TableHead>
                            <TableHead scope="col">{t.coupons.colStatus}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {coupons.map((coupon) => (
                            <TableRow key={coupon.id}>
                              <CouponRow coupon={coupon} />
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                  <p className="mt-3 text-xs text-muted-foreground">
                    {t.coupons.createDescription} {t.pdv.auditHint}
                  </p>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="gifts">
              <Card>
                <CardHeader>
                  <CardTitle>{t.gifts.title}</CardTitle>
                  <CardDescription>{t.gifts.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  {giftsQuery.isLoading ? (
                    <Skeleton className="h-20 w-full" />
                  ) : gifts.length === 0 ? (
                    <StatePanel titulo={t.gifts.emptyTitle} descricao={t.gifts.emptyDescription}>
                      <Button variant="outline" onClick={() => setGiftOpen(true)}>
                        <Plus className="h-4 w-4" aria-hidden="true" />
                        {t.page.newGiftCard}
                      </Button>
                    </StatePanel>
                  ) : (
                    <div className="rounded-lg border border-border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead scope="col">{t.gifts.colCode}</TableHead>
                            <TableHead scope="col">{t.gifts.colInitial}</TableHead>
                            <TableHead scope="col">{t.gifts.colBalance}</TableHead>
                            <TableHead scope="col">{t.gifts.colValidity}</TableHead>
                            <TableHead scope="col">{t.gifts.colStatus}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {gifts.map((g) => (
                            <TableRow key={g.id}>
                              <TableCell className="font-medium text-foreground tabular-nums">{g.code}</TableCell>
                              <TableCell className="tabular-nums">{formatCentsToBRL(g.initial_value_cents)}</TableCell>
                              <TableCell className="tabular-nums font-medium text-foreground">{formatCentsToBRL(g.balance_cents)}</TableCell>
                              <TableCell className="tabular-nums">{g.valid_until ?? "—"}</TableCell>
                              <TableCell>
                                <Badge variant={g.status === "active" ? "secondary" : "outline"}>{g.status}</Badge>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </EntitlementGate>

      <Dialog open={couponOpen} onOpenChange={setCouponOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t.coupons.createTitle}</DialogTitle>
            <DialogDescription>{t.coupons.createDescription}</DialogDescription>
          </DialogHeader>
          <Form {...couponForm}>
            <form onSubmit={couponForm.handleSubmit((v) => void handleSaveCoupon(v))} className="space-y-4">
              <FormField
                control={couponForm.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t.coupons.codeLabel}</FormLabel>
                    <FormControl>
                      <Input placeholder={t.coupons.codePlaceholder} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={couponForm.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t.coupons.typeLabel}</FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="percent">{t.coupons.typePercent}</SelectItem>
                          <SelectItem value="fixed">{t.coupons.typeFixed}</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={couponForm.control}
                  name="value"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t.coupons.valueLabel}</FormLabel>
                      <FormControl>
                        <Input type="number" min={1} inputMode="numeric" value={field.value} onChange={(e) => field.onChange(Number(e.target.value))} />
                      </FormControl>
                      <FormDescription>
                        {couponForm.watch("type") === "percent" ? t.coupons.valuePercentHint : t.coupons.valueFixedHint}
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={couponForm.control}
                  name="valid_until"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t.coupons.validUntilLabel}</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={couponForm.control}
                  name="usage_limit"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t.coupons.usageLabel}</FormLabel>
                      <FormControl>
                        <Input inputMode="numeric" placeholder={t.coupons.usagePlaceholder} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <DialogFooter className="gap-2 sm:gap-0">
                <Button type="button" variant="outline" onClick={() => setCouponOpen(false)}>
                  {t.coupons.cancel}
                </Button>
                <Button type="submit" disabled={saveCoupon.isPending}>
                  {saveCoupon.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                  {t.coupons.save}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Dialog open={giftOpen} onOpenChange={setGiftOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t.gifts.createTitle}</DialogTitle>
            <DialogDescription>{t.gifts.createDescription}</DialogDescription>
          </DialogHeader>
          <Form {...giftForm}>
            <form onSubmit={giftForm.handleSubmit((v) => void handleIssueGift(v))} className="space-y-4">
              <FormField
                control={giftForm.control}
                name="code"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t.gifts.codeLabel}</FormLabel>
                    <FormControl>
                      <Input placeholder={t.gifts.codePlaceholder} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={giftForm.control}
                name="initial_value_cents"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t.gifts.valueLabel}</FormLabel>
                    <FormControl>
                      <MoneyInput value={field.value} onChange={field.onChange} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={giftForm.control}
                name="valid_until"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t.gifts.validUntilLabel}</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <DialogFooter className="gap-2 sm:gap-0">
                <Button type="button" variant="outline" onClick={() => setGiftOpen(false)}>
                  {t.gifts.cancel}
                </Button>
                <Button type="submit" disabled={issueGift.isPending}>
                  {issueGift.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                  {t.gifts.save}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export { couponDiscountCents };
