import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { z } from "zod";

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
} from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";

const motivoSchema = z.object({
  motivo: z
    .string()
    .trim()
    .min(3, "Informe o motivo do cancelamento.")
    .max(500, "O motivo é muito longo."),
});

export type CancelarMotivo = z.infer<typeof motivoSchema>;

interface CancelarAssinaturaDialogProps {
  aberto: boolean;
  aoAlterarAberto: (aberto: boolean) => void;
  clienteNome: string;
  salvando: boolean;
  aoConfirmar: (motivo: string) => void;
}

/**
 * Cancelamento de assinatura com motivo obrigatório (ADR-05 RF-10):
 * o motivo é auditado (quem/quando/motivo visível no drawer). Sem motivo
 * não há request — o zod bloqueia no cliente.
 */
export function CancelarAssinaturaDialog({
  aberto,
  aoAlterarAberto,
  clienteNome,
  salvando,
  aoConfirmar,
}: CancelarAssinaturaDialogProps) {
  const form = useForm<CancelarMotivo>({
    resolver: zodResolver(motivoSchema),
    defaultValues: { motivo: "" },
  });

  function confirmar(valores: CancelarMotivo) {
    aoConfirmar(valores.motivo);
  }

  return (
    <Dialog
      open={aberto}
      onOpenChange={(v) => {
        if (!v) form.reset();
        aoAlterarAberto(v);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cancelar assinatura</DialogTitle>
          <DialogDescription>
            A assinatura de {clienteNome} será encerrada. O motivo fica
            registrado na auditoria. Esta ação não apaga o histórico.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(confirmar)} className="space-y-4">
            <FormField
              control={form.control}
              name="motivo"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Motivo do cancelamento</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="Ex.: cliente solicitou pausa por viagem"
                      rows={3}
                      autoComplete="off"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={salvando}
                onClick={() => aoAlterarAberto(false)}
              >
                Voltar
              </Button>
              <Button
                type="submit"
                variant="destructive"
                className="min-h-11"
                disabled={salvando}
              >
                {salvando && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                )}
                {salvando ? "Cancelando..." : "Confirmar cancelamento"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
