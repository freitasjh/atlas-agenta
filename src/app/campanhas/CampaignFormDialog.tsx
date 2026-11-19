import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
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
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TemplatePreview } from "@/app/config/mensagens/TemplatePreview";
import { useMessageTemplates } from "@/hooks/useMessageTemplates";
import { useServices } from "@/hooks/useServices";
import { useTenant } from "@/hooks/useTenant";
import { getMessageTemplateLabel } from "@/lib/whatsapp";
import {
  CAMPAIGN_PRESETS,
  campaignFormSchema,
  formToSegment,
  presetLabel,
  type Campaign,
  type CampaignFormValues,
} from "@/app/campanhas/model";
import {
  campanhasMessages,
  formatCampanhasMessage,
} from "@/app/campanhas/campanhas-messages";

const t = campanhasMessages.form;

interface CampaignFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaign: Campaign | null;
  submitting: boolean;
  onSubmit: (values: {
    name: string;
    preset: Campaign["preset"];
    template_id: string | null;
    segment: Campaign["segment"];
    scheduled_at: string | null;
    status: "rascunho" | "agendada";
    scheduleMode: "draft" | "scheduled";
  }) => void;
}

/**
 * Criação/edição de campanha (RF-13): preset, segmentação, modelo da
 * biblioteca e agendamento. Salvar sem data = rascunho; com data = agendada.
 */
export function CampaignFormDialog({
  open,
  onOpenChange,
  campaign,
  submitting,
  onSubmit,
}: CampaignFormDialogProps) {
  const templatesQuery = useMessageTemplates();
  const servicesQuery = useServices();
  const tenantQuery = useTenant();
  const tenant = tenantQuery.data ?? null;

  void servicesQuery;

  const form = useForm<CampaignFormValues>({
    resolver: zodResolver(campaignFormSchema),
    defaultValues: {
      name: "",
      preset: "win_back",
      template_id: null,
      scheduled_at: null,
      tags: "",
      last_visit_before_days: "",
      no_show_min: "",
      birthday_month: "",
    },
  });

  useEffect(() => {
    if (!open) return;
    form.reset({
      name: campaign?.name ?? "",
      preset: campaign?.preset ?? "win_back",
      template_id: campaign?.template_id ?? null,
      scheduled_at: campaign?.scheduled_at
        ? campaign.scheduled_at.slice(0, 16)
        : null,
      tags: campaign?.segment.tags?.join(", ") ?? "",
      last_visit_before_days: campaign?.segment.last_visit_before_days
        ? String(campaign.segment.last_visit_before_days)
        : "",
      no_show_min: campaign?.segment.no_show_min
        ? String(campaign.segment.no_show_min)
        : "",
      birthday_month: campaign?.segment.birthday_month
        ? String(campaign.segment.birthday_month)
        : "",
    });
  }, [open, campaign, form]);

  const templateId = form.watch("template_id");
  const templateBody =
    templatesQuery.data?.find((row) => row.id === templateId)?.body ?? "";

  function handleSubmit(values: CampaignFormValues, scheduleMode: "draft" | "scheduled") {
    onSubmit({
      name: values.name.trim(),
      preset: values.preset,
      template_id: values.template_id,
      segment: formToSegment(values),
      scheduled_at:
        scheduleMode === "scheduled" && values.scheduled_at
          ? new Date(values.scheduled_at).toISOString()
          : null,
      status: scheduleMode === "scheduled" ? "agendada" : "rascunho",
      scheduleMode,
    });
  }

  const templates = (templatesQuery.data ?? []).filter((row) => row.active);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{campaign ? t.editTitle : t.createTitle}</DialogTitle>
          <DialogDescription>{t.createDescription}</DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form className="space-y-5" onSubmit={(e) => e.preventDefault()}>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t.nameLabel}</FormLabel>
                  <FormControl>
                    <Input placeholder={t.namePlaceholder} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="preset"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Preset</FormLabel>
                  <FormControl>
                    <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Preset da campanha">
                      {CAMPAIGN_PRESETS.map((preset) => (
                        <Button
                          key={preset}
                          type="button"
                          variant={field.value === preset ? "default" : "outline"}
                          aria-pressed={field.value === preset}
                          onClick={() => field.onChange(preset)}
                          className="min-h-[44px]"
                        >
                          {presetLabel(preset)}
                        </Button>
                      ))}
                    </div>
                  </FormControl>
                  <FormDescription>{t.presetDescription}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="template_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t.templateLabel}</FormLabel>
                  <Select
                    value={field.value ?? ""}
                    onValueChange={(v) => field.onChange(v === "" ? null : v)}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={t.templatePlaceholder} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {templates.length === 0 ? (
                        <SelectItem value="__empty" disabled>
                          {t.templateEmpty}
                        </SelectItem>
                      ) : (
                        templates.map((row) => (
                          <SelectItem key={row.id} value={row.id}>
                            {getMessageTemplateLabel(row.template_key)} — {row.body.slice(0, 40)}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                  <FormDescription>{t.templateDescription}</FormDescription>
                  <FormMessage />
                  {templateBody ? (
                    <TemplatePreview
                      body={templateBody}
                      empresa={tenant?.trade_name ?? null}
                      legalName={tenant?.legal_name ?? null}
                    />
                  ) : null}
                </FormItem>
              )}
            />

            <fieldset className="space-y-4 rounded-lg border border-border p-4">
              <legend className="px-1 text-sm font-medium">{t.segmentTitle}</legend>
              <p className="-mt-2 text-xs text-muted-foreground">{t.segmentDescription}</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="tags"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t.tagsLabel}</FormLabel>
                      <FormControl>
                        <Input placeholder={t.tagsPlaceholder} {...field} value={field.value ?? ""} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="last_visit_before_days"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t.lastVisitLabel}</FormLabel>
                      <FormControl>
                        <Input
                          inputMode="numeric"
                          placeholder={t.lastVisitPlaceholder}
                          {...field}
                          value={field.value ?? ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="no_show_min"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t.noShowLabel}</FormLabel>
                      <FormControl>
                        <Input
                          inputMode="numeric"
                          placeholder={t.noShowPlaceholder}
                          {...field}
                          value={field.value ?? ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="birthday_month"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t.birthdayLabel}</FormLabel>
                      <FormControl>
                        <Input
                          inputMode="numeric"
                          placeholder={t.birthdayPlaceholder}
                          {...field}
                          value={field.value ?? ""}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </fieldset>

            <FormField
              control={form.control}
              name="scheduled_at"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t.scheduleLabel}</FormLabel>
                  <FormControl>
                    <Input
                      type="datetime-local"
                      {...field}
                      value={field.value ?? ""}
                      onChange={(e) => field.onChange(e.target.value === "" ? null : e.target.value)}
                    />
                  </FormControl>
                  <FormDescription>{t.scheduleDescription}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                disabled={submitting}
                onClick={() => onOpenChange(false)}
              >
                {t.cancel}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={submitting}
                onClick={() => void form.handleSubmit((v) => handleSubmit(v, "draft"))()}
              >
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {submitting ? formatCampanhasMessage(t.saving, {}) : t.saveDraft}
              </Button>
              <Button
                type="button"
                disabled={submitting}
                onClick={() => void form.handleSubmit((v) => handleSubmit(v, "scheduled"))()}
              >
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {submitting ? t.saving : t.saveScheduled}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
