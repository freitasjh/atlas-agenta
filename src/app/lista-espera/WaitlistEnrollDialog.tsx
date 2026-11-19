import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
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
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { WaitlistMessages } from "@/app/lista-espera/waitlist-messages";

interface EnrollMessages {
  required: string;
  invalidPeriod: string;
}

/**
 * O período desejado é obrigatório (`desired_start_from/to NOT NULL` no
 * banco); profissional é opcional (qualquer profissional). `tenant_id` nunca
 * no payload (RLS/RPC derivam do JWT).
 */
function makeEnrollSchema(t: EnrollMessages) {
  return z
    .object({
      customer_id: z.string().min(1, t.required),
      service_id: z.string().min(1, t.required),
      professional_id: z.string().optional().default(""),
      desired_start_from: z.string().min(1, t.required),
      desired_start_to: z.string().min(1, t.required),
      priority: z.coerce.number().int().min(1).max(3).default(1),
      expires_at: z.string().optional().default(""),
    })
    .refine((v) => v.desired_start_to > v.desired_start_from, {
      message: t.invalidPeriod,
      path: ["desired_start_to"],
    });
}

type EnrollSchema = ReturnType<typeof makeEnrollSchema>;

export type WaitlistEnrollValues = z.infer<EnrollSchema>;

export interface EnrollOption {
  id: string;
  name: string;
}

interface WaitlistEnrollDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  messages: WaitlistMessages;
  customers: EnrollOption[];
  services: EnrollOption[];
  professionals: EnrollOption[];
  submitting: boolean;
  initial?: Partial<WaitlistEnrollValues>;
  onSubmit: (values: WaitlistEnrollValues) => void;
}

/**
 * Inclusão na lista de espera (RF-08). CTA da agenda ao slot ocupado e botão
 * "Nova entrada" da página. RHF + zod com mensagens pt-BR do catálogo.
 */
export function WaitlistEnrollDialog({
  open,
  onOpenChange,
  messages,
  customers,
  services,
  professionals,
  submitting,
  initial,
  onSubmit,
}: WaitlistEnrollDialogProps) {
  const t = messages.enroll;
  const form = useForm<WaitlistEnrollValues>({
    resolver: zodResolver(makeEnrollSchema(t)),
    defaultValues: {
      customer_id: initial?.customer_id ?? "",
      service_id: initial?.service_id ?? "",
      professional_id: initial?.professional_id ?? "",
      desired_start_from: initial?.desired_start_from ?? "",
      desired_start_to: initial?.desired_start_to ?? "",
      priority: initial?.priority ?? 1,
      expires_at: initial?.expires_at ?? "",
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.title}</DialogTitle>
          <DialogDescription>{t.description}</DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form
            onSubmit={form.handleSubmit((values) => onSubmit(values))}
            className="space-y-4"
          >
            <FormField
              control={form.control}
              name="customer_id"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t.customerLabel}</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder={t.customerPlaceholder} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {customers.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="service_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t.serviceLabel}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={t.servicePlaceholder} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {services.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.name}
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
                name="professional_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t.professionalLabel}</FormLabel>
                    <Select
                      value={field.value || "__any__"}
                      onValueChange={(v) => field.onChange(v === "__any__" ? "" : v)}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={t.professionalPlaceholder} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="__any__">{t.anyProfessional}</SelectItem>
                        {professionals.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>{t.professionalHint}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="desired_start_from"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t.fromLabel}</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="desired_start_to"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t.toLabel}</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="priority"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t.priorityLabel}</FormLabel>
                    <Select
                      value={String(field.value)}
                      onValueChange={(v) => field.onChange(Number(v))}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="1">{messages.priority.baixa}</SelectItem>
                        <SelectItem value="2">{messages.priority.normal}</SelectItem>
                        <SelectItem value="3">{messages.priority.alta}</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="expires_at"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t.validityLabel}</FormLabel>
                    <FormControl>
                      <Input type="date" {...field} />
                    </FormControl>
                    <FormDescription>{t.validityHint}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                disabled={submitting}
                onClick={() => onOpenChange(false)}
              >
                {t.cancel}
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                {submitting ? t.submitting : t.submit}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
