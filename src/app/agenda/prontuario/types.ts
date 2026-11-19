import { z } from "zod";

/**
 * Linha de `clinical_records` (ficha clínica append-only). Nenhum campo de
 * conteúdo sai daqui para log/toast — dado de saúde (LGPD art. 11).
 */
export const clinicalRecordRowSchema = z.object({
  id: z.string(),
  tenant_id: z.string(),
  customer_id: z.string(),
  appointment_id: z.string(),
  supersedes_id: z.string().nullable(),
  allergies: z.string().nullable(),
  medications: z.string().nullable(),
  clinical_notes: z.string().nullable(),
  created_by: z.string(),
  created_at: z.string(),
});

export const clinicalRecordListSchema = z.array(clinicalRecordRowSchema);

export type ClinicalRecord = z.infer<typeof clinicalRecordRowSchema>;

function optionalClinicalField(max: number, rotulo: string) {
  return z
    .string()
    .trim()
    .max(max, `${rotulo}: máximo de ${max} caracteres.`)
    .default("");
}

/**
 * Formulário de registro clínico (ficha e evolução usam o mesmo schema).
 * Ao menos um campo preenchido (RF-03 do banco); limites espelham o trigger
 * (alergias/medicamentos 500, observações 2000). O trim garante o que o banco
 * exige (sem espaço/tab/CR/LF/U+00A0 nas pontas).
 */
export const clinicalRecordFormSchema = z
  .object({
    allergies: optionalClinicalField(500, "Alergias"),
    medications: optionalClinicalField(500, "Medicamentos"),
    clinicalNotes: optionalClinicalField(2000, "Observações"),
  })
  .refine(
    (data) =>
      data.allergies !== "" ||
      data.medications !== "" ||
      data.clinicalNotes !== "",
    {
      message: "Preencha ao menos um campo do registro.",
      path: ["allergies"],
    },
  );

export type ClinicalRecordFormValues = z.infer<typeof clinicalRecordFormSchema>;

export const CLINICAL_FIELD_LIMITS = {
  allergies: 500,
  medications: 500,
  clinicalNotes: 2000,
} as const;

/** Registros em ordem cronológica (criação). */
export function sortChronological(
  records: ClinicalRecord[],
): ClinicalRecord[] {
  return [...records].sort((a, b) =>
    a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0,
  );
}

/**
 * Profundidade na cadeia de correções (original = 1). A cadeia é linear
 * (índice único parcial por `supersedes_id`), então caminhar pelos pais
 * termina. Rótulo exibido como `v1`, `v2`, …
 */
export function recordVersion(
  record: ClinicalRecord,
  byId: Map<string, ClinicalRecord>,
): number {
  let depth = 1;
  let current = record.supersedes_id;
  const seen = new Set<string>([record.id]);
  while (current) {
    if (seen.has(current)) break;
    seen.add(current);
    depth += 1;
    current = byId.get(current)?.supersedes_id ?? null;
  }
  return depth;
}

/**
 * Ficha vigente = cabeça da cadeia (a que nenhuma outra sucede). Com cadeia
 * linear, é o registro mais recente que não é apontado por `supersedes_id`.
 */
export function currentRecord(
  records: ClinicalRecord[],
): ClinicalRecord | null {
  if (records.length === 0) return null;
  const superseded = new Set(
    records
      .map((record) => record.supersedes_id)
      .filter((id): id is string => id !== null),
  );
  const heads = sortChronological(records).filter(
    (record) => !superseded.has(record.id),
  );
  return heads.length > 0 ? heads[heads.length - 1] : null;
}
