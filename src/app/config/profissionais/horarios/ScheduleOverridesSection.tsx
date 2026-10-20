import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import {
  useScheduleOverrides,
  useDeleteScheduleOverride,
} from "@/hooks/useScheduleOverrides";
import type { ScheduleOverride } from "@/types/domain";

import { OverrideFormDialog } from "@/app/config/profissionais/horarios/OverrideFormDialog";
import { OverrideItem } from "@/app/config/profissionais/horarios/OverrideItem";

interface ScheduleOverridesSectionProps {
  professionalId: string;
  /**
   * Leitura espelhando a grade (grade de outro profissional / recepção): sem
   * botões de adicionar/editar/remover. A trava real de escrita é o RLS.
   */
  readOnly: boolean;
}

/**
 * Lista as exceções por data do profissional e, quando editável, permite
 * criar/editar/remover folga ou horário atípico. Dados via TanStack Query
 * (`useScheduleOverrides`, ADR-04); a remoção pede confirmação num diálogo
 * (padrão já usado em `ProfissionaisPage`). Mensagens pt-BR.
 */
export function ScheduleOverridesSection({
  professionalId,
  readOnly,
}: ScheduleOverridesSectionProps) {
  const overridesQuery = useScheduleOverrides(professionalId);
  const deleteOverride = useDeleteScheduleOverride(professionalId);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ScheduleOverride | null>(null);
  const [toDelete, setToDelete] = useState<ScheduleOverride | null>(null);

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(override: ScheduleOverride) {
    setEditing(override);
    setFormOpen(true);
  }

  async function confirmDelete() {
    if (!toDelete) return;
    try {
      await deleteOverride.mutateAsync(toDelete.id);
      toast.success("Exceção removida.");
      setToDelete(null);
    } catch {
      toast.error("Não foi possível remover a exceção. Tente novamente.");
    }
  }

  const overrides = overridesQuery.data ?? [];

  return (
    <div className="space-y-4">
      {!readOnly ? (
        <div className="flex justify-end">
          <Button type="button" variant="outline" size="sm" onClick={openCreate}>
            <Plus aria-hidden="true" />
            Adicionar exceção
          </Button>
        </div>
      ) : null}

      {overridesQuery.isLoading ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : overridesQuery.isError ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Não foi possível carregar as exceções.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => void overridesQuery.refetch()}
          >
            Tentar novamente
          </Button>
        </div>
      ) : overrides.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhuma exceção cadastrada. Folgas e horários atípicos aparecem aqui.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {overrides.map((override) => (
            <OverrideItem
              key={override.id}
              override={override}
              readOnly={readOnly}
              onEdit={openEdit}
              onDelete={setToDelete}
            />
          ))}
        </div>
      )}

      {!readOnly ? (
        <OverrideFormDialog
          professionalId={professionalId}
          open={formOpen}
          onOpenChange={setFormOpen}
          override={editing}
        />
      ) : null}

      {/* Confirmação de remoção */}
      <Dialog
        open={!!toDelete}
        onOpenChange={(open) => {
          if (!open) setToDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remover exceção</DialogTitle>
            <DialogDescription>
              A grade semanal volta a valer nesse dia. Esta ação não pode ser
              desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setToDelete(null)}
              disabled={deleteOverride.isPending}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void confirmDelete()}
              disabled={deleteOverride.isPending}
            >
              {deleteOverride.isPending ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden="true" />
                  Removendo…
                </>
              ) : (
                "Remover"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
