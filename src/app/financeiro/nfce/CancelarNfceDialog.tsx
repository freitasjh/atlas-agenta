import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCancelNfce } from "@/hooks/useFiscalDocuments";
import type { FiscalDocument } from "@/lib/fiscal";

const acaoSchema = z.object({
  acao: z.enum(["cancelamento", "carta"]),
  motivo: z
    .string()
    .trim()
    .min(15, "Descreva o motivo com ao menos 15 caracteres.")
    .max(1000, "Motivo muito longo (máximo 1000 caracteres)."),
});

type AcaoValues = z.infer<typeof acaoSchema>;

interface CancelarNfceDialogProps {
  documento: FiscalDocument | null;
  aoFechar: () => void;
}

/**
 * Cancelamento e carta de correção (ADR-03 RF-04): motivo auditável obrigatório
 * (mínimo 15 caracteres), XML/DANFE preservados pela Edge. Carta não muda o
 * estado — só anexa o evento à trilha.
 */
export function CancelarNfceDialog({ documento, aoFechar }: CancelarNfceDialogProps) {
  const operacao = useCancelNfce();
  const form = useForm<AcaoValues>({
    resolver: zodResolver(acaoSchema),
    defaultValues: { acao: "cancelamento", motivo: "" },
  });

  async function onSubmit(values: AcaoValues) {
    if (!documento) return;
    try {
      await operacao.mutateAsync({
        fiscal_document_id: documento.id,
        acao: values.acao,
        motivo: values.motivo.trim(),
      });
      form.reset();
      operacao.reset();
      aoFechar();
    } catch {
      // Erro exibido abaixo; sem toast global aqui.
    }
  }

  function aoAbrir(v: boolean) {
    if (!v) {
      form.reset();
      operacao.reset();
      aoFechar();
    }
  }

  return (
    <Dialog open={documento !== null} onOpenChange={aoAbrir}>
      <DialogContent className="sm:max-w-md" aria-label="Cancelar nota fiscal ou emitir carta de correção">
        <DialogHeader>
          <DialogTitle>
            {documento?.numero ? `NFC-e nº ${documento.numero}` : "Documento fiscal"}
          </DialogTitle>
          <DialogDescription>
            O XML e a DANFE são preservados. A operação entra na trilha auditável com o seu usuário.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <div className="space-y-2">
            <Label htmlFor="nfce-acao">Operação</Label>
            <select
              id="nfce-acao"
              className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              {...form.register("acao")}
            >
              <option value="cancelamento">Cancelamento</option>
              <option value="carta">Carta de correção</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="nfce-motivo">Motivo</Label>
            <Textarea
              id="nfce-motivo"
              rows={4}
              placeholder="Descreva o motivo com ao menos 15 caracteres"
              {...form.register("motivo")}
            />
            {form.formState.errors.motivo ? (
              <p className="text-sm text-destructive" role="alert">
                {form.formState.errors.motivo.message}
              </p>
            ) : null}
          </div>
          {operacao.isError ? (
            <p className="text-sm text-destructive" role="alert">
              {operacao.error instanceof Error ? operacao.error.message : "Não foi possível concluir a operação."}
            </p>
          ) : null}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" className="min-h-11" onClick={() => aoAbrir(false)}>
              Voltar
            </Button>
            <Button type="submit" variant="destructive" className="min-h-11" disabled={operacao.isPending}>
              {operacao.isPending ? "Registrando…" : "Confirmar"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
