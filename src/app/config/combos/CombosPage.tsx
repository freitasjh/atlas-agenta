import { useMemo, useState } from "react";
import { Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/PageHeader";
import { StatePanel } from "@/components/StatePanel";
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

import { ComboFormDialog } from "@/app/config/combos/ComboFormDialog";
import { useCombos, useDeactivateCombo } from "@/hooks/useCombos";
import { useComboServices } from "@/hooks/useComboServices";
import { useServices } from "@/hooks/useServices";
import { usePermissions } from "@/hooks/usePermissions";
import { useSegmentFeatures } from "@/hooks/useSegmentFeatures";
import { formatCentsToBRL } from "@/lib/money";
import type { Combo } from "@/types/domain";

function ComboStatusBadge({ active }: { active: boolean }) {
  return (
    <Badge variant={active ? "default" : "secondary"}>
      {active ? "Ativo" : "Inativo"}
    </Badge>
  );
}

/**
 * Resumo dos serviços de um pacote: contagem + lista truncada com o nome
 * completo no `title`. Lê os vínculos do pacote (`useComboServices`) e resolve
 * os nomes contra a lista de serviços do tenant (`useServices`, todos — para
 * nomear também serviços que tenham sido inativados depois de entrar no pacote).
 */
function ComboServicesSummary({ comboId }: { comboId: string }) {
  const linksQuery = useComboServices(comboId);
  const servicesQuery = useServices();

  const names = useMemo(() => {
    const byId = new Map(
      (servicesQuery.data ?? []).map((service) => [service.id, service.name]),
    );
    return (linksQuery.data ?? []).map((id) => byId.get(id) ?? "serviço");
  }, [linksQuery.data, servicesQuery.data]);

  if (linksQuery.isLoading || servicesQuery.isLoading) {
    return <Skeleton className="h-4 w-32" />;
  }
  if (names.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }

  const full = names.join(", ");
  return (
    <span title={full} className="line-clamp-1">
      {names.length} {names.length === 1 ? "serviço" : "serviços"}: {full}
    </span>
  );
}

/**
 * Tela de Pacotes (`/app/config/combos`): lista os pacotes do salão, cria/edita
 * por diálogo e inativa com confirmação (soft-delete). No desktop é tabela; no
 * mobile vira cards (sem overflow horizontal). Botões de escrita só aparecem
 * para quem pode gerenciar o catálogo (`usePermissions().canManageCatalog`) —
 * defesa em profundidade; a trava real é o RLS.
 *
 * Gating por ramo (salão), espelhando a `ComissoesPage`: fora de salão
 * (`!combos`) a tela mostra um `StatePanel` de indisponibilidade no lugar do
 * CRUD. É só de UI — `segment` nunca é fronteira de RLS; o isolamento real é o
 * RLS por `tenant_id`. `useSegmentFeatures()` devolve `combos: false` durante o
 * load (nunca `undefined`), então não há flash.
 */
export function CombosPage() {
  const { combos: combosFeature } = useSegmentFeatures();
  const { canManageCatalog } = usePermissions();
  const combosQuery = useCombos();
  const deactivateCombo = useDeactivateCombo();

  const [formOpen, setFormOpen] = useState(false);
  const [editingCombo, setEditingCombo] = useState<Combo | null>(null);
  const [comboToToggle, setComboToToggle] = useState<Combo | null>(null);

  // Guard de ramo depois de todos os hooks (Regras de Hooks). Em tenant
  // não-salão, `useCombos()` acima ainda dispara: é uma leitura benigna que a
  // RLS resolve e que nunca é renderizada — análogo à nota de gating da
  // `ComissoesPage`.
  if (!combosFeature) {
    return (
      <div className="space-y-6">
        <PageHeader
          titulo="Pacotes"
          descricao="Combine procedimentos num preço fechado para seus clientes."
        />
        <StatePanel
          titulo="Pacotes"
          descricao="Os pacotes estão disponíveis apenas para salões de beleza."
        />
      </div>
    );
  }

  function openCreate() {
    setEditingCombo(null);
    setFormOpen(true);
  }

  function openEdit(combo: Combo) {
    setEditingCombo(combo);
    setFormOpen(true);
  }

  async function confirmToggle() {
    if (!comboToToggle) return;
    const next = !comboToToggle.active;
    try {
      await deactivateCombo.mutateAsync({ id: comboToToggle.id, active: next });
      toast.success(next ? "Pacote reativado." : "Pacote inativado.");
      setComboToToggle(null);
    } catch {
      toast.error("Não foi possível alterar o pacote. Tente novamente.");
    }
  }

  const combos = combosQuery.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Pacotes"
        descricao="Combine procedimentos num preço fechado para seus clientes."
        acoes={
          canManageCatalog ? (
            <Button onClick={openCreate}>
              <Plus aria-hidden="true" />
              Novo pacote
            </Button>
          ) : undefined
        }
      />

      {combosQuery.isLoading ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : combosQuery.isError ? (
        <StatePanel
          titulo="Não foi possível carregar os pacotes"
          descricao="Verifique sua conexão e tente novamente."
        >
          <Button variant="outline" onClick={() => void combosQuery.refetch()}>
            Tentar novamente
          </Button>
        </StatePanel>
      ) : combos.length === 0 ? (
        <StatePanel
          titulo="Nenhum pacote cadastrado"
          descricao={
            canManageCatalog
              ? "Monte o primeiro pacote agrupando serviços num preço fechado."
              : "Ainda não há pacotes cadastrados."
          }
        >
          {canManageCatalog ? (
            <Button onClick={openCreate}>
              <Plus aria-hidden="true" />
              Novo pacote
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
                  <TableHead>Serviços</TableHead>
                  <TableHead>Preço</TableHead>
                  <TableHead>Status</TableHead>
                  {canManageCatalog ? (
                    <TableHead className="text-right">Ações</TableHead>
                  ) : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {combos.map((combo) => (
                  <TableRow key={combo.id}>
                    <TableCell className="font-medium text-foreground">
                      {combo.name}
                    </TableCell>
                    <TableCell className="max-w-xs">
                      <ComboServicesSummary comboId={combo.id} />
                    </TableCell>
                    <TableCell>{formatCentsToBRL(combo.price_cents)}</TableCell>
                    <TableCell>
                      <ComboStatusBadge active={combo.active} />
                    </TableCell>
                    {canManageCatalog ? (
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEdit(combo)}
                          >
                            <Pencil aria-hidden="true" />
                            Editar
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setComboToToggle(combo)}
                          >
                            {combo.active ? "Inativar" : "Reativar"}
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
            {combos.map((combo) => (
              <li
                key={combo.id}
                className="rounded-lg border border-border p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium text-foreground">{combo.name}</p>
                    <p className="text-sm text-muted-foreground">
                      <ComboServicesSummary comboId={combo.id} />
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {formatCentsToBRL(combo.price_cents)}
                    </p>
                  </div>
                  <ComboStatusBadge active={combo.active} />
                </div>
                {canManageCatalog ? (
                  <div className="mt-3 flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEdit(combo)}
                    >
                      <Pencil aria-hidden="true" />
                      Editar
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setComboToToggle(combo)}
                    >
                      {combo.active ? "Inativar" : "Reativar"}
                    </Button>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}

      {canManageCatalog ? (
        <ComboFormDialog
          open={formOpen}
          onOpenChange={setFormOpen}
          combo={editingCombo}
        />
      ) : null}

      {/* Confirmação de inativar/reativar */}
      <Dialog
        open={!!comboToToggle}
        onOpenChange={(open) => {
          if (!open) setComboToToggle(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {comboToToggle?.active ? "Inativar pacote" : "Reativar pacote"}
            </DialogTitle>
            <DialogDescription>
              {comboToToggle?.active
                ? `"${comboToToggle?.name}" deixa de aparecer para novos agendamentos. Você pode reativá-lo depois.`
                : `"${comboToToggle?.name}" volta a ficar disponível para novos agendamentos.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setComboToToggle(null)}
              disabled={deactivateCombo.isPending}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              variant={comboToToggle?.active ? "destructive" : "default"}
              onClick={confirmToggle}
              disabled={deactivateCombo.isPending}
            >
              {deactivateCombo.isPending ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden="true" />
                  Salvando…
                </>
              ) : comboToToggle?.active ? (
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
