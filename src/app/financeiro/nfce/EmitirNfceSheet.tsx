import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { maskDocument, stripDigits } from "@/lib/mask";
import { formatCentsToBRL, parseBRLToCents } from "@/lib/money";
import { useIssueNfce, type IssueNfceInput } from "@/hooks/useFiscalDocuments";
import type { FiscalDocument } from "@/lib/fiscal";

const emitirSchema = z.object({
  origem_tipo: z.enum(["appointment", "sale"]),
  origem_id: z.string().uuid("Identificador da origem inválido."),
  valor_reais: z
    .string()
    .refine((v) => {
      const cents = parseBRLToCents(v);
      return cents !== null && cents > 0;
    }, "Informe um valor maior que zero."),
  destinatario_documento: z
    .string()
    .optional()
    .refine(
      (v) => !v || v.trim().length === 0 || [11, 14].includes(stripDigits(v).length),
      "Documento deve ter 11 (CPF) ou 14 (CNPJ) dígitos.",
    ),
});

export type EmitirNfceValues = z.infer<typeof emitirSchema>;

interface EmitirNfceSheetProps {
  aberto: boolean;
  aoAlterarAberto: (aberto: boolean) => void;
  /** Pré-preenchimento do replay (contingência/rejeição → reemitir). */
  documentoBase?: FiscalDocument | null;
}

function toInput(values: EmitirNfceValues): IssueNfceInput {
  const cents = parseBRLToCents(values.valor_reais) ?? 0;
  const documento = stripDigits(values.destinatario_documento ?? "");
  return {
    origem_tipo: values.origem_tipo,
    origem_id: values.origem_id,
    valor_cents: cents,
    ...(documento.length > 0 ? { destinatario_documento: documento } : {}),
  };
}

/**
 * Sheet Emitir NFCe (ADR-03 RF-02/UX-SPEC A): origem + valor snapshot + CPF/CNPJ
 * com máscara; itens e pagamento exibidos somente leitura (a emissão nunca toca
 * o ledger). Replay da mesma origem devolve a mesma linha (`replayed`).
 */
export function EmitirNfceSheet({ aberto, aoAlterarAberto, documentoBase }: EmitirNfceSheetProps) {
  const emitir = useIssueNfce();
  const [resultado, setResultado] = useState<{ replayed: boolean } | null>(null);

  const form = useForm<EmitirNfceValues>({
    resolver: zodResolver(emitirSchema),
    defaultValues: {
      origem_tipo: (documentoBase?.origem_tipo as "appointment" | "sale") ?? "appointment",
      origem_id: documentoBase?.origem_id ?? "",
      valor_reais: documentoBase ? (documentoBase.valor_cents / 100).toFixed(2).replace(".", ",") : "",
      destinatario_documento: "",
    },
  });

  async function onSubmit(values: EmitirNfceValues) {
    setResultado(null);
    try {
      const resposta = await emitir.mutateAsync(toInput(values));
      setResultado({ replayed: resposta.replayed });
      form.reset(values);
    } catch {
      // Erro exibido abaixo (estado da mutation); sem toast global aqui.
    }
  }

  function aoFechar(abertoAtual: boolean) {
    aoAlterarAberto(abertoAtual);
    if (!abertoAtual) {
      setResultado(null);
      emitir.reset();
    }
  }

  return (
    <Sheet open={aberto} onOpenChange={aoFechar}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md" aria-label="Emitir nota fiscal">
        <SheetHeader>
          <SheetTitle>Emitir NFC-e</SheetTitle>
          <SheetDescription>
            {documentoBase
              ? "Reemissão da mesma origem: o replay é idempotente e nunca duplica a receita."
              : "Uma nota por atendimento ou venda. A emissão não altera recebimentos."}
          </SheetDescription>
        </SheetHeader>
        <form
          className="mt-6 space-y-4"
          onSubmit={form.handleSubmit(onSubmit)}
          noValidate
        >
          <div className="space-y-2">
            <Label htmlFor="nfce-origem-tipo">Origem</Label>
            <select
              id="nfce-origem-tipo"
              className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              {...form.register("origem_tipo")}
            >
              <option value="appointment">Atendimento</option>
              <option value="sale">Venda (PDV)</option>
            </select>
            {form.formState.errors.origem_tipo ? (
              <p className="text-sm text-destructive" role="alert">
                {form.formState.errors.origem_tipo.message}
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="nfce-origem-id">Identificador da origem</Label>
            <Input
              id="nfce-origem-id"
              placeholder="UUID do atendimento ou da venda"
              autoComplete="off"
              {...form.register("origem_id")}
            />
            {form.formState.errors.origem_id ? (
              <p className="text-sm text-destructive" role="alert">
                {form.formState.errors.origem_id.message}
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="nfce-valor">Valor (R$)</Label>
            <Input
              id="nfce-valor"
              inputMode="decimal"
              placeholder="45,00"
              autoComplete="off"
              {...form.register("valor_reais")}
            />
            {form.formState.errors.valor_reais ? (
              <p className="text-sm text-destructive" role="alert">
                {form.formState.errors.valor_reais.message}
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="nfce-documento">CPF/CNPJ do destinatário (opcional)</Label>
            <Input
              id="nfce-documento"
              inputMode="numeric"
              placeholder="000.000.000-00"
              autoComplete="off"
              {...form.register("destinatario_documento", {
                onChange: (e) => {
                  e.target.value = maskDocument(e.target.value);
                },
              })}
            />
            {form.formState.errors.destinatario_documento ? (
              <p className="text-sm text-destructive" role="alert">
                {form.formState.errors.destinatario_documento.message}
              </p>
            ) : null}
          </div>
          <div className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Itens e pagamento — somente leitura</p>
            <p className="mt-1">
              {documentoBase
                ? `Snapshot da origem: ${formatCentsToBRL(documentoBase.valor_cents)}. A reemissão preserva o valor e não gera novo recebimento.`
                : "Os itens e o pagamento vêm da origem e entram como retrato no documento fiscal."}
            </p>
          </div>
          {emitir.isError ? (
            <p className="text-sm text-destructive" role="alert">
              {emitir.error instanceof Error ? emitir.error.message : "Não foi possível emitir a nota fiscal."}
            </p>
          ) : null}
          {resultado ? (
            <p className="text-sm text-emerald-600" role="status">
              {resultado.replayed
                ? "Documento já existia para esta origem — nenhuma linha duplicada."
                : "Nota fiscal registrada."}
            </p>
          ) : null}
          <SheetFooter>
            <Button
              type="submit"
              className="min-h-11 w-full"
              disabled={emitir.isPending}
            >
              {emitir.isPending ? "Emitindo…" : documentoBase ? "Reemitir" : "Emitir nota"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
