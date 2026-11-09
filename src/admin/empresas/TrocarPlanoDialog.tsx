import * as React from "react";
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
  DialogTrigger,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { getPlan, PLANS, type PlanSlug } from "@/lib/plans";
import { mapPlanError } from "@/lib/plan-errors";
import {
  changePlanFormSchema,
  PLAN_REASON_MAX_LENGTH,
  type ChangePlanFormValues,
} from "@/lib/validations/admin-plan";
import {
  isUsageOverPlan,
  PLAN_PRESENTATION_LIMITS,
  useSetTenantPlan,
  useTenantPlanUsage,
} from "@/hooks/useSetPlan";
import type { TenantListItem } from "@/types/domain";

function displayName(tenant: TenantListItem): string {
  const trade = tenant.trade_name?.trim();
  return trade && trade.length > 0 ? trade : tenant.legal_name;
}

function limitLabel(value: number | null): string {
  return value === null ? "ilimitado" : String(value);
}

function UsageBar({ used, limit }: { used: number; limit: number | null }) {
  if (limit === null) {
    return (
      <p className="text-sm text-muted-foreground tabular-nums">
        {used} · ilimitado
      </p>
    );
  }
  const pct = Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
  const over = used > limit;
  return (
    <div className="space-y-1">
      <p className="text-sm tabular-nums">
        {used} / {limit}
      </p>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-label={over ? "Uso acima do limite" : "Uso dentro do limite"}
      >
        <div
          className={`h-full rounded-full ${over ? "bg-destructive" : "bg-primary"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

interface TrocarPlanoDialogProps {
  tenant: TenantListItem;
}

/**
 * Wizard "Trocar plano" em 3 passos (decisão vinculante do ux-designer):
 * 1 Uso atual (barras + "sem agendamento futuro" Fase 1) → 2 Destino + motivo
 * obrigatório (10..280, contador) → 3 Preview diff tabular.
 * Confirmar bloqueado se uso acima sem override; override exige double-confirm
 * (checkbox explícito). Sucesso: toast aria-live pt-BR + callback fecha e a
 * lista invalida (histórico no topo ≤2s via revalidate da página de plano).
 * Falha: dialog preserva dados + retry, erro em role="alert" com foco.
 */
export function TrocarPlanoDialog({ tenant }: TrocarPlanoDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState(1);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const errorRef = React.useRef<HTMLParagraphElement>(null);
  const firstInvalidRef = React.useRef<HTMLButtonElement>(null);

  const usageQuery = useTenantPlanUsage(open ? tenant.id : null);
  const setPlan = useSetTenantPlan();

  const form = useForm<ChangePlanFormValues>({
    resolver: zodResolver(changePlanFormSchema),
    defaultValues: { plan: tenant.plan, reason: "", override: false },
    mode: "onTouched",
  });

  React.useEffect(() => {
    if (open) {
      form.reset({ plan: tenant.plan, reason: "", override: false });
      setStep(1);
      setSubmitError(null);
    }
  }, [open, tenant.plan, form]);

  const watchedPlan = form.watch("plan");
  const watchedReason = form.watch("reason") ?? "";
  const watchedOverride = form.watch("override") ?? false;
  const usage = usageQuery.data;
  const overLimit = isUsageOverPlan(usage, watchedPlan);
  const destLimits = watchedPlan ? PLAN_PRESENTATION_LIMITS[watchedPlan] : null;

  function focusFirstInvalid() {
    // Foca o primeiro campo inválido (destino ou motivo) para leitor de tela.
    const errors = form.formState.errors;
    const planEl = document.querySelector<HTMLElement>('[name="plan-trigger"]');
    const reasonEl = document.querySelector<HTMLElement>('[name="reason"]');
    if (errors.plan && planEl) planEl.focus();
    else if (errors.reason && reasonEl) reasonEl.focus();
    else firstInvalidRef.current?.focus();
  }

  async function goToPreview() {
    const valid = await form.trigger(["plan", "reason"]);
    if (!valid) {
      focusFirstInvalid();
      return;
    }
    setSubmitError(null);
    setStep(3);
  }

  async function onConfirm() {
    setSubmitError(null);
    const values = form.getValues();
    if (overLimit && !values.override) return;
    try {
      await setPlan.mutateAsync({
        tenantId: tenant.id,
        plan: values.plan,
        reason: values.reason.trim(),
        override: values.override,
      });
      toast.success("Plano atualizado.");
      setOpen(false);
    } catch (error) {
      const message = mapPlanError(error);
      setSubmitError(message);
      requestAnimationFrame(() => errorRef.current?.focus());
    }
  }

  const isSaving = setPlan.isPending;
  const reasonCount = watchedReason.trim().length;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="min-h-[44px]">
          Trocar plano
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[90dvh] w-full overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Trocar plano — {displayName(tenant)}</DialogTitle>
          <DialogDescription>
            Passo {step} de 3: {step === 1 ? "uso atual" : step === 2 ? "destino e motivo" : "revisão e confirmação"}.
          </DialogDescription>
        </DialogHeader>

        <ol className="flex gap-2 text-xs" aria-label="Progresso">
          {[1, 2, 3].map((n) => (
            <li
              key={n}
              aria-current={step === n ? "step" : undefined}
              className={`rounded-full px-3 py-1.5 ${step === n ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
            >
              {n === 1 ? "1 · Uso" : n === 2 ? "2 · Destino" : "3 · Revisão"}
            </li>
          ))}
        </ol>

        {step === 1 ? (
          <div className="space-y-4">
            {usageQuery.isLoading ? (
              <div className="space-y-2" aria-busy="true">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : usageQuery.isError || !usage ? (
              <div className="space-y-3">
                <p role="alert" className="text-sm text-destructive">
                  Não foi possível carregar o uso atual. Tente novamente.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-[44px]"
                  onClick={() => void usageQuery.refetch()}
                >
                  Tentar novamente
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-medium">Plano atual: {getPlan(tenant.plan).nome}</p>
                  <p className="text-xs text-muted-foreground">Mês de referência: {usage.month_key}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium">👥 Profissionais ativos</p>
                  <UsageBar used={usage.active_professionals} limit={destLimits?.prof ?? null} />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium">📅 Agendamentos no mês</p>
                  <UsageBar used={usage.month_appointments} limit={destLimits?.appt ?? null} />
                </div>
                <p className="text-xs text-muted-foreground">
                  Sem agendamento futuro nesta fase (Fase 1): a troca é imediata e preserva os dados acima do limite.
                </p>
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" className="min-h-[44px]" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button
                ref={firstInvalidRef}
                type="button"
                className="min-h-[44px]"
                disabled={usageQuery.isLoading || usageQuery.isError}
                onClick={() => setStep(2)}
              >
                Continuar
              </Button>
            </DialogFooter>
          </div>
        ) : null}

        {step === 2 ? (
          <Form {...form}>
            <form className="space-y-5" noValidate onSubmit={(e) => { e.preventDefault(); void goToPreview(); }}>
              <FormField
                control={form.control}
                name="plan"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Plano destino</FormLabel>
                    <Select value={field.value} onValueChange={(v) => field.onChange(v as PlanSlug)}>
                      <FormControl>
                        <SelectTrigger name="plan-trigger" className="min-h-[44px]">
                          <SelectValue placeholder="Selecione o plano destino" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {PLANS.map((p) => (
                          <SelectItem key={p.slug} value={p.slug}>
                            {p.nome} — {limitLabel(PLAN_PRESENTATION_LIMITS[p.slug].prof)} prof ·{" "}
                            {limitLabel(PLAN_PRESENTATION_LIMITS[p.slug].appt)} agend.
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="reason"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Motivo (obrigatório)</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Ex.: equipe cresceu de 1 para 3 profissionais."
                        maxLength={PLAN_REASON_MAX_LENGTH}
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormDescription>
                      {reasonCount}/{PLAN_REASON_MAX_LENGTH} · mínimo 10 caracteres. Fica registrado na auditoria.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {overLimit ? (
                <div className="space-y-3 rounded-md border border-destructive/50 p-3">
                  <p role="alert" className="text-sm font-medium text-destructive">
                    ⚠️ Uso atual acima do limite do plano {watchedPlan ? getPlan(watchedPlan).nome : ""}. A troca só
                    avança com confirmação explícita.
                  </p>
                  <FormField
                    control={form.control}
                    name="override"
                    render={({ field }) => (
                      <FormItem className="flex flex-row items-start gap-3 space-y-0">
                        <FormControl>
                          <Checkbox
                            checked={field.value}
                            onCheckedChange={(v) => field.onChange(v === true)}
                            aria-label="Confirmo a troca mesmo acima do limite"
                            className="mt-1 h-6 w-6"
                          />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel>Confirmo a troca mesmo acima do limite (double-confirm)</FormLabel>
                          <FormDescription>
                            Os dados excedentes são preservados; novas criações ficam bloqueadas (PLAN_LIMIT).
                          </FormDescription>
                        </div>
                      </FormItem>
                    )}
                  />
                </div>
              ) : null}

              {submitError ? (
                <p
                  ref={errorRef}
                  tabIndex={-1}
                  role="alert"
                  className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive"
                >
                  {submitError}
                </p>
              ) : null}

              <DialogFooter>
                <Button type="button" variant="outline" className="min-h-[44px]" onClick={() => setStep(1)}>
                  Voltar
                </Button>
                <Button type="submit" className="min-h-[44px]">
                  Revisar
                </Button>
              </DialogFooter>
            </form>
          </Form>
        ) : null}

        {step === 3 ? (
          <div className="space-y-4">
            <table className="w-full text-sm">
              <caption className="sr-only">Diferença de limites entre plano atual e destino</caption>
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1 pr-2 font-medium">Limite</th>
                  <th className="py-1 pr-2 font-medium tabular-nums">Atual ({getPlan(tenant.plan).nome})</th>
                  <th className="py-1 font-medium tabular-nums">Destino ({watchedPlan ? getPlan(watchedPlan).nome : "—"})</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                <tr className="border-t">
                  <td className="py-2 pr-2">👥 Profissionais</td>
                  <td className="py-2 pr-2">{limitLabel(PLAN_PRESENTATION_LIMITS[tenant.plan].prof)}</td>
                  <td className="py-2">{destLimits ? limitLabel(destLimits.prof) : "—"}</td>
                </tr>
                <tr className="border-t">
                  <td className="py-2 pr-2">📅 Agend./mês</td>
                  <td className="py-2 pr-2">{limitLabel(PLAN_PRESENTATION_LIMITS[tenant.plan].appt)}</td>
                  <td className="py-2">{destLimits ? limitLabel(destLimits.appt) : "—"}</td>
                </tr>
                <tr className="border-t">
                  <td className="py-2 pr-2">Uso atual</td>
                  <td className="py-2 pr-2" colSpan={2}>
                    {usage ? `${usage.active_professionals} prof · ${usage.month_appointments} agend.` : "—"}
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="text-sm text-muted-foreground">
              Motivo: <span className="text-foreground">{watchedReason.trim()}</span>
              {watchedOverride ? " · com confirmação acima do limite." : ""}
            </p>

            {submitError ? (
              <p
                ref={errorRef}
                tabIndex={-1}
                role="alert"
                className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive"
              >
                {submitError}
              </p>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" className="min-h-[44px]" onClick={() => setStep(2)} disabled={isSaving}>
                Voltar
              </Button>
              <Button
                type="button"
                className="min-h-[44px]"
                disabled={isSaving || (overLimit && !watchedOverride)}
                title={overLimit && !watchedOverride ? "Confirme acima do limite para avançar." : undefined}
                onClick={() => void onConfirm()}
              >
                {isSaving ? (
                  <>
                    <Loader2 className="animate-spin" aria-hidden="true" />
                    Salvando…
                  </>
                ) : (
                  "Confirmar troca"
                )}
              </Button>
            </DialogFooter>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
