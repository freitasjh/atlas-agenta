import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDateInTenantTz } from "@/lib/datetime";
import {
  recordVersion,
  sortChronological,
  type ClinicalRecord,
} from "@/app/agenda/prontuario/types";
import { ClinicalRecordForm } from "@/app/agenda/prontuario/FichaAtual";

interface EvolucaoTimelineProps {
  records: ClinicalRecord[] | undefined;
  isLoading: boolean;
  canWrite: boolean;
  appointmentId: string;
  customerId: string;
  headId: string | null;
  timeZone: string;
}

/**
 * Evolução append-only em timeline: badge de versão (v1/v2…), link "ver
 * original" na correção e botão "Nova evolução" (INSERT com `supersedes_id`
 * na cabeça da cadeia). Nenhum UPDATE/DELETE em `clinical_records`.
 */
export function EvolucaoTimeline({
  records,
  isLoading,
  canWrite,
  appointmentId,
  customerId,
  headId,
  timeZone,
}: EvolucaoTimelineProps) {
  const [creating, setCreating] = useState(false);

  if (isLoading) {
    return (
      <p
        className="rounded-md border border-border p-3 text-sm text-muted-foreground"
        aria-busy="true"
      >
        Carregando evolução…
      </p>
    );
  }

  const ordered = sortChronological(records ?? []);
  const byId = new Map(ordered.map((record) => [record.id, record]));

  return (
    <section aria-labelledby="evolucao-titulo" className="space-y-3">
      <h4 id="evolucao-titulo" className="text-sm font-semibold">
        Evolução
      </h4>

      {ordered.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhum registro clínico neste atendimento.
        </p>
      ) : (
        <ol className="space-y-3">
          {ordered.map((record) => {
            const version = recordVersion(record, byId);
            const original =
              record.supersedes_id !== null
                ? byId.get(record.supersedes_id)
                : null;
            return (
              <li
                key={record.id}
                id={`registro-${record.id}`}
                className="space-y-1 rounded-md border border-border p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={version === 1 ? "default" : "secondary"}>
                    v{version}
                  </Badge>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {formatDateInTenantTz(record.created_at, timeZone)}
                  </span>
                  {record.supersedes_id !== null ? (
                    <span className="text-xs text-muted-foreground">
                      correção
                    </span>
                  ) : null}
                </div>
                {record.allergies ? (
                  <p className="text-sm">
                    <span className="font-medium">Alergias: </span>
                    {record.allergies}
                  </p>
                ) : null}
                {record.medications ? (
                  <p className="text-sm">
                    <span className="font-medium">Medicamentos: </span>
                    {record.medications}
                  </p>
                ) : null}
                {record.clinical_notes ? (
                  <p className="text-sm">
                    <span className="font-medium">Observações: </span>
                    {record.clinical_notes}
                  </p>
                ) : null}
                {original ? (
                  <p className="text-xs">
                    <a
                      href={`#registro-${original.id}`}
                      className="underline underline-offset-2"
                    >
                      Ver original (v{recordVersion(original, byId)})
                    </a>
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      {canWrite ? (
        creating ? (
          <ClinicalRecordForm
            appointmentId={appointmentId}
            customerId={customerId}
            supersedesId={headId}
            submitLabel="Salvar evolução"
            onSuccess={() => setCreating(false)}
            onCancel={() => setCreating(false)}
          />
        ) : (
          <Button type="button" onClick={() => setCreating(true)}>
            Nova evolução
          </Button>
        )
      ) : null}
    </section>
  );
}
