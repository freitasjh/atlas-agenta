import { useState } from "react"
import { History, Search } from "lucide-react"
import { Input } from "../ui/input"
import { Badge } from "../ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table"
import { 
  type AuditLogEntry, 
  formatDateTimeBR 
} from "./backoffice-types"

interface AuditLogTableProps {
  logs: AuditLogEntry[]
}

export function AuditLogTable({ logs }: AuditLogTableProps) {
  const [searchQuery, setSearchQuery] = useState("")

  const filteredLogs = logs.filter((log) => {
    if (!searchQuery.trim()) return true
    const q = searchQuery.toLowerCase()
    return (
      log.operatorName.toLowerCase().includes(q) ||
      log.action.toLowerCase().includes(q) ||
      log.targetId.toLowerCase().includes(q) ||
      (log.justification && log.justification.toLowerCase().includes(q))
    )
  })

  return (
    <div className="space-y-3">
      {/* Header e Busca da Trilha de Auditoria */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="space-y-0.5">
          <h3 className="font-semibold text-sm text-foreground flex items-center gap-1.5">
            <History className="h-4 w-4 text-primary" />
            Trilha Imutável de Auditoria Operacional (Audit Trail)
          </h3>
          <p className="text-xs text-muted-foreground">
            Registro detalhado de todas as intervenções manuais, aprovações e bloqueios realizados por operadores.
          </p>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filtrar por analista, ação ou ID..."
            className="pl-8 text-xs h-8 w-full"
          />
        </div>
      </div>

      {/* Tabela de Logs */}
      <div className="rounded-xl border border-border/80 bg-card overflow-hidden shadow-2xs">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-36 font-semibold text-xs pl-4">Data / Hora</TableHead>
              <TableHead className="w-44 font-semibold text-xs">Operador / Analista</TableHead>
              <TableHead className="w-48 font-semibold text-xs">Ação Executada</TableHead>
              <TableHead className="w-44 font-semibold text-xs">Alvo / Recurso</TableHead>
              <TableHead className="min-w-[240px] font-semibold text-xs">Justificativa & Parecer Técnico</TableHead>
              <TableHead className="w-28 font-semibold text-xs pr-4 text-right">IP Origem</TableHead>
            </TableRow>
          </TableHeader>

          <TableBody>
            {filteredLogs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-28 text-center text-sm text-muted-foreground">
                  Nenhum log de auditoria encontrado para o filtro informado.
                </TableCell>
              </TableRow>
            ) : (
              filteredLogs.map((log) => (
                <TableRow key={log.id} className="hover:bg-muted/40 transition-colors">
                  <TableCell className="pl-4 font-mono text-xs text-muted-foreground whitespace-nowrap">
                    {formatDateTimeBR(log.timestamp)}
                  </TableCell>

                  <TableCell>
                    <div className="space-y-0.5">
                      <p className="font-medium text-xs text-foreground">{log.operatorName}</p>
                      <p className="text-[10px] text-muted-foreground">{log.operatorRole}</p>
                    </div>
                  </TableCell>

                  <TableCell>
                    <Badge variant="outline" className={`text-[10px] ${
                      log.status === "warning"
                        ? "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20"
                        : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                    }`}>
                      {log.action}
                    </Badge>
                  </TableCell>

                  <TableCell>
                    <div className="space-y-0.5">
                      <span className="text-xs text-foreground block">{log.targetResource}</span>
                      <span className="text-[10px] font-mono text-muted-foreground">{log.targetId}</span>
                    </div>
                  </TableCell>

                  <TableCell>
                    <div className="space-y-1 py-1">
                      {log.reasonCode && (
                        <Badge variant="secondary" className="text-[9px] font-mono py-0 px-1.5 h-4">
                          {log.reasonCode}
                        </Badge>
                      )}
                      <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                        {log.justification || "Ação sistêmica automatizada sem memo livre."}
                      </p>
                    </div>
                  </TableCell>

                  <TableCell className="pr-4 text-right font-mono text-xs text-muted-foreground">
                    {log.ipAddress}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
