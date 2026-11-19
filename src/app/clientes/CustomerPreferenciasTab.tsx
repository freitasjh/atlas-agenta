import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { zodResolver } from "@hookform/resolvers/zod";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { crmMessages } from "@/app/clientes/crm-messages";
import { useCustomerPreferences, useUpdateCustomerPreferences } from "@/hooks/useCustomerCrm";
import { usePermissions } from "@/hooks/usePermissions";

const t = crmMessages.preferencias;

const preferenciasSchema = z.object({
  preferredTimeWindow: z.string().max(60).optional().or(z.literal("")),
  observations: z.string().max(2000).optional().or(z.literal("")),
  tags: z.string().max(300).optional().or(z.literal("")),
  segment: z.string().max(60).optional().or(z.literal("")),
});

type PreferenciasForm = z.infer<typeof preferenciasSchema>;

export function CustomerPreferenciasTab({ customerId }: { customerId: string }) {
  const { canManageCustomers } = usePermissions();
  const prefsQuery = useCustomerPreferences(customerId);
  const updateMutation = useUpdateCustomerPreferences(customerId);

  const form = useForm<PreferenciasForm>({
    resolver: zodResolver(preferenciasSchema),
    defaultValues: { preferredTimeWindow: "", observations: "", tags: "", segment: "" },
  });

  useEffect(() => {
    const prefs = prefsQuery.data;
    if (prefs) {
      form.reset({
        preferredTimeWindow: prefs.preferredTimeWindow ?? "",
        observations: prefs.observations ?? "",
        tags: (prefs.tags ?? []).join(", "),
        segment: prefs.segment ?? "",
      });
    }
  }, [prefsQuery.data, form]);

  if (prefsQuery.isLoading) {
    return <Skeleton className="h-48 w-full" aria-label={t.loading} />;
  }

  if (!canManageCustomers) {
    const prefs = prefsQuery.data;
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t.title}</CardTitle>
          <CardDescription>{t.readOnlyHint}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            <span className="text-muted-foreground">{t.timeWindowLabel}: </span>
            <span className="text-foreground">{prefs?.preferredTimeWindow ?? "—"}</span>
          </p>
          <p>
            <span className="text-muted-foreground">{t.segmentLabel}: </span>
            <span className="text-foreground">{prefs?.segment ?? "—"}</span>
          </p>
          <p>
            <span className="text-muted-foreground">{t.observationsLabel}: </span>
            <span className="text-foreground">{prefs?.observations ?? "—"}</span>
          </p>
          <p>
            <span className="text-muted-foreground">{t.tagsLabel}: </span>
            <span className="text-foreground">
              {(prefs?.tags ?? []).length > 0 ? (prefs?.tags ?? []).join(", ") : "—"}
            </span>
          </p>
        </CardContent>
      </Card>
    );
  }

  async function onSubmit(values: PreferenciasForm) {
    const tags = (values.tags ?? "")
      .split(",")
      .map((tag) => tag.trim())
      .filter((tag) => tag !== "");
    try {
      await updateMutation.mutateAsync({
        preferredProfessionalId: prefsQuery.data?.preferredProfessionalId ?? null,
        preferredTimeWindow: values.preferredTimeWindow || null,
        observations: values.observations || null,
        tags,
        segment: values.segment || null,
      });
      toast.success(t.saveSuccess);
    } catch {
      toast.error(t.saveError);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.title}</CardTitle>
        <CardDescription>{t.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="preferredTimeWindow"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t.timeWindowLabel}</FormLabel>
                  <FormControl>
                    <Input placeholder={t.timeWindowPlaceholder} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="observations"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t.observationsLabel}</FormLabel>
                  <FormControl>
                    <Textarea placeholder={t.observationsPlaceholder} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="tags"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t.tagsLabel}</FormLabel>
                  <FormControl>
                    <Input placeholder={t.tagsPlaceholder} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="segment"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t.segmentLabel}</FormLabel>
                  <FormControl>
                    <Input placeholder={t.segmentPlaceholder} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" disabled={updateMutation.isPending}>
              {updateMutation.isPending ? t.saving : t.save}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
