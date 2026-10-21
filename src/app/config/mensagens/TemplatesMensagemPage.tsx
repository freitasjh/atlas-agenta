import * as React from "react";
import { useMemo, useState } from "react";
import { Pencil } from "lucide-react";

import { PageHeader } from "@/components/PageHeader";
import { AccessDenied } from "@/components/AccessDenied";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

import { TemplateEditorDialog } from "@/app/config/mensagens/TemplateEditorDialog";
import { useMessageTemplates } from "@/hooks/useMessageTemplates";
import { usePermissions } from "@/hooks/usePermissions";
import { getMessageTemplateLabel } from "@/lib/whatsapp";
import { MESSAGE_TEMPLATES } from "@/types/domain";
import type { MessageTemplate, MessageTemplateRow } from "@/types/domain";

/** Card derivado: ou uma linha real do banco, ou um default "a configurar". */
interface TemplateCard {
  templateKey: MessageTemplate;
  body: string;
  active: boolean;
  /** `true` quando não há linha no banco (lacuna de seed em tenant legado). */
  unconfigured: boolean;
}

/** Painel de estado (erro) desta tela, sem o selo "em construção". */
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

/**
 * Merge do fetch com a lista fechada `MESSAGE_TEMPLATES`: garante sempre os 4
 * cards. Linha ausente (tenant legado sem seed) vira um card "a configurar" com
 * corpo vazio — a UI nunca inventa a redação padrão (dona é a migration/ADR-02),
 * só sinaliza a lacuna de forma honesta.
 */
function toCards(rows: MessageTemplateRow[]): TemplateCard[] {
  const byKey = new Map(rows.map((row) => [row.template_key, row]));
  return MESSAGE_TEMPLATES.map((templateKey) => {
    const row = byKey.get(templateKey);
    if (row) {
      return {
        templateKey,
        body: row.body,
        active: row.active,
        unconfigured: false,
      };
    }
    return { templateKey, body: "", active: true, unconfigured: true };
  });
}

function TemplateStatusBadge({
  active,
  unconfigured,
}: {
  active: boolean;
  unconfigured: boolean;
}) {
  if (unconfigured) {
    return <Badge variant="outline">A configurar</Badge>;
  }
  return (
    <Badge variant={active ? "default" : "secondary"}>
      {active ? "Ativo" : "Inativo"}
    </Badge>
  );
}

/**
 * Tela de modelos de mensagem (`/app/config/mensagens`). Lista fixa de 4 cards
 * (domínio fechado) com editor em `Dialog`. Leitura/escrita sob RLS do tenant
 * (isolamento no banco). RBAC é defesa em profundidade: papel não-admin vê
 * `AccessDenied` (a trava real é o RLS da ADR-01).
 */
export function TemplatesMensagemPage() {
  const { canManageMessageTemplates } = usePermissions();
  const templatesQuery = useMessageTemplates();

  const [editing, setEditing] = useState<TemplateCard | null>(null);

  const cards = useMemo(
    () => toCards(templatesQuery.data ?? []),
    [templatesQuery.data],
  );

  if (!canManageMessageTemplates) {
    return <AccessDenied backTo="/app/config" backLabel="Voltar às configurações" />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Modelos de mensagem"
        descricao="Os textos que seus clientes recebem no WhatsApp."
      />

      {templatesQuery.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2" aria-busy="true">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : templatesQuery.isError ? (
        <StatePanel
          titulo="Não foi possível carregar os modelos"
          descricao="Verifique sua conexão e tente novamente."
        >
          <Button
            variant="outline"
            onClick={() => void templatesQuery.refetch()}
          >
            Tentar novamente
          </Button>
        </StatePanel>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {cards.map((card) => (
            <Card key={card.templateKey} className="flex h-full flex-col">
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <CardTitle className="text-base">
                    {getMessageTemplateLabel(card.templateKey)}
                  </CardTitle>
                  <TemplateStatusBadge
                    active={card.active}
                    unconfigured={card.unconfigured}
                  />
                </div>
                <CardDescription className="line-clamp-3 min-h-[3.75rem] whitespace-pre-wrap">
                  {card.unconfigured
                    ? "Ainda sem texto. Edite para definir a mensagem."
                    : card.body}
                </CardDescription>
              </CardHeader>
              <CardContent className="mt-auto">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditing(card)}
                >
                  <Pencil aria-hidden="true" />
                  Editar
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {editing ? (
        <TemplateEditorDialog
          open={!!editing}
          onOpenChange={(open) => {
            if (!open) setEditing(null);
          }}
          templateKey={editing.templateKey}
          body={editing.body}
          active={editing.active}
        />
      ) : null}
    </div>
  );
}
