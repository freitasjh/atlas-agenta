import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useFiscalEvents } from "@/hooks/useFiscalDocuments";
import {
  buildDanfeQrPayload,
  FISCAL_STATUS_META,
  fiscalMotivoLegivel,
  formatChaveAcesso,
  type FiscalDocument,
} from "@/lib/fiscal";
import { formatCentsToBRL } from "@/lib/money";

interface DanfeModalProps {
  documento: FiscalDocument | null;
  aoFechar: () => void;
}

/** Matriz decorativa 21×21 derivada da chave (placeholder visual do QR). */
function QrPlaceholder({ chave }: { chave: string }) {
  const celulas = useMemo(() => {
    const digitos = chave.replace(/[^0-9]/g, "");
    return Array.from({ length: 441 }, (_, i) => {
      const d = Number(digitos[i % digitos.length] ?? "0");
      return (d + i) % 3 !== 0;
    });
  }, [chave]);
  return (
    <svg
      role="img"
      aria-label="QR Code da DANFE para consulta na SEFAZ"
      viewBox="0 0 21 21"
      className="h-40 w-40 rounded-md border border-border bg-white p-2"
    >
      {celulas.map((cheia, i) => (
        <rect
          key={i}
          x={i % 21}
          y={Math.floor(i / 21)}
          width={0.92}
          height={0.92}
          fill={cheia ? "#18181b" : "#ffffff"}
        />
      ))}
    </svg>
  );
}

/**
 * Modal DANFE (ADR-03 RF-05/UX-SPEC A): QR + chave + valor + XML para download.
 * Em contingência exibe a marca "sem valor fiscal" (decisão PRD §10.2).
 * Admin-only por construção (a página já é `RequireRole admin` + RLS).
 */
export function DanfeModal({ documento, aoFechar }: DanfeModalProps) {
  const aberto = documento !== null;
  const { data: eventos } = useFiscalEvents(documento?.id ?? null, aberto);
  const qr = documento ? buildDanfeQrPayload(documento.chave_acesso) : null;
  const meta = documento ? FISCAL_STATUS_META[documento.status] : null;

  function baixarXml() {
    if (!documento?.xml) return;
    const blob = new Blob([documento.xml], { type: "application/xml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `nfce-${documento.numero ?? documento.id}.xml`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => { if (!v) aoFechar(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md" aria-label="DANFE da nota fiscal">
        <DialogHeader>
          <DialogTitle>DANFE — NFC-e {documento?.numero ? `nº ${documento.numero}` : ""}</DialogTitle>
          <DialogDescription>
            Série {documento?.serie ?? "—"} · {documento ? formatCentsToBRL(documento.valor_cents) : ""}
          </DialogDescription>
        </DialogHeader>
        {documento && meta ? (
          <div className="space-y-4">
            {!meta.temValorFiscal ? (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm font-medium" role="note">
                Contingência, sem valor fiscal — {fiscalMotivoLegivel(documento.status, null)}
              </p>
            ) : null}
            <div className="flex flex-col items-center gap-2">
              {qr && documento.chave_acesso ? (
                <QrPlaceholder chave={documento.chave_acesso} />
              ) : (
                <p className="text-sm text-muted-foreground" role="note">
                  QR indisponível neste estado — a chave só existe após autorização.
                </p>
              )}
              {qr ? (
                <p className="break-all text-center text-xs text-muted-foreground">{qr}</p>
              ) : null}
            </div>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Chave de acesso</dt>
                <dd className="break-all text-right font-mono text-xs">{formatChaveAcesso(documento.chave_acesso)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Estado</dt>
                <dd className="font-medium">{meta.rotulo}</dd>
              </div>
            </dl>
            {eventos && eventos.length > 0 ? (
              <div className="space-y-1">
                <h3 className="text-sm font-medium">Trilha auditável</h3>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {eventos.map((e) => (
                    <li key={e.id}>
                      {e.tipo}
                      {e.motivo ? ` — ${e.motivo}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={!documento.xml}
                onClick={baixarXml}
              >
                Baixar XML
              </Button>
              <Button type="button" className="min-h-11" onClick={aoFechar}>
                Fechar
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
