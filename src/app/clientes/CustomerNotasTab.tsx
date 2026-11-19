import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { crmMessages } from "@/app/clientes/crm-messages";
import { canCreateNote, canViewNote, type CrmRole } from "@/app/clientes/crm-model";
import { useCreateCustomerNote, useCustomerNotes } from "@/hooks/useCustomerCrm";
import { useEffectiveProfessionalId } from "@/hooks/useEffectiveProfessionalId";
import { usePermissions } from "@/hooks/usePermissions";

const t = crmMessages.notas;

function roleOf(permissions: { isAdmin: boolean; isReceptionist: boolean }): CrmRole {
  if (permissions.isAdmin) return "admin";
  if (permissions.isReceptionist) return "receptionist";
  return "professional";
}

function visibilityBadge(visibility: string): string {
  if (visibility === "admin") return t.adminBadge;
  if (visibility === "appointment") return t.appointmentBadge;
  return t.operationalBadge;
}

export function CustomerNotasTab({ customerId }: { customerId: string }) {
  const permissions = usePermissions();
  const role = roleOf(permissions);
  // `undefined` p/ admin/recepção (ignorado) ou professional sem vínculo (nega tudo — fail-closed).
  const ownProfessionalId = useEffectiveProfessionalId();
  const notesQuery = useCustomerNotes(customerId);
  const createMutation = useCreateCustomerNote(customerId);
  const [body, setBody] = useState("");

  const visibleNotes = useMemo(() => {
    const notes = notesQuery.data ?? [];
    return notes.filter((note) =>
      canViewNote(
        note,
        role,
        {
          professionalId: ownProfessionalId,
          appointmentProfessionalId: note.appointmentProfessionalId,
        },
      ),
    );
  }, [notesQuery.data, role, ownProfessionalId]);

  const writable = canCreateNote(role);

  async function handleAdd() {
    const trimmed = body.trim();
    if (trimmed === "") return;
    try {
      await createMutation.mutateAsync({ body: trimmed });
      setBody("");
      toast.success(t.addSuccess);
    } catch {
      toast.error(t.addError);
    }
  }

  if (notesQuery.isLoading) {
    return <Skeleton className="h-32 w-full" aria-label={t.title} />;
  }

  return (
    <div className="space-y-4">
      {writable ? (
        <Card>
          <CardHeader>
            <CardTitle>{t.newLabel}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <label htmlFor={`nota-nova-${customerId}`} className="sr-only">
              {t.newLabel}
            </label>
            <Textarea
              id={`nota-nova-${customerId}`}
              placeholder={t.newPlaceholder}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={3}
            />
            <Button
              type="button"
              onClick={() => void handleAdd()}
              disabled={createMutation.isPending || body.trim() === ""}
            >
              {createMutation.isPending ? t.adding : t.add}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {visibleNotes.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>{t.emptyTitle}</CardTitle>
            <CardDescription>
              {writable ? t.emptyDescription : t.hiddenForRole}
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ul className="space-y-3" aria-label={t.title}>
          {visibleNotes.map((note) => (
            <li key={note.id} className="rounded-lg border border-border p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <Badge variant={note.visibility === "operational" ? "secondary" : "outline"}>
                  {visibilityBadge(note.visibility)}
                </Badge>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {new Date(note.createdAt).toLocaleString("pt-BR")}
                </span>
              </div>
              <p className="text-sm text-foreground">{note.body}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
