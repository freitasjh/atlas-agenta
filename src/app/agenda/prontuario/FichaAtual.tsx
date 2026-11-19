import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  CLINICAL_FIELD_LIMITS,
  clinicalRecordFormSchema,
  type ClinicalRecord,
  type ClinicalRecordFormValues,
} from "@/app/agenda/prontuario/types";
import {
  mapClinicalRecordError,
  useCreateClinicalRecord,
} from "@/app/agenda/prontuario/useClinicalRecords";

interface ClinicalRecordFormProps {
  appointmentId: string;
  customerId: string;
  /** Registro sucedido (cabeça da cadeia) ou `null` na primeira ficha. */
  supersedesId: string | null;
  initialValues?: ClinicalRecordFormValues;
  submitLabel: string;
  onSuccess: () => void;
  onCancel: () => void;
}

/**
 * Formulário único de registro clínico (ficha, correção e evolução).
 * Validação no blur + `aria-invalid`, contadores via `aria-describedby`,
 * fonte ≥16px (`text-base`), `enterkeyhint`. Sempre INSERT — nunca update.
 */
export function ClinicalRecordForm({
  appointmentId,
  customerId,
  supersedesId,
  initialValues,
  submitLabel,
  onSuccess,
  onCancel,
}: ClinicalRecordFormProps) {
  const createRecord = useCreateClinicalRecord();
  const form = useForm<ClinicalRecordFormValues>({
    resolver: zodResolver(clinicalRecordFormSchema),
    mode: "onBlur",
    defaultValues: initialValues ?? {
      allergies: "",
      medications: "",
      clinicalNotes: "",
    },
  });

  const allergiesValue = form.watch("allergies") ?? "";
  const medicationsValue = form.watch("medications") ?? "";
  const clinicalNotesValue = form.watch("clinicalNotes") ?? "";

  async function onValid(values: ClinicalRecordFormValues) {
    const emptyToNull = (value: string) =>
      value.trim() === "" ? null : value.trim();
    try {
      await createRecord.mutateAsync({
        appointmentId,
        customerId,
        allergies: emptyToNull(values.allergies),
        medications: emptyToNull(values.medications),
        clinicalNotes: emptyToNull(values.clinicalNotes),
        supersedesId,
      });
      toast.success("Registro salvo.");
      onSuccess();
    } catch (error) {
      toast.error(mapClinicalRecordError(error));
    }
  }

  function fieldProps(
    name: "allergies" | "medications" | "clinicalNotes",
  ) {
    const state = form.getFieldState(name);
    return {
      ...form.register(name),
      "aria-invalid": state.invalid,
    };
  }

  /** Foco no 1º campo inválido ao submeter (a11y). */
  function onInvalidFocus() {
    const order = ["allergies", "medications", "clinicalNotes"] as const;
    const first = order.find((name) => form.getFieldState(name).invalid);
    const id =
      first === "clinicalNotes"
        ? "prontuario-clinical-notes"
        : `prontuario-${first}`;
    document.getElementById(id)?.focus();
  }

  return (
    <form
      onSubmit={form.handleSubmit(onValid, onInvalidFocus)}
      className="space-y-4"
    >
      <div className="space-y-1.5">
        <label htmlFor="prontuario-allergies" className="text-sm font-medium">
          Alergias
        </label>
        <Textarea
          id="prontuario-allergies"
          rows={2}
          maxLength={CLINICAL_FIELD_LIMITS.allergies}
          enterKeyHint="enter"
          aria-describedby="prontuario-allergies-count"
          className="text-base"
          placeholder="Ex.: penicilina, látex"
          {...fieldProps("allergies")}
        />
        <p
          id="prontuario-allergies-count"
          className="text-xs tabular-nums text-muted-foreground"
        >
          {allergiesValue.length}/{CLINICAL_FIELD_LIMITS.allergies}
        </p>
        {form.formState.errors.allergies ? (
          <p role="alert" className="text-sm text-destructive">
            {form.formState.errors.allergies.message}
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <label htmlFor="prontuario-medications" className="text-sm font-medium">
          Medicamentos
        </label>
        <Textarea
          id="prontuario-medications"
          rows={2}
          maxLength={CLINICAL_FIELD_LIMITS.medications}
          enterKeyHint="enter"
          aria-describedby="prontuario-medications-count"
          className="text-base"
          placeholder="Ex.: losartana 50mg pela manhã"
          {...fieldProps("medications")}
        />
        <p
          id="prontuario-medications-count"
          className="text-xs tabular-nums text-muted-foreground"
        >
          {medicationsValue.length}/{CLINICAL_FIELD_LIMITS.medications}
        </p>
        {form.formState.errors.medications ? (
          <p role="alert" className="text-sm text-destructive">
            {form.formState.errors.medications.message}
          </p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor="prontuario-clinical-notes"
          className="text-sm font-medium"
        >
          Observações do atendimento
        </label>
        <Textarea
          id="prontuario-clinical-notes"
          rows={4}
          maxLength={CLINICAL_FIELD_LIMITS.clinicalNotes}
          enterKeyHint="enter"
          aria-describedby="prontuario-clinical-notes-count"
          className="text-base"
          placeholder="Evolução, conduta, retorno…"
          {...fieldProps("clinicalNotes")}
        />
        <p
          id="prontuario-clinical-notes-count"
          className="text-xs tabular-nums text-muted-foreground"
        >
          {clinicalNotesValue.length}/{CLINICAL_FIELD_LIMITS.clinicalNotes}
        </p>
        {form.formState.errors.clinicalNotes ? (
          <p role="alert" className="text-sm text-destructive">
            {form.formState.errors.clinicalNotes.message}
          </p>
        ) : null}
      </div>

      <p className="text-xs text-muted-foreground">
        O registro é permanente: correções criam uma nova versão sem apagar a
        anterior.
      </p>

      <div className="flex gap-2">
        <Button type="submit" disabled={createRecord.isPending}>
          {createRecord.isPending ? (
            <>
              <Loader2 className="animate-spin" aria-hidden="true" />
              Salvando…
            </>
          ) : (
            submitLabel
          )}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

interface FichaAtualProps {
  record: ClinicalRecord | null;
  isLoading: boolean;
  canWrite: boolean;
  appointmentId: string;
  customerId: string;
}

/**
 * Ficha vigente: 3 grupos colapsáveis (`details/summary`) em leitura, com
 * rótulos `for/id`, contadores x/limite via `aria-describedby` e botão
 * "Corrigir (nova versão)" — correção é INSERT com `supersedes_id`, nunca
 * update; a v1 fica intacta e linkada na timeline.
 */
export function FichaAtual({
  record,
  isLoading,
  canWrite,
  appointmentId,
  customerId,
}: FichaAtualProps) {
  const [correcting, setCorrecting] = useState(false);

  if (isLoading) {
    return (
      <p
        className="rounded-md border border-border p-3 text-sm text-muted-foreground"
        aria-busy="true"
      >
        Carregando ficha…
      </p>
    );
  }

  if (!record) return null;

  const groups = [
    {
      key: "allergies",
      label: "Alergias",
      value: record.allergies,
      limit: CLINICAL_FIELD_LIMITS.allergies,
    },
    {
      key: "medications",
      label: "Medicamentos",
      value: record.medications,
      limit: CLINICAL_FIELD_LIMITS.medications,
    },
    {
      key: "clinicalNotes",
      label: "Observações do atendimento",
      value: record.clinical_notes,
      limit: CLINICAL_FIELD_LIMITS.clinicalNotes,
    },
  ] as const;

  return (
    <section aria-labelledby="ficha-atual-titulo" className="space-y-3">
      <h4 id="ficha-atual-titulo" className="text-sm font-semibold">
        Ficha atual
      </h4>

      {groups.map((group) => {
        const textId = `ficha-${group.key}-texto`;
        const countId = `ficha-${group.key}-count`;
        const shown = group.value ?? "—";
        return (
          <details
            key={group.key}
            className="rounded-md border border-border"
            open={group.key === "allergies"}
          >
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
              {group.label}
            </summary>
            <div className="space-y-1 px-3 pb-3">
              <label htmlFor={textId} className="sr-only">
                {group.label} (somente leitura)
              </label>
              <Textarea
                id={textId}
                value={shown}
                readOnly
                rows={2}
                aria-describedby={countId}
                className="text-base"
                tabIndex={-1}
              />
              <p
                id={countId}
                className="text-xs tabular-nums text-muted-foreground"
              >
                {group.value ? `${group.value.length}/${group.limit}` : "vazio"}
              </p>
            </div>
          </details>
        );
      })}

      {canWrite ? (
        correcting ? (
          <ClinicalRecordForm
            appointmentId={appointmentId}
            customerId={customerId}
            supersedesId={record.id}
            initialValues={{
              allergies: record.allergies ?? "",
              medications: record.medications ?? "",
              clinicalNotes: record.clinical_notes ?? "",
            }}
            submitLabel="Salvar nova versão"
            onSuccess={() => setCorrecting(false)}
            onCancel={() => setCorrecting(false)}
          />
        ) : (
          <Button
            type="button"
            variant="outline"
            onClick={() => setCorrecting(true)}
          >
            Corrigir (nova versão)
          </Button>
        )
      ) : null}
    </section>
  );
}
