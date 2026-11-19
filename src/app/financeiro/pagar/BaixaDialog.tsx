import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PAYABLES_BUCKET, usePayableSettlements, useSettlePayable } from "@/hooks/usePayables";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { supabase } from "@/lib/supabase";
import {
  baixaSchema,
  contentTypeAnexo,
  extensaoAnexo,
  mapAnexoError,
  restoPayable,
  validateAnexoFile,
  type BaixaInput,
  type Payable,
} from "@/lib/pagar";
import { formatCentsToBRL, parseBRLToCents } from "@/lib/money";

interface BaixaDialogProps {
  conta: Payable | null;
  aoFechar: () => void;
}

/**
 * Baixa total/parcial (ADR-06 RF-16): valor, data, conta e anexo opcional
 * (bucket privado `payables/`, path `<tenant>/<conta>/*`). A parcial mostra o
 * resto que segue pendente na mesma conta; a total zera e vira `pago`.
 */
export function BaixaDialog({ conta, aoFechar }: BaixaDialogProps) {
  const baixar = useSettlePayable();
  const baixas = usePayableSettlements(conta?.id ?? null, conta !== null);
  const { tenant } = useCurrentUser();
  const [erro, setErro] = useState<string | null>(null);
  const [anexo, setAnexo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const form = useForm<BaixaInput>({
    resolver: zodResolver(baixaSchema),
    defaultValues: { valorReais: "", pagoEm: "", conta: "" },
  });

  const somado = useMemo(
    () => (baixas.data ?? []).reduce((acc, s) => acc + s.valor_cents, 0),
    [baixas.data],
  );
  const resto = conta ? restoPayable(conta.valor_cents, somado) : 0;

  function aoAbrir(v: boolean) {
    if (!v) {
      form.reset();
      baixar.reset();
      setErro(null);
      setAnexo(null);
      aoFechar();
    }
  }

  async function onSubmit(values: BaixaInput) {
    if (!conta) return;
    setErro(null);
    const cents = parseBRLToCents(values.valorReais);
    if (cents === null || cents <= 0) {
      form.setError("valorReais", { message: "Informe um valor maior que zero." });
      return;
    }
    if (cents > resto) {
      form.setError("valorReais", { message: `O valor passa do resto pendente (${formatCentsToBRL(resto)}).` });
      return;
    }
    const pagoEm = new Date(values.pagoEm);
    if (Number.isNaN(pagoEm.getTime())) {
      form.setError("pagoEm", { message: "Informe uma data válida." });
      return;
    }
    setEnviando(true);
    try {
      let anexoPath: string | null = null;
      if (anexo) {
        const invalido = validateAnexoFile(anexo);
        if (invalido) throw new Error(mapAnexoError(invalido));
        const tenantId = (tenant as unknown as { id: string } | null)?.id;
        if (!tenantId) throw new Error("Sessão sem empresa ativa.");
        const ext = extensaoAnexo(anexo.name) || "pdf";
        anexoPath = `${tenantId}/${conta.id}/${Date.now()}.${ext}`;
        const { error } = await supabase.storage
          .from(PAYABLES_BUCKET)
          .upload(anexoPath, anexo, { contentType: contentTypeAnexo(anexo.name, anexo.type), upsert: false });
        if (error) throw new Error("Não foi possível enviar o anexo. Tente novamente.");
      }
      await baixar.mutateAsync({
        payable_id: conta.id,
        valor_cents: cents,
        pago_at: pagoEm.toISOString(),
        conta: values.conta?.trim() || null,
        anexo_path: anexoPath,
      });
      form.reset();
      baixar.reset();
      setAnexo(null);
      aoFechar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível registrar a baixa.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Dialog open={conta !== null} onOpenChange={aoAbrir}>
      <DialogContent className="sm:max-w-md" aria-label="Registrar baixa da conta">
        <DialogHeader>
          <DialogTitle>{conta ? `Baixa · ${conta.descricao}` : "Baixa"}</DialogTitle>
          <DialogDescription>
            {conta ? (
              <>
                Total {formatCentsToBRL(conta.valor_cents)} · já baixado {formatCentsToBRL(somado)} ·{" "}
                <strong>resto {formatCentsToBRL(resto)}</strong>. A parcial mantém o resto pendente na mesma conta.
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)} noValidate>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="baixa-valor">Valor (R$)</Label>
              <Input
                id="baixa-valor"
                autoComplete="off"
                inputMode="decimal"
                placeholder="0,00"
                {...form.register("valorReais")}
              />
              {form.formState.errors.valorReais ? (
                <p className="text-sm text-destructive">{form.formState.errors.valorReais.message}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="baixa-data">Data do pagamento</Label>
              <Input id="baixa-data" type="datetime-local" {...form.register("pagoEm")} />
              {form.formState.errors.pagoEm ? (
                <p className="text-sm text-destructive">{form.formState.errors.pagoEm.message}</p>
              ) : null}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="baixa-conta">Conta (opcional)</Label>
            <Input
              id="baixa-conta"
              autoComplete="off"
              placeholder="Ex.: Caixa, Banco"
              {...form.register("conta")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="baixa-anexo">Anexo (opcional, PDF/JPG/PNG até 10 MB)</Label>
            <Input
              id="baixa-anexo"
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/jpg"
              onChange={(e) => setAnexo(e.target.files?.[0] ?? null)}
            />
            {anexo ? <p className="text-xs text-muted-foreground">{anexo.name}</p> : null}
          </div>
          {erro ? (
            <p role="alert" className="text-sm text-destructive">
              {erro}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" className="min-h-11" onClick={() => aoAbrir(false)}>
              Cancelar
            </Button>
            <Button type="submit" className="min-h-11" disabled={baixar.isPending || enviando}>
              {baixar.isPending || enviando ? "Registrando…" : "Registrar baixa"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
