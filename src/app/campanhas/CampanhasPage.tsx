import { useMemo, useState } from "react";
import { Megaphone, Plus, Send } from "lucide-react";
import { toast } from "sonner";

import { AccessDenied } from "@/components/AccessDenied";
import { PageHeader } from "@/components/PageHeader";
import { EntitlementGate } from "@/components/EntitlementGate";
import { StatePanel } from "@/components/StatePanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePlanEntitlements } from "@/hooks/usePlanEntitlements";
import { usePermissions } from "@/hooks/usePermissions";
import {
  useCampaigns,
  useEnqueueCampaign,
  useSaveCampaign,
  type SaveCampaignInput,
} from "@/hooks/useCampaigns";
import {
  CAMPAIGN_PRESETS,
  CAMPAIGN_STATUSES,
  presetLabel,
  statusLabel,
  type Campaign,
  type CampaignPreset,
  type CampaignStatus,
} from "@/app/campanhas/model";
import {
  campanhasMessages,
  formatCampanhasMessage,
} from "@/app/campanhas/campanhas-messages";
import { CampaignFormDialog } from "@/app/campanhas/CampaignFormDialog";
import { CampaignPreviewPanel } from "@/app/campanhas/CampaignPreviewPanel";
import { CampaignMetricsPanel } from "@/app/campanhas/CampaignMetricsPanel";

const t = campanhasMessages.page;

function statusVariant(status: CampaignStatus): "default" | "secondary" | "destructive" | "outline" {
  if (status === "rascunho") return "outline";
  if (status === "agendada") return "secondary";
  if (status === "enviando") return "default";
  if (status === "concluída") return "outline";
  return "destructive";
}

/**
 * Tela de campanhas (`/app/campanhas`, admin, RF-12..RF-16, UX-SPEC C).
 *
 * Admin cria campanhas com preset (win-back, aniversário, rebooking,
 * personalizada), segmentação, modelo da biblioteca e agendamento;
 * prévia mostra elegíveis + excluídos por opt-in; métricas agregam
 * envio/entrega/leitura/resposta/conversão. Gating `campanhas`: sem
 * entitlement, upsell e zero request sensível (queries com `enabled`).
 * Leitura de recepção segue o RLS (select staff); escrita é só admin
 * (trava real no RLS, defesa em profundidade no RBAC).
 */
export function CampanhasPage() {
  const { isAdmin } = usePermissions();
  const entitlements = usePlanEntitlements();
  const entitled = entitlements?.campanhas === true;

  const campaignsQuery = useCampaigns({ enabled: entitled });
  const save = useSaveCampaign();
  const enqueue = useEnqueueCampaign();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<CampaignStatus | "todas">("todas");
  const [presetFilter, setPresetFilter] = useState<CampaignPreset | "todos">("todos");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const campaigns = useMemo(() => campaignsQuery.data ?? [], [campaignsQuery.data]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return campaigns.filter((c) => {
      if (statusFilter !== "todas" && c.status !== statusFilter) return false;
      if (presetFilter !== "todos" && c.preset !== presetFilter) return false;
      if (needle && !c.name.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [campaigns, search, statusFilter, presetFilter]);

  const selected = selectedId ? (campaigns.find((c) => c.id === selectedId) ?? null) : null;

  if (!isAdmin) {
    return <AccessDenied backTo="/app" backLabel="Voltar ao painel" />;
  }

  async function handleSave(input: SaveCampaignInput) {
    try {
      await save.mutateAsync(editing ? { ...input, id: editing.id } : input);
      toast.success(campanhasMessages.form.saveSuccess);
      setDialogOpen(false);
      setEditing(null);
    } catch {
      toast.error(campanhasMessages.form.saveError);
    }
  }

  async function handleEnqueue(campaign: Campaign) {
    try {
      await enqueue.mutateAsync(campaign.id);
      toast.success(t.enqueuedSuccess);
    } catch {
      toast.error(t.enqueuedError);
    }
  }

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openDetails(campaign: Campaign) {
    setSelectedId((current) => (current === campaign.id ? null : campaign.id));
  }

  const isLoading = campaignsQuery.isLoading;
  const isError = campaignsQuery.isError;

  return (
    <div className="space-y-6">
      <PageHeader
        titulo={t.title}
        descricao={t.description}
        acoes={
          <Button onClick={openCreate} disabled={!entitled || save.isPending}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t.newCampaign}
          </Button>
        }
      />

      <EntitlementGate
        entitled={entitled}
        recurso={campanhasMessages.gating.resource}
        acaoLabel={campanhasMessages.gating.action}
      >
        <div
          className="grid grid-cols-1 gap-3 sm:grid-cols-3"
          role="search"
          aria-label={t.filtersTitle}
        >
          <div className="space-y-1">
            <Label htmlFor="campanhas-search">{t.searchLabel}</Label>
            <Input
              id="campanhas-search"
              placeholder={t.searchPlaceholder}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="campanhas-status">{t.statusLabel}</Label>
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as CampaignStatus | "todas")}
            >
              <SelectTrigger id="campanhas-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">{t.allStatuses}</SelectItem>
                {CAMPAIGN_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {statusLabel(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="campanhas-preset">{t.presetLabel}</Label>
            <Select
              value={presetFilter}
              onValueChange={(v) => setPresetFilter(v as CampaignPreset | "todos")}
            >
              <SelectTrigger id="campanhas-preset">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">{t.allPresets}</SelectItem>
                {CAMPAIGN_PRESETS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {presetLabel(p)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2" aria-busy="true" aria-label={t.loading}>
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : isError ? (
          <StatePanel titulo={t.errorTitle} descricao={t.errorDescription}>
            <Button variant="outline" onClick={() => void campaignsQuery.refetch()}>
              {t.retry}
            </Button>
          </StatePanel>
        ) : visible.length === 0 ? (
          <StatePanel titulo={t.emptyTitle} descricao={t.emptyDescription} />
        ) : (
          <>
            <div className="hidden rounded-lg border border-border md:block">
              <Table>
                <caption className="px-4 py-2 text-left text-sm text-muted-foreground">
                  {t.tableCaption}
                </caption>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">{t.colName}</TableHead>
                    <TableHead scope="col">{t.colPreset}</TableHead>
                    <TableHead scope="col">{t.colScheduled}</TableHead>
                    <TableHead scope="col">{t.colStatus}</TableHead>
                    <TableHead scope="col" className="text-right">{t.colActions}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((campaign) => (
                    <TableRow key={campaign.id}>
                      <TableCell className="font-medium text-foreground">
                        <button
                          type="button"
                          className="underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label={formatCampanhasMessage(t.detailsAria, { nome: campaign.name })}
                          onClick={() => openDetails(campaign)}
                        >
                          {campaign.name}
                        </button>
                      </TableCell>
                      <TableCell>{presetLabel(campaign.preset)}</TableCell>
                      <TableCell className="tabular-nums">
                        {campaign.scheduled_at ?? t.notScheduled}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(campaign.status)}>
                          {statusLabel(campaign.status)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={formatCampanhasMessage(t.enqueueAria, { nome: campaign.name })}
                            disabled={enqueue.isPending}
                            onClick={() => void handleEnqueue(campaign)}
                          >
                            <Send className="h-4 w-4" aria-hidden="true" />
                            Enfileirar
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <ul className="space-y-3 md:hidden">
              {visible.map((campaign) => (
                <li
                  key={campaign.id}
                  className="rounded-lg border border-border p-4"
                  aria-label={`${campaign.name} · ${statusLabel(campaign.status)}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-1">
                      <button
                        type="button"
                        className="text-left font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={formatCampanhasMessage(t.detailsAria, { nome: campaign.name })}
                        onClick={() => openDetails(campaign)}
                      >
                        {campaign.name}
                      </button>
                      <p className="text-sm text-muted-foreground">
                        {presetLabel(campaign.preset)} · {campaign.scheduled_at ?? t.notScheduled}
                      </p>
                    </div>
                    <Badge variant={statusVariant(campaign.status)}>
                      {statusLabel(campaign.status)}
                    </Badge>
                  </div>
                  <div className="mt-3">
                    <Button
                      variant="outline"
                      size="sm"
                      className="min-h-[44px]"
                      aria-label={formatCampanhasMessage(t.enqueueAria, { nome: campaign.name })}
                      disabled={enqueue.isPending}
                      onClick={() => void handleEnqueue(campaign)}
                    >
                      <Send className="h-4 w-4" aria-hidden="true" />
                      Enfileirar
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}

        {selected ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <CampaignPreviewPanel campaign={selected} entitled={entitled} />
            <CampaignMetricsPanel campaign={selected} entitled={entitled} />
          </div>
        ) : null}
      </EntitlementGate>

      <CampaignFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        campaign={editing}
        submitting={save.isPending}
        onSubmit={(values) => void handleSave(values)}
      />

      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Megaphone className="h-4 w-4" aria-hidden="true" />
        Disparos fora da janela de 24h usam apenas modelos aprovados.
      </p>
    </div>
  );
}
