import { useMemo, useState } from "react";

import { PageHeader } from "@/components/PageHeader";
import { StatePanel } from "@/components/StatePanel";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
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

import {
  useAuditLog,
  type AuditLogFilters,
  type AuditLogEntry,
} from "@/hooks/useAuditLog";

function formatDate(value: string): string {
  try {
    return new Date(value).toLocaleString("pt-BR");
  } catch {
    return value;
  }
}

export function AuditoriaPage() {
  const [action, setAction] = useState<string>("todos");
  const [actor, setActor] = useState<string>("");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");

  const filters: AuditLogFilters = useMemo(
    () => ({
      action: action === "todos" ? "todos" : action,
      actor: actor.trim() === "" ? null : actor.trim(),
      from: from.trim() === "" ? null : from.trim(),
      to: to.trim() === "" ? null : to.trim(),
    }),
    [action, actor, from, to],
  );

  const auditQuery = useAuditLog(filters);
  const entries: AuditLogEntry[] = auditQuery.data ?? [];

  const actions = useMemo(() => {
    if (Array.isArray(auditQuery.allActions)) {
      return [...auditQuery.allActions].sort();
    }
    const source =
      auditQuery.rawData ??
      auditQuery.allData ??
      auditQuery.raw ??
      auditQuery.unfiltered ??
      auditQuery.data ??
      [];
    const set = new Set<string>();
    for (const e of source) set.add(e.action);
    return Array.from(set).sort();
  }, [
    auditQuery.allActions,
    auditQuery.rawData,
    auditQuery.allData,
    auditQuery.raw,
    auditQuery.unfiltered,
    auditQuery.data,
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Auditoria"
        descricao="Trilha de ações realizadas na plataforma."
      />

      <div className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-4">
        <div className="space-y-2">
          <Label>Ação</Label>
          <Select value={action} onValueChange={setAction}>
            <SelectTrigger>
              <SelectValue placeholder="Todas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todas</SelectItem>
              {actions.map((a) => (
                <SelectItem key={a} value={a}>
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="audit-actor">Ator</Label>
          <Input
            id="audit-actor"
            value={actor}
            onChange={(e) => setActor(e.target.value)}
            placeholder="ID do ator"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="audit-from">De</Label>
          <Input
            id="audit-from"
            type="datetime-local"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="audit-to">Até</Label>
          <Input
            id="audit-to"
            type="datetime-local"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
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
                <TableHead>Data</TableHead>
                <TableHead>Ação</TableHead>
                <TableHead>Ator</TableHead>
                <TableHead>Alvo</TableHead>
                <TableHead>Metadados</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell>{formatDate(entry.created_at)}</TableCell>
                  <TableCell className="font-medium text-foreground">
                    {entry.action}
                  </TableCell>
                  <TableCell>{entry.actor_id ?? "—"}</TableCell>
                  <TableCell>
                    {entry.target_type ? `${entry.target_type}:${entry.target_id ?? ""}` : "—"}
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-xs text-muted-foreground">
                    {JSON.stringify(entry.metadata ?? {})}
                  </TableCell>
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
              <p className="font-medium text-foreground">{entry.action}</p>
              <p className="text-sm text-muted-foreground">{formatDate(entry.created_at)}</p>
              <p className="text-xs text-muted-foreground">Ator: {entry.actor_id ?? "—"}</p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
