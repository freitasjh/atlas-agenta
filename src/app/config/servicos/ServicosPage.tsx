import * as React from "react";
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

import { ServiceFormDialog } from "@/app/config/servicos/ServiceFormDialog";
import { useServices, useDeactivateService } from "@/hooks/useServices";
import { usePermissions } from "@/hooks/usePermissions";
import { useSegmentTerms } from "@/hooks/useSegmentTerms";
import { formatCentsToBRL } from "@/lib/money";
import type { Service } from "@/types/domain";

function formatDuration(minutes: number): string {
  return `${minutes} min`;
}

/** Painel de estado (vazio/erro) desta tela, sem o selo "em construção". */
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

function ServiceStatusBadge({ active }: { active: boolean }) {
  return (
    <Badge variant={active ? "default" : "secondary"}>
      {active ? "Ativo" : "Inativo"}
    </Badge>
  );
}

/**
 * Tela de Serviços (`/app/config/servicos`): lista o catálogo, cria/edita por
 * diálogo e inativa com confirmação. No desktop é tabela; no mobile vira cards
 * (sem overflow horizontal). Botões de escrita só aparecem para quem pode
 * gerenciar o catálogo (`usePermissions().canManageCatalog`) — defesa em
 * profundidade; a trava real é o RLS.
 */
export function ServicosPage() {
  const { canManageCatalog } = usePermissions();
  const { servicosLabel, servicoLabelSingular } = useSegmentTerms();
  const servicosLower = servicosLabel.toLowerCase();
  const servicoLower = servicoLabelSingular.toLowerCase();
  const servicesQuery = useServices();
  const deactivateService = useDeactivateService();

  const [formOpen, setFormOpen] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [serviceToToggle, setServiceToToggle] = useState<Service | null>(null);

  function openCreate() {
    setEditingService(null);
    setFormOpen(true);
  }

  function openEdit(service: Service) {
    setEditingService(service);
    setFormOpen(true);
  }

  async function confirmToggle() {
    if (!serviceToToggle) return;
    const next = !serviceToToggle.active;
    try {
      await deactivateService.mutateAsync({
        id: serviceToToggle.id,
        active: next,
      });
      toast.success(
        next
          ? `${servicoLabelSingular} reativado.`
          : `${servicoLabelSingular} inativado.`,
      );
      setServiceToToggle(null);
    } catch {
      toast.error(
        `Não foi possível alterar o ${servicoLower}. Tente novamente.`,
      );
    }
  }

  const services = servicesQuery.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        titulo={servicosLabel}
        descricao="O que a sua empresa oferece: nome, duração, preço e quem executa."
        acoes={
          canManageCatalog ? (
            <Button onClick={openCreate}>
              <Plus aria-hidden="true" />
              Novo {servicoLower}
            </Button>
          ) : undefined
        }
      />

      {servicesQuery.isLoading ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : servicesQuery.isError ? (
        <StatePanel
          titulo={`Não foi possível carregar os ${servicosLower}`}
          descricao="Verifique sua conexão e tente novamente."
        >
          <Button
            variant="outline"
            onClick={() => void servicesQuery.refetch()}
          >
            Tentar novamente
          </Button>
        </StatePanel>
      ) : services.length === 0 ? (
        <StatePanel
          titulo={`Nenhum ${servicoLower} cadastrado`}
          descricao={
            canManageCatalog
              ? `Cadastre o primeiro ${servicoLower} para começar a montar o catálogo.`
              : `Ainda não há ${servicosLower} cadastrados.`
          }
        >
          {canManageCatalog ? (
            <Button onClick={openCreate}>
              <Plus aria-hidden="true" />
              Novo {servicoLower}
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
                  <TableHead>Duração</TableHead>
                  <TableHead>Preço</TableHead>
                  <TableHead>Status</TableHead>
                  {canManageCatalog ? (
                    <TableHead className="text-right">Ações</TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {services.map((service) => (
                  <TableRow key={service.id}>
                    <TableCell className="font-medium text-foreground">
                      {service.name}
                    </TableCell>
                    <TableCell>{formatDuration(service.duration_minutes)}</TableCell>
                    <TableCell>{formatCentsToBRL(service.price_cents)}</TableCell>
                    <TableCell>
                      <ServiceStatusBadge active={service.active} />
                    </TableCell>
                    {canManageCatalog ? (
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEdit(service)}
                          >
                            <Pencil aria-hidden="true" />
                            Editar
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setServiceToToggle(service)}
                          >
                            {service.active ? "Inativar" : "Reativar"}
                          </Button>
                        </div>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile: cards */}
          <ul className="space-y-3 md:hidden">
            {services.map((service) => (
              <li
                key={service.id}
                className="rounded-lg border border-border p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="font-medium text-foreground">
                      {service.name}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {formatDuration(service.duration_minutes)} ·{" "}
                      {formatCentsToBRL(service.price_cents)}
                    </p>
                  </div>
                  <ServiceStatusBadge active={service.active} />
                </div>
                {canManageCatalog ? (
                  <div className="mt-3 flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEdit(service)}
                    >
                      <Pencil aria-hidden="true" />
                      Editar
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setServiceToToggle(service)}
                    >
                      {service.active ? "Inativar" : "Reativar"}
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}

      {canManageCatalog ? (
        <ServiceFormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          service={editingService}
        />
      ) : null}

      {/* Confirmação de inativar/reativar */}
      <Dialog
        open={!!serviceToToggle}
        onOpenChange={(open) => {
          if (!open) setServiceToToggle(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {serviceToToggle?.active
                ? `Inativar ${servicoLower}`
                : `Reativar ${servicoLower}`}
            </DialogTitle>
            <DialogDescription>
              {serviceToToggle?.active
                ? `"${serviceToToggle?.name}" deixa de aparecer para novos agendamentos. Você pode reativá-lo depois.`
                : `"${serviceToToggle?.name}" volta a ficar disponível para novos agendamentos.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setServiceToToggle(null)}
              disabled={deactivateService.isPending}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant={serviceToToggle?.active ? "destructive" : "default"}
              onClick={confirmToggle}
              disabled={deactivateService.isPending}
            >
              {deactivateService.isPending ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden="true" />
                  Salvando…
                </>
              ) : serviceToToggle?.active ? (
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
