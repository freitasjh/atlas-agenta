import type { UserAuditLogEntry } from "@/hooks/useUserAuditLog";
import { userAuditActionLabel } from "@/app/config/auditoria/auditLabels";

const CSV_HEADERS = ["data", "acao", "ator", "alvo"] as const;

function escapeCsvCell(value: string): string {
  // Previne CSV formula injection: célula que começa com = + - @ vira texto
  // (prefixo `'`) antes do quoting — o Excel/Sheets não interpreta como fórmula.
  const guarded = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return /[;"\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

function targetLabel(entry: UserAuditLogEntry): string {
  if (!entry.target_type) return "—";
  return `${entry.target_type}:${entry.target_id ?? ""}`;
}

/**
 * Gera o CSV das entradas filtradas (pt-BR, UTF-8 com BOM para o Excel).
 * Função pura — o download via Blob vive na página.
 */
export function buildUserAuditCsv(entries: UserAuditLogEntry[]): string {
  const lines = entries.map((entry) =>
    [
      new Date(entry.created_at).toLocaleString("pt-BR"),
      userAuditActionLabel(entry.action),
      entry.actor_id ?? "—",
      targetLabel(entry),
    ]
      .map(escapeCsvCell)
      .join(";"),
  );
  return `\uFEFF${[...CSV_HEADERS].join(";")}\n${lines.join("\n")}${lines.length > 0 ? "\n" : ""}`;
}

export function downloadUserAuditCsv(entries: UserAuditLogEntry[]): void {
  const blob = new Blob([buildUserAuditCsv(entries)], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "auditoria-usuarios.csv";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
