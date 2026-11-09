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

function formatDate(value: string): string {
  try {
    return new Date(value).toLocaleDateString("pt-BR");
  } catch {
    return value;
  }
}

const emailSchema = z.string().trim().email();

export function ConvitesPage() {
  const invitationsQuery = useInvitations();
  const inviteMember = useInviteMember();
  const resendInvitation = useResendInvitation();
  const revokeInvitation = useRevokeInvitation();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [actingId, setActingId] = useState<string | null>(null);

  const invitations = invitationsQuery.data ?? [];

  async function handleInvite() {
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      toast.error("Informe um e-mail válido.");
      return;
    }
    try {
      await inviteMember.mutateAsync({ email: parsed.data, role: "super_admin" });
      toast.success("Convite enviado.");
      setDialogOpen(false);
      setEmail("");
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
        titulo="Convites de super admin"
        descricao="Convide novos super administradores da plataforma."
        acoes={
          <Button onClick={() => setDialogOpen(true)}>
            <MailPlus aria-hidden="true" />
            Convidar super admin
          </Button>
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
          descricao="Convide super administradores para a plataforma."
        >
          <Button onClick={() => setDialogOpen(true)}>
            <MailPlus aria-hidden="true" />
            Convidar super admin
          </Button>
        </StatePanel>
      ) : (
        <>
          <div className="hidden rounded-lg border border-border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>E-mail</TableHead>
                  <TableHead>Papel</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Expira em</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
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
                      <TableCell className="text-right">
                        {isPending ? (
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busy}
                              onClick={() => void handleResend(invitation)}
                            >
                              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw aria-hidden="true" />}
                              Reenviar
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={busy}
                              onClick={() => void handleRevoke(invitation)}
                            >
                              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldOff aria-hidden="true" />}
                              Revogar
                            </Button>
                          </div>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

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
                  {isPending ? (
                    <div className="mt-3 flex gap-2">
                      <Button variant="ghost" size="sm" disabled={busy} onClick={() => void handleResend(invitation)}>
                        Reenviar
                      </Button>
                      <Button variant="outline" size="sm" disabled={busy} onClick={() => void handleRevoke(invitation)}>
                        Revogar
                      </Button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Convidar super admin</DialogTitle>
            <DialogDescription>
              Envie um convite por e-mail para um novo super administrador.
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
                placeholder="nome@plataforma.com"
                autoComplete="email"
              />
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
