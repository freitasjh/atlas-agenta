import { useEffect, useState } from "react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

import { professionalSchema, type ProfessionalInput } from "@/lib/validations/catalog";
import {
  useCreateProfessional,
  useUpdateProfessional,
} from "@/hooks/useProfessionals";
import {
  useProfessionalCommission,
  useUpsertProfessionalCommission,
} from "@/hooks/useProfessionalCommission";
import { useSegmentFeatures } from "@/hooks/useSegmentFeatures";
import { usePermissions } from "@/hooks/usePermissions";
import { formatBpsToPercent, parsePercentToBps } from "@/lib/commission";
import type { Professional } from "@/types/domain";

interface ProfessionalFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Profissional a editar; `null`/ausente cria um novo. */
  professional?: Professional | null;
}

const EMPTY_VALUES: ProfessionalInput = {
  name: "",
  active: true,
};

/**
 * Diálogo de criar/editar profissional (react-hook-form + `professionalSchema`).
 * `profile_id` é **somente-leitura** nesta fase (sem fluxo de convite, D9):
 * criar um profissional grava apenas o registro operacional. Quando o
 * profissional já tem login vinculado, isso é exibido de forma informativa, sem
 * campo editável.
 */
export function ProfessionalFormDialog({
  open,
  onOpenChange,
  professional,
}: ProfessionalFormDialogProps) {
  const isEdit = !!professional;
  const hasLogin = !!professional?.profile_id;

  // Comissão só é editável para barbearia (gating de UI) e só por quem gerencia
  // (admin). A trava real é o RLS `professional_commissions_write_admin`.
  const { commission: commissionFeature } = useSegmentFeatures();
  const { canManageCommission } = usePermissions();
  const showCommission = commissionFeature && canManageCommission;

  const createProfessional = useCreateProfessional();
  const updateProfessional = useUpdateProfessional();
  const upsertCommission = useUpsertProfessionalCommission();

  // Lê a taxa atual (em bps) só quando o campo é visível e há um profissional
  // em edição. Novo profissional ainda não tem linha de comissão.
  const commissionQuery = useProfessionalCommission(professional?.id ?? null, {
    enabled: open && showCommission && isEdit,
  });

  const form = useForm<ProfessionalInput>({
    resolver: zodResolver(professionalSchema),
    defaultValues: EMPTY_VALUES,
  });

  // Draft de texto do campo "Comissão (%)": permite digitar decimais pt-BR
  // ("12,5") sem que a conversão para bps atrapalhe. A fonte de verdade é o
  // `commissionBps` do form; este draft é só a representação visível.
  const [commissionDraft, setCommissionDraft] = useState("");

  // Ao (re)abrir, sincroniza o form com o profissional selecionado (ou novo).
  useEffect(() => {
    if (!open) return;
    if (professional) {
      form.reset({ name: professional.name, active: professional.active });
    } else {
      form.reset(EMPTY_VALUES);
    }
  }, [open, professional, form]);

  // Popular a % lida (percent ← bps) quando o diálogo abre em modo edição e a
  // taxa chega. Em criação o campo começa vazio (0 bps → "").
  useEffect(() => {
    if (!open || !showCommission) return;
    if (isEdit && commissionQuery.data !== undefined) {
      const bps = commissionQuery.data;
      form.setValue("commissionBps", bps, { shouldDirty: false });
      setCommissionDraft(bps > 0 ? formatBpsToPercent(bps) : "");
    } else if (!isEdit) {
      form.setValue("commissionBps", undefined, { shouldDirty: false });
      setCommissionDraft("");
    }
  }, [open, showCommission, isEdit, commissionQuery.data, form]);

  const isSaving =
    createProfessional.isPending ||
    updateProfessional.isPending ||
    upsertCommission.isPending;

  async function onSubmit(values: ProfessionalInput) {
    try {
      let professionalId: string;
      if (professional) {
        await updateProfessional.mutateAsync({
          id: professional.id,
          name: values.name,
          active: values.active,
        });
        professionalId = professional.id;
      } else {
        const created = await createProfessional.mutateAsync({
          name: values.name,
          active: values.active,
        });
        professionalId = created.id;
      }

      // Persistir a % só quando o campo está habilitado (barbearia + admin) e
      // houve um valor informado. A FK composta exige um profissional já criado.
      if (showCommission && values.commissionBps !== undefined) {
        await upsertCommission.mutateAsync({
          professionalId,
          commissionBps: values.commissionBps,
        });
      }

      toast.success(
        professional ? "Profissional atualizado." : "Profissional criado.",
      );
      onOpenChange(false);
    } catch {
      toast.error("Não foi possível salvar o profissional. Tente novamente.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Editar profissional" : "Novo profissional"}
          </DialogTitle>
          <DialogDescription>
            Informe o nome de quem atende na sua empresa.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form
            onSubmit={form.handleSubmit(onSubmit)}
            className="space-y-5"
            noValidate
          >
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Ex.: Dra. Ana Souza"
                      autoComplete="off"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="active"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-md border border-border p-3">
                  <div className="space-y-0.5">
                    <FormLabel>Profissional ativo</FormLabel>
                    <FormDescription>
                      Profissionais inativos não aparecem para novos
                      agendamentos.
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            {/*
              Comissão (%) — só aparece para barbearia (gating de UI) e só para
              quem gerencia (admin). Não é dinheiro: não usar MoneyInput. A fonte
              de verdade do form é `commissionBps` (inteiro); o campo mostra o
              percentual pt-BR e converte na borda.
            */}
            {showCommission ? (
              <FormField
                control={form.control}
                name="commissionBps"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel htmlFor="commission-pct">Comissão (%)</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          id="commission-pct"
                          inputMode="decimal"
                          autoComplete="off"
                          placeholder="Ex.: 40"
                          className="pr-8"
                          value={commissionDraft}
                          name={field.name}
                          ref={field.ref}
                          onBlur={field.onBlur}
                          onChange={(event) => {
                            const text = event.target.value;
                            setCommissionDraft(text);
                            if (text.trim() === "") {
                              field.onChange(undefined);
                              return;
                            }
                            const bps = parsePercentToBps(text);
                            // Mantém o texto digitado; só grava bps quando válido.
                            field.onChange(bps ?? undefined);
                          }}
                        />
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
                        >
                          %
                        </span>
                      </div>
                    </FormControl>
                    <FormDescription>
                      Percentual que o barbeiro recebe por atendimento concluído.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : null}

            {/*
              Acesso (profile_id) é somente-leitura nesta fase: sem fluxo de
              convite, apenas informamos se já há login vinculado.
            */}
            {isEdit ? (
              <div className="rounded-md border border-border p-3">
                <p className="text-sm font-medium text-foreground">Acesso</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {hasLogin
                    ? "Vinculado a um login da equipe."
                    : "Sem login vinculado. O convite de acesso chega em uma fase futura."}
                </p>
              </div>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isSaving}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={isSaving}>
                {isSaving ? (
                  <>
                    <Loader2 className="animate-spin" aria-hidden="true" />
                    Salvando…
                  </>
                ) : (
                  "Salvar"
                )}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
