import { useState } from "react";
import { Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

import { RecursoFormDialog } from "@/app/config/recursos/RecursoFormDialog";
import { useResources, useDeactivateResource } from "@/hooks/useResources";
import { usePermissions } from "@/hooks/usePermissions";
import type { Resource } from "@/types/domain";

export function RecursosPage() {
  const { canManageCatalog } = usePermissions();
  const resourcesQuery = useResources();
  const deactivate = useDeactivateResource();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Resource | null>(null);
  const [toToggle, setToToggle] = useState<Resource | null>(null);

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }
  function openEdit(r: Resource) {
    setEditing(r);
    setFormOpen(true);
  }

  async function confirmToggle() {
    if (!toToggle) return;
    const next = !toToggle.active;
    try {
      await deactivate.mutateAsync({ id: toToggle.id, active: next });
      toast.success(next ? "Recurso reativado." : "Recurso inativado.");
      setToToggle(null);
    } catch {
      toast.error("Não foi possível alterar o recurso. Tente novamente.");
    }
  }

  const resources = resourcesQuery.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Recursos"
        descricao="Salas, equipamentos e cadeiras agendáveis."
        acoes={
          canManageCatalog ? (
            <Button onClick={openCreate}>
              <Plus aria-hidden="true" />
              Novo recurso
            </Button>
          ) : undefined
        }
      />
      {resourcesQuery.isLoading ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : resourcesQuery.isError ? (
        <div className="text-sm text-muted-foreground">
          Não foi possível carregar os recursos.
        </div>
      ) : resources.length === 0 ? (
        <div className="text-sm text-muted-foreground">
          Nenhum recurso cadastrado.
        </div>
      ) : (
        <>
          <div className="hidden rounded-lg border border-border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Capacidade</TableHead>
                  <TableHead>Status</TableHead>
                  {canManageCatalog ? <TableHead className="text-right">Ações</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {resources.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell>{r.type}</TableCell>
                    <TableCell>{r.capacity}</TableCell>
                    <TableCell>
                      <Badge variant={r.active ? "default" : "secondary"}>
                        {r.active ? "Ativo" : "Inativo"}
                      </Badge>
                    </TableCell>
                    {canManageCatalog ? (
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>
                            <Pencil aria-hidden="true" />
                            Editar
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => setToToggle(r)}>
                            {r.active ? "Inativar" : "Reativar"}
                          </Button>
                        </div>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ul className="space-y-3 md:hidden">
            {resources.map((r) => (
              <li key={r.id} className="rounded-lg border border-border p-4">
                <p className="font-medium">{r.name}</p>
                <p className="text-sm text-muted-foreground">
                  {r.type} · capacidade {r.capacity}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
      {canManageCatalog ? (
        <RecursoFormDialog open={formOpen} onOpenChange={setFormOpen} resource={editing} />
      ) : null}
      <Dialog open={!!toToggle} onOpenChange={(o) => { if (!o) setToToggle(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{toToggle?.active ? "Inativar recurso" : "Reativar recurso"}</DialogTitle>
            <DialogDescription>
              {toToggle?.active
                ? `"${toToggle?.name}" deixa de ficar disponível.`
                : `"${toToggle?.name}" volta a ficar disponível.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setToToggle(null)} disabled={deactivate.isPending}>
              Cancelar
            </Button>
            <Button
              variant={toToggle?.active ? "destructive" : "default"}
              onClick={confirmToggle}
              disabled={deactivate.isPending}
            >
              {deactivate.isPending ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden="true" />
                  Salvando…
                </>
              ) : toToggle?.active ? (
                "Inativar"
              ) : (
                "Reativar"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}