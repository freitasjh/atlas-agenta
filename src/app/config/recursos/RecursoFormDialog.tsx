import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
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
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Resource, ResourceType } from "@/types/domain";
import {
  useCreateResource,
  useUpdateResource,
  type ResourceInput,
} from "@/hooks/useResources";

const recursoSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome do recurso.").max(120),
  type: z.enum(["sala", "equipamento", "cadeira"]),
  capacity: z
    .number({ invalid_type_error: "Informe a capacidade." })
    .int("A capacidade deve ser um número inteiro.")
    .min(1, "A capacidade deve ser maior que zero."),
  color: z.string().optional().nullable(),
  active: z.boolean(),
});

type RecursoInput = z.infer<typeof recursoSchema>;

interface RecursoFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  resource?: Resource | null;
}

const EMPTY: RecursoInput = {
  name: "",
  type: "sala",
  capacity: 1,
  color: null,
  active: true,
};

export function RecursoFormDialog({
  open,
  onOpenChange,
  resource,
}: RecursoFormDialogProps) {
  const isEdit = !!resource;
  const create = useCreateResource();
  const update = useUpdateResource();

  const form = useForm<RecursoInput>({
    resolver: zodResolver(recursoSchema),
    defaultValues: EMPTY,
  });

  useEffect(() => {
    if (!open) return;
    if (resource) {
      form.reset({
        name: resource.name,
        type: resource.type,
        capacity: resource.capacity,
        color: resource.color,
        active: resource.active,
      });
    } else {
      form.reset(EMPTY);
    }
  }, [open, resource, form]);

  const isSaving = create.isPending || update.isPending;

  async function onSubmit(values: RecursoInput) {
    try {
      const input: ResourceInput = {
        name: values.name,
        type: values.type as ResourceType,
        capacity: values.capacity,
        color: values.color ?? null,
        active: values.active,
      };
      if (resource) {
        await update.mutateAsync({ id: resource.id, ...input });
        toast.success("Recurso atualizado.");
      } else {
        await create.mutateAsync(input);
        toast.success("Recurso criado.");
      }
      onOpenChange(false);
    } catch {
      toast.error("Não foi possível salvar o recurso. Tente novamente.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar recurso" : "Novo recurso"}</DialogTitle>
          <DialogDescription>
            Cadastre salas, equipamentos ou cadeiras agendáveis.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" noValidate>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome</FormLabel>
                  <FormControl>
                    <Input autoComplete="off" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid gap-5 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="sala">Sala</SelectItem>
                        <SelectItem value="equipamento">Equipamento</SelectItem>
                        <SelectItem value="cadeira">Cadeira</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="capacity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Capacidade</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        step={1}
                        value={Number.isFinite(field.value) ? field.value : ""}
                        onChange={(event) => field.onChange(event.target.valueAsNumber)}
                        onBlur={field.onBlur}
                        name={field.name}
                        ref={field.ref}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="color"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Cor (opcional)</FormLabel>
                  <FormControl>
                    <Input
                      type="text"
                      placeholder="#22c55e"
                      value={field.value ?? ""}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      name={field.name}
                      ref={field.ref}
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
                    <FormLabel>Recurso ativo</FormLabel>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
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