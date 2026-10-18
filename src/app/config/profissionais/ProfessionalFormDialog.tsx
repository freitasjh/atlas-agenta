import { useEffect } from "react";
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

  const createProfessional = useCreateProfessional();
  const updateProfessional = useUpdateProfessional();

  const form = useForm<ProfessionalInput>({
    resolver: zodResolver(professionalSchema),
    defaultValues: EMPTY_VALUES,
  });

  // Ao (re)abrir, sincroniza o form com o profissional selecionado (ou novo).
  useEffect(() => {
    if (!open) return;
    if (professional) {
      form.reset({ name: professional.name, active: professional.active });
    } else {
      form.reset(EMPTY_VALUES);
    }
  }, [open, professional, form]);

  const isSaving = createProfessional.isPending || updateProfessional.isPending;

  async function onSubmit(values: ProfessionalInput) {
    try {
      if (professional) {
        await updateProfessional.mutateAsync({ id: professional.id, ...values });
        toast.success("Profissional atualizado.");
      } else {
        await createProfessional.mutateAsync(values);
        toast.success("Profissional criado.");
      }
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
