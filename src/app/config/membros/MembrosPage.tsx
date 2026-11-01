import { useState } from "react";
import { z } from "zod";
import { Loader2, MailPlus, RefreshCw, ShieldOff } from "lucide-react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  type Invitation,
  useInvitations,
  useInviteMember,
  useResendInvitation,
  useRevokeInvitation,
} from "@/hooks/useInvitations";
import { usePermissions } from "@/hooks/usePermissions";

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super admin",
  admin: "Administrador",
  professional: "Profissional",
  receptionist: "Recepção",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pendente",
  accepted: "Aceito",
  revoked: "Revogado",
  expired: "Expirado",
};

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  accepted: "default",
  revoked: "secondary",
  expired: "secondary",
};

const TENANT_ROLES = ["admin", "professional", "receptionist"] as const;

const emailSchema = z.string().trim().email();

function formatDate(value: string): string {
  try {
    return new Date(value).toLocaleDateString("pt-BR");
  } catch {
    return value;
  }
}

export function MembrosPage() {
  const { isAdmin } = usePermissions();
  const invitationsQuery = useInvitations();
  const inviteMember = useInviteMember();
  const resendInvitation = useResendInvitation();
  const revokeInvitation = useRevokeInvitation();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<(typeof TENANT_ROLES)[number]>("professional");
  const [actingId, setActingId] = useState<string | null>(null);

  const invitations = invitationsQuery.data ?? [];

  async function handleInvite() {
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      toast.error("Informe um e-mail válido.");
      return;
    }
    try {
      await inviteMember.mutateAsync({ email: parsed.data, role });
      toast.success("Convite enviado.");
      setDialogOpen(false);
      setEmail("");
      setRole("professional");
    } catch {
      toast.error("Não foi possível enviar o convite. Tente novamente.");
    }
  }

  async function handleResend(invitation: Invitation) {
    setActingId(invitation.id);
    try {
      await resendInvitation.mutateAsync(invitation.id);
      toast.success("Convite reenviado.");
    } catch {
      toast.error("Não foi possível reenviar o convite. Tente novamente.");
    } finally {
      setActingId(null);
    }
  }

  async function handleRevoke(invitation: Invitation) {
    setActingId(invitation.id);
    try {
      await revokeInvitation.mutateAsync(invitation.id);
      toast.success("Convite revogado.");
    } catch {
      toast.error("Não foi possível revogar o convite. Tente novamente.");
    } finally {
      setActingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Membros"
        descricao="Convide pessoas para a sua empresa e gerencie os convites pendentes."
        acoes={
          isAdmin ? (
            <Button onClick={() => setDialogOpen(true)}>
              <MailPlus aria-hidden="true" />
              Convidar membro
            </Button>
          ) : undefined
        }
      />

      {invitationsQuery.isLoading ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : invitationsQuery.isError ? (
        <StatePanel
          titulo="Não foi possível carregar os convites"
          descricao="Verifique sua conexão e tente novamente."
        >
          <Button variant="outline" onClick={() => void invitationsQuery.refetch()}>
            Tentar novamente
          </Button>
        </StatePanel>
      ) : invitations.length === 0 ? (
        <StatePanel
          titulo="Nenhum convite enviado"
          descricao={
            isAdmin
              ? "Convide membros para a sua empresa."
              : "Ainda não há convites registrados."
          }
        >
          {isAdmin ? (
            <Button onClick={() => setDialogOpen(true)}>
              <MailPlus aria-hidden="true" />
              Convidar membro
            </Button>
          ) : null}
        </StatePanel>
      ) : (
        <div className="hidden rounded-lg border border-border md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>E-mail</TableHead>
                <TableHead>Papel</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Expira em</TableHead>
                {isAdmin ? <TableHead className="text-right">Ações</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {invitations.map((invitation) => {
                const isPending = invitation.status === "pending";
                const busy = actingId === invitation.id;
                return (
                  <TableRow key={invitation.id}>
                    <TableCell className="font-medium text-foreground">
                      {invitation.email}
                    </TableCell>
                    <TableCell>{ROLE_LABELS[invitation.role] ?? invitation.role}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANTS[invitation.status] ?? "secondary"}>
                        {STATUS_LABELS[invitation.status] ?? invitation.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatDate(invitation.expires_at)}</TableCell>
                    {isAdmin ? (
                      <TableCell className="text-right">
                        {isPending ? (
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busy}
                              onClick={() => void handleResend(invitation)}
                            >
                              {busy ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <RefreshCw aria-hidden="true" />
                              )}
                              Reenviar
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={busy}
                              onClick={() => void handleRevoke(invitation)}
                            >
                              {busy ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <ShieldOff aria-hidden="true" />
                              )}
                              Revogar
                            </Button>
                          </div>
                        ) : null}
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Mobile: cards */}
      {invitations.length > 0 ? (
        <ul className="space-y-3 md:hidden">
          {invitations.map((invitation) => {
            const isPending = invitation.status === "pending";
            const busy = actingId === invitation.id;
            return (
              <li key={invitation.id} className="rounded-lg border border-border p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="font-medium text-foreground">{invitation.email}</p>
                    <p className="text-sm text-muted-foreground">
                      {ROLE_LABELS[invitation.role] ?? invitation.role} ·{" "}
                      {STATUS_LABELS[invitation.status] ?? invitation.status}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Expira em {formatDate(invitation.expires_at)}
                    </p>
                  </div>
                  <Badge variant={STATUS_VARIANTS[invitation.status] ?? "secondary"}>
                    {STATUS_LABELS[invitation.status] ?? invitation.status}
                  </Badge>
                </div>
                {isAdmin && isPending ? (
                  <div className="mt-3 flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() => void handleResend(invitation)}
                    >
                      Reenviar
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => void handleRevoke(invitation)}
                    >
                      Revogar
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Convidar membro</DialogTitle>
            <DialogDescription>
              Envie um convite por e-mail para um novo membro da empresa.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="invite-email">E-mail</Label>
              <Input
                id="invite-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nome@empresa.com"
                autoComplete="email"
              />
            </div>
            <div className="space-y-2">
              <Label>Papel</Label>
              <Select value={role} onValueChange={(v) => setRole(v as typeof role)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TENANT_ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABELS[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => void handleInvite()} disabled={inviteMember.isPending}>
              {inviteMember.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <MailPlus aria-hidden="true" />
              )}
              Enviar convite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

