import { useMemo, useState } from "react";

import { PageHeader } from "@/components/PageHeader";
import { StatePanel } from "@/components/StatePanel";
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
import {
  USER_AUDIT_ACTIONS,
  useUserAuditLog,
  type UserAuditLogEntry,
} from "@/hooks/useUserAuditLog";
import { userAuditActionLabel } from "@/app/config/auditoria/auditLabels";
import { downloadUserAuditCsv } from "@/app/config/auditoria/exportAuditCsv";

function formatDate(value: string): string {
  try {
    return new Date(value).toLocaleString("pt-BR");
  } catch {
    return value;
  }
}

function targetLabel(entry: UserAuditLogEntry): string {
  if (!entry.target_type) return "—";
  return `${entry.target_type}:${entry.target_id ?? ""}`;
}

/**
 * Auditoria do tenant (`/app/config/auditoria`, admin). Lista ações de
 * usuário do próprio tenant sob RLS — sem filtro de `tenant_id` do cliente.
 * Não confundir com a AuditoriaPage da área interna (`/internal-admin/auditoria`).
 */
export function AuditoriaTenantPage() {
  const [action, setAction] = useState<string>("todas");
  const [actor, setActor] = useState<string>("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  const filters = useMemo(
    () => ({
      action,
      actor: actor.trim() === "" ? null : actor.trim(),
      from: from.trim() === "" ? null : from.trim(),
      to: to.trim() === "" ? null : to.trim(),
    }),
    [action, actor, from, to],
  );

  const auditQuery = useUserAuditLog(filters);
  const entries: UserAuditLogEntry[] = auditQuery.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Auditoria"
        descricao="Quem fez o quê na sua empresa: convites, papéis e vínculos."
      />

      <div className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-4">
        <div className="space-y-2">
          <Label htmlFor="auditoria-acao">Ação</Label>
          <Select value={action} onValueChange={setAction}>
            <SelectTrigger id="auditoria-acao">
              <SelectValue placeholder="Todas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas</SelectItem>
              {USER_AUDIT_ACTIONS.map((a) => (
                <SelectItem key={a} value={a}>
                  {userAuditActionLabel(a)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="auditoria-ator">Buscar por ator</Label>
          <Input
            id="auditoria-ator"
            value={actor}
            onChange={(e) => setActor(e.target.value)}
            placeholder="ID do ator"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="auditoria-de">De</Label>
          <Input
            id="auditoria-de"
            type="datetime-local"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="auditoria-ate">Até</Label>
          <Input
            id="auditoria-ate"
            type="datetime-local"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground" role="status">
          {entries.length === 1
            ? "1 registro encontrado"
            : `${entries.length} registros encontrados`}
        </p>
        <div className="flex flex-col gap-1 sm:items-end">
          <Button
            variant="outline"
            onClick={() => downloadUserAuditCsv(entries)}
            disabled={entries.length === 0}
          >
            Exportar CSV
          </Button>
          <p className="text-xs text-muted-foreground">
            O arquivo contém dados pessoais. Compartilhe com cuidado.
          </p>
        </div>
      </div>

      {auditQuery.isLoading ? (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : auditQuery.isError ? (
        <StatePanel
          titulo="Não foi possível carregar a auditoria"
          descricao="Verifique sua conexão e tente novamente."
        >
          <Button variant="outline" onClick={() => void auditQuery.refetch()}>
            Tentar novamente
          </Button>
        </StatePanel>
      ) : entries.length === 0 ? (
        <StatePanel
          titulo="Nenhum registro encontrado"
          descricao="Ajuste os filtros para ver outros registros."
        />
      ) : (
        <div className="hidden rounded-lg border border-border md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quando</TableHead>
                <TableHead>Ator</TableHead>
                <TableHead>Ação</TableHead>
                <TableHead>Alvo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>{formatDate(entry.created_at)}</TableCell>
                  <TableCell>{entry.actor_id ?? "—"}</TableCell>
                  <TableCell className="font-medium text-foreground">
                    {userAuditActionLabel(entry.action)}
                  </TableCell>
                  <TableCell>{targetLabel(entry)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {entries.length > 0 ? (
        <ul className="space-y-3 md:hidden">
          {entries.map((entry) => (
            <li key={entry.id} className="rounded-lg border border-border p-4">
              <p className="font-medium text-foreground">
                {userAuditActionLabel(entry.action)}
              </p>
              <p className="text-sm text-muted-foreground">
                {formatDate(entry.created_at)}
              </p>
              <p className="text-xs text-muted-foreground">
                Ator: {entry.actor_id ?? "—"}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
