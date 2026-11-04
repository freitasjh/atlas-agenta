import { useState } from "react";
import { z } from "zod";
import { Loader2, Pencil, ShieldOff, UserCog } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

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

import { supabase } from "@/lib/supabase";
import { useTenantUsers, TENANT_USERS_KEY, type TenantUser } from "@/hooks/useTenantUsers";
import { usePermissions } from "@/hooks/usePermissions";
import { useTenant } from "@/hooks/useTenant";
import { formatDateInTenantTz } from "@/lib/datetime";
import { ROLE_LABELS, TENANT_ROLES } from "@/lib/roles";
const fullNameSchema = z.string().trim().max(255);

function formatDate(value: string, timeZone = "America/Sao_Paulo"): string {
  try {
    return formatDateInTenantTz(value, timeZone);
  } catch {
    return value;
  }
}

export function AtivosTab() {
  const { isAdmin } = usePermissions();
  const queryClient = useQueryClient();
  const usersQuery = useTenantUsers();
  const tenantQuery = useTenant();
  const timeZone = tenantQuery.data?.timezone ?? "America/Sao_Paulo";

  const [editingUser, setEditingUser] = useState<TenantUser | null>(null);
  const [editingName, setEditingName] = useState("");
  const [roleUser, setRoleUser] = useState<TenantUser | null>(null);
  const [newRole, setNewRole] = useState<(typeof TENANT_ROLES)[number]>("professional");
  const [actingId, setActingId] = useState<string | null>(null);
  const [confirmToggleUser, setConfirmToggleUser] = useState<TenantUser | null>(null);

  const users = usersQuery.data ?? [];

  async function handleSaveName() {
    if (!editingUser) return;
    const parsed = fullNameSchema.safeParse(editingName);
    if (!parsed.success) {
      toast.error("Nome muito longo. Use no máximo 255 caracteres.");
      return;
    }
    setActingId(editingUser.id);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ full_name: parsed.data.length ? parsed.data : null })
        .eq("id", editingUser.id);
      if (error) throw error;
      toast.success("Nome atualizado.");
      setEditingUser(null);
      void queryClient.invalidateQueries({ queryKey: TENANT_USERS_KEY });
    } catch {
      toast.error("Não foi possível atualizar o nome. Tente novamente.");
    } finally {
      setActingId(null);
    }
  }

  async function handleChangeRole() {
    if (!roleUser) return;
    setActingId(roleUser.id);
    try {
      const { error } = await supabase.functions.invoke("change-user-role", {
        body: { user_id: roleUser.id, new_role: newRole },
      });
      if (error) throw error;
      toast.success("Papel alterado.");
      setRoleUser(null);
      void queryClient.invalidateQueries({ queryKey: TENANT_USERS_KEY });
    } catch {
      toast.error("Não foi possível alterar o papel. Tente novamente.");
    } finally {
      setActingId(null);
    }
  }

  async function handleToggleActive(user: TenantUser) {
    setActingId(user.id);
    try {
      const fn = user.active ? "deactivate-user" : "reactivate-user";
      const { error } = await supabase.functions.invoke(fn, {
        body: { user_id: user.id },
      });
      if (error) throw error;
      toast.success(user.active ? "Usuário desativado." : "Usuário reativado.");
      void queryClient.invalidateQueries({ queryKey: TENANT_USERS_KEY });
    } catch {
      toast.error("Não foi possível alterar o status. Tente novamente.");
    } finally {
      setActingId(null);
    }
  }

  if (usersQuery.isLoading) {
    return (
      <div className="space-y-2" aria-busy="true">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (usersQuery.isError) {
    return (
      <StatePanel
        titulo="Não foi possível carregar os usuários"
        descricao="Verifique sua conexão e tente novamente."
      >
        <Button variant="outline" onClick={() => void usersQuery.refetch()}>
          Tentar novamente
        </Button>
      </StatePanel>
    );
  }

  if (users.length === 0) {
    return (
      <StatePanel
        titulo="Nenhum usuário ativo"
        descricao="Os membros da empresa aparecerão aqui."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="hidden rounded-lg border border-border md:block">
        <Table>
          <caption className="sr-only">Usuários ativos da empresa</caption>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>E-mail</TableHead>
              <TableHead>Papel</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Desde</TableHead>
              {isAdmin ? <TableHead className="text-right">Ações</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => {
              const busy = actingId === user.id;
              return (
                <TableRow key={user.id}>
                  <TableCell className="font-medium text-foreground">
                    {user.full_name ?? "—"}
                  </TableCell>
                  <TableCell>{user.email ?? "—"}</TableCell>
                  <TableCell>{ROLE_LABELS[user.role] ?? user.role}</TableCell>
                  <TableCell>
                    <Badge variant={user.active ? "default" : "secondary"}>
                      {user.active ? "Ativo" : "Inativo"}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatDate(user.created_at, timeZone)}</TableCell>
                  {isAdmin ? (
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() => {
                            setEditingUser(user);
                            setEditingName(user.full_name ?? "");
                          }}
                        >
                          <Pencil aria-hidden="true" />
                          Editar nome
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() => {
                            setRoleUser(user);
                            setNewRole(
                              (TENANT_ROLES as readonly string[]).includes(user.role)
                                ? (user.role as (typeof TENANT_ROLES)[number])
                                : "professional",
                            );
                          }}
                        >
                          <UserCog aria-hidden="true" />
                          Trocar papel
                        </Button>
                        <Button
                          variant={user.active ? "outline" : "default"}
                          size="sm"
                          disabled={busy}
                          onClick={() => setConfirmToggleUser(user)}
                        >
                          {busy ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <ShieldOff aria-hidden="true" />
                          )}
                          {user.active ? "Desativar" : "Reativar"}
                        </Button>
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <ul className="space-y-3 md:hidden">
        {users.map((user) => {
          const busy = actingId === user.id;
          return (
            <li key={user.id} className="rounded-lg border border-border p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <p className="font-medium text-foreground">
                    {user.full_name ?? "—"}
                  </p>
                  <p className="text-sm text-muted-foreground">{user.email ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">
                    {ROLE_LABELS[user.role] ?? user.role} ·{" "}
                    {user.active ? "Ativo" : "Inativo"}
                  </p>
                </div>
                <Badge variant={user.active ? "default" : "secondary"}>
                  {user.active ? "Ativo" : "Inativo"}
                </Badge>
              </div>
              {isAdmin ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setEditingUser(user);
                      setEditingName(user.full_name ?? "");
                    }}
                  >
                    Editar nome
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setRoleUser(user);
                      setNewRole(
                        (TENANT_ROLES as readonly string[]).includes(user.role)
                          ? (user.role as (typeof TENANT_ROLES)[number])
                          : "professional",
                      );
                    }}
                  >
                    Trocar papel
                  </Button>
                  <Button
                    variant={user.active ? "outline" : "default"}
                    size="sm"
                    disabled={busy}
                    onClick={() => setConfirmToggleUser(user)}
                  >
                    {user.active ? "Desativar" : "Reativar"}
                  </Button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>

      <Dialog open={!!editingUser} onOpenChange={(open) => !open && setEditingUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar nome</DialogTitle>
            <DialogDescription>Atualize o nome exibido do usuário.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="edit-name">Nome</Label>
            <Input
              id="edit-name"
              value={editingName}
              onChange={(e) => setEditingName(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingUser(null)}>
              Cancelar
            </Button>
            <Button onClick={() => void handleSaveName()} disabled={actingId === editingUser?.id}>
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!roleUser} onOpenChange={(open) => !open && setRoleUser(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Trocar papel</DialogTitle>
            <DialogDescription>Selecione o novo papel do usuário.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Papel</Label>
            <Select value={newRole} onValueChange={(v) => setNewRole(v as typeof newRole)}>
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
          <DialogFooter>
            <Button variant="outline" onClick={() => setRoleUser(null)}>
              Cancelar
            </Button>
            <Button onClick={() => void handleChangeRole()} disabled={actingId === roleUser?.id}>
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!confirmToggleUser}
        onOpenChange={(open) => !open && setConfirmToggleUser(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmToggleUser?.active ? "Desativar usuário" : "Reativar usuário"}
            </DialogTitle>
            <DialogDescription>
              {confirmToggleUser?.active
                ? `Tem certeza que deseja desativar ${confirmToggleUser?.full_name ?? confirmToggleUser?.email ?? "este usuário"}?`
                : `Tem certeza que deseja reativar ${confirmToggleUser?.full_name ?? confirmToggleUser?.email ?? "este usuário"}?`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmToggleUser(null)}>
              Cancelar
            </Button>
            <Button
              variant={confirmToggleUser?.active ? "destructive" : "default"}
              onClick={() => {
                if (confirmToggleUser) {
                  void handleToggleActive(confirmToggleUser);
                  setConfirmToggleUser(null);
                }
              }}
              disabled={!!confirmToggleUser && actingId === confirmToggleUser.id}
            >
              {confirmToggleUser?.active ? "Desativar" : "Reativar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
