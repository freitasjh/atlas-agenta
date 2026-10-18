import * as React from "react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { CalendarClock, Loader2, Pencil, Plus } from "lucide-react";
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

import { ProfessionalFormDialog } from "@/app/config/profissionais/ProfessionalFormDialog";
import {
  useProfessionals,
  useDeactivateProfessional,
} from "@/hooks/useProfessionals";
import { usePermissions } from "@/hooks/usePermissions";
import type { Professional } from "@/types/domain";

/** Painel de estado (vazio/erro) desta tela. */
function StatePanel({
  titulo,
  descricao,
  children,
}: {
  titulo: string;
  descricao: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-2xl rounded-lg border border-dashed border-border p-8 text-center">
      <h2 className="font-display text-lg font-semibold tracking-tight">
        {titulo}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{descricao}</p>
      {children ? (
        <div className="mt-4 flex justify-center">{children}</div>
      ) : null}
    </div>
  );
}

function ProfessionalStatusBadge({ active }: { active: boolean }) {
  return (
    <Badge variant={active ? "default" : "secondary"}>
      {active ? "Ativo" : "Inativo"}
    </Badge>
  );
}

function horariosHref(professional: Professional): string {
  return `/app/config/profissionais/${professional.id}/horarios`;
}

/**
 * Tela de Profissionais (`/app/config/profissionais`): lista a equipe, cria/edita
 * por diálogo e inativa com confirmação. No desktop é tabela; no mobile vira
 * cards. O botão "Horários" leva à grade do profissional (rota da ADR-05).
 * Botões de escrita só aparecem para quem pode gerenciar o catálogo
 * (`usePermissions().canManageCatalog`) — defesa em profundidade; a trava real é
 * o RLS. "Horários" aparece para todos os papéis (a própria grade é editável; a
 * de outros abre em leitura — tratado na tela da grade).
 */
export function ProfissionaisPage() {
  const { canManageCatalog } = usePermissions();
  const professionalsQuery = useProfessionals();
  const deactivateProfessional = useDeactivateProfessional();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Professional | null>(null);
  const [toToggle, setToToggle] = useState<Professional | null>(null);

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(professional: Professional) {
    setEditing(professional);
    setFormOpen(true);
  }

  async function confirmToggle() {
    if (!toToggle) return;
    const next = !toToggle.active;
    try {
      await deactivateProfessional.mutateAsync({ id: toToggle.id, active: next });
      toast.success(next ? "Profissional reativado." : "Profissional inativado.");
      setToToggle(null);
    } catch {
      toast.error("Não foi possível alterar o profissional. Tente novamente.");
    }
  }

  const professionals = professionalsQuery.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Profissionais"
        descricao="Quem atende na sua empresa. Cada profissional tem a própria grade de horários."
        acoes={
          canManageCatalog ? (
            <Button onClick={openCreate}>
              <Plus aria-hidden="true" />
              Novo profissional
            </Button>
          ) : undefined
        }
      />

      {professionalsQuery.isLoading ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : professionalsQuery.isError ? (
        <StatePanel
          titulo="Não foi possível carregar os profissionais"
          descricao="Verifique sua conexão e tente novamente."
        >
          <Button
            variant="outline"
            onClick={() => void professionalsQuery.refetch()}
          >
            Tentar novamente
          </Button>
        </StatePanel>
      ) : professionals.length === 0 ? (
        <StatePanel
          titulo="Nenhum profissional cadastrado"
          descricao={
            canManageCatalog
              ? "Cadastre o primeiro profissional para montar a sua equipe."
              : "Ainda não há profissionais cadastrados."
          }
        >
          {canManageCatalog ? (
            <Button onClick={openCreate}>
              <Plus aria-hidden="true" />
              Novo profissional
            </Button>
          ) : null}
        </StatePanel>
      ) : (
        <>
          {/* Desktop: tabela */}
          <div className="hidden rounded-lg border border-border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>Acesso</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {professionals.map((professional) => (
                  <TableRow key={professional.id}>
                    <TableCell className="font-medium text-foreground">
                      {professional.name}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {professional.profile_id ? "Vinculado" : "—"}
                    </TableCell>
                    <TableCell>
                      <ProfessionalStatusBadge active={professional.active} />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" asChild>
                          <Link to={horariosHref(professional)}>
                            <CalendarClock aria-hidden="true" />
                            Horários
                          </Link>
                        </Button>
                        {canManageCatalog ? (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openEdit(professional)}
                            >
                              <Pencil aria-hidden="true" />
                              Editar
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setToToggle(professional)}
                            >
                              {professional.active ? "Inativar" : "Reativar"}
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile: cards */}
          <ul className="space-y-3 md:hidden">
            {professionals.map((professional) => (
              <li
                key={professional.id}
                className="rounded-lg border border-border p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="font-medium text-foreground">
                      {professional.name}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {professional.profile_id
                        ? "Acesso vinculado"
                        : "Sem login vinculado"}
                    </p>
                  </div>
                  <ProfessionalStatusBadge active={professional.active} />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="ghost" size="sm" asChild>
                    <Link to={horariosHref(professional)}>
                      <CalendarClock aria-hidden="true" />
                      Horários
                    </Link>
                  </Button>
                  {canManageCatalog ? (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openEdit(professional)}
                      >
                        <Pencil aria-hidden="true" />
                        Editar
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setToToggle(professional)}
                      >
                        {professional.active ? "Inativar" : "Reativar"}
                      </Button>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {canManageCatalog ? (
        <ProfessionalFormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          professional={editing}
        />
      ) : null}

      {/* Confirmação de inativar/reativar */}
      <Dialog
        open={!!toToggle}
        onOpenChange={(open) => {
          if (!open) setToToggle(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {toToggle?.active ? "Inativar profissional" : "Reativar profissional"}
            </DialogTitle>
            <DialogDescription>
              {toToggle?.active
                ? `"${toToggle?.name}" deixa de aparecer para novos agendamentos. Você pode reativá-lo depois.`
                : `"${toToggle?.name}" volta a ficar disponível para novos agendamentos.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setToToggle(null)}
              disabled={deactivateProfessional.isPending}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant={toToggle?.active ? "destructive" : "default"}
              onClick={confirmToggle}
              disabled={deactivateProfessional.isPending}
            >
              {deactivateProfessional.isPending ? (
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
