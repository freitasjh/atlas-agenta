import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";

import { StatePanel } from "@/components/StatePanel";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  CLINICAL_FIELD_LIMITS,
  clinicalRecordFormSchema,
  type ClinicalRecordFormValues,
} from "@/app/agenda/prontuario/types";
import {
  mapClinicalRecordError,
  useCreateClinicalRecord,
} from "@/app/agenda/prontuario/useClinicalRecords";

/**
 * Wizard da primeira ficha (anamnese) — 3 passos locais no Drawer, INSERT
 * único via `useCreateClinicalRecord` (append-only, `supersedes_id` nulo).
 * Sem backend novo; rascunho em `localStorage` (minimização LGPD: só o
 * atendimento corrente, descarte explícito, sem PII em log/toast).
 */

const DRAFT_PREFIX = "anamnese-rascunho:";

export function draftKey(appointmentId: string): string {
  return `${DRAFT_PREFIX}${appointmentId}`;
}

type DraftValues = ClinicalRecordFormValues;

type DraftStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * Rascunho local: `localStorage` no navegador; queda para `sessionStorage`
 * (ex.: happy-dom de teste) e nulo quando indisponível. Nunca loga conteúdo.
 */
function draftStore(): DraftStore | null {
  try {
    if (typeof localStorage !== "undefined") return localStorage;
  } catch {
    /* armazenamento indisponível: tenta o próximo */
  }
  try {
    if (typeof sessionStorage !== "undefined") return sessionStorage;
  } catch {
    /* armazenamento indisponível: segue sem rascunho */
  }
  return null;
}

function loadDraft(appointmentId: string): DraftValues | null {
  const store = draftStore();
  if (store === null) return null;
  try {
    const raw = store.getItem(draftKey(appointmentId));
    if (raw === null) return null;
    const parsed = z
      .object({
        allergies: z.string().catch(""),
        medications: z.string().catch(""),
        clinicalNotes: z.string().catch(""),
      })
      .safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

const anamneseSchema = clinicalRecordFormSchema.and(
  z.object({
    consent: z.literal(true, {
      errorMap: () => ({
        message: "Confirme o consentimento para salvar a ficha.",
      }),
    }),
  }),
);

type AnamneseValues = ClinicalRecordFormValues & { consent: boolean };

const STEP_LABELS = [
  "Quem",
  "Histórico e contraindicações",
  "Revisão e consentimento",
] as const;

type StepIndex = 0 | 1 | 2;

type FieldName = "allergies" | "medications" | "clinicalNotes";

const FIELD_IDS: Record<FieldName, string> = {
  allergies: "anamnese-allergies",
  medications: "anamnese-medications",
  clinicalNotes: "anamnese-clinical-notes",
};

const FIELD_LABELS: Record<FieldName, string> = {
  allergies: "Alergias",
  medications: "Medicamentos",
  clinicalNotes: "Observações do atendimento",
};

interface AnamneseWizardProps {
  appointmentId: string;
  customerId: string;
}

export function AnamneseWizard({
  appointmentId,
  customerId,
}: AnamneseWizardProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<StepIndex>(0);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const pendingFocusRef = useRef<string | null>(null);
  const createRecord = useCreateClinicalRecord();
  const storageKey = draftKey(appointmentId);

  const form = useForm<AnamneseValues>({
    resolver: zodResolver(anamneseSchema),
    mode: "onBlur",
    reValidateMode: "onChange",
    defaultValues: {
      ...(loadDraft(appointmentId) ?? {
        allergies: "",
        medications: "",
        clinicalNotes: "",
      }),
      consent: false,
    },
  });

  const allergiesValue = form.watch("allergies") ?? "";
  const medicationsValue = form.watch("medications") ?? "";
  const clinicalNotesValue = form.watch("clinicalNotes") ?? "";

  /** Autosave do rascunho (só campos clínicos; consentimento não persiste). */
  useEffect(() => {
    const store = draftStore();
    if (store === null) return;
    try {
      const draft: DraftValues = {
        allergies: allergiesValue,
        medications: medicationsValue,
        clinicalNotes: clinicalNotesValue,
      };
      if (
        draft.allergies !== "" ||
        draft.medications !== "" ||
        draft.clinicalNotes !== ""
      ) {
        store.setItem(storageKey, JSON.stringify(draft));
      } else {
        store.removeItem(storageKey);
      }
    } catch {
      /* sem armazenamento: segue sem rascunho */
    }
  }, [allergiesValue, medicationsValue, clinicalNotesValue, storageKey]);

  /** Foco no heading a cada transição; submit inválido foca o campo alvo. */
  useEffect(() => {
    if (!open) return;
    if (pendingFocusRef.current !== null) {
      document.getElementById(pendingFocusRef.current)?.focus();
      pendingFocusRef.current = null;
    } else {
      headingRef.current?.focus();
    }
  }, [open, step]);

  /** Erro visível: campo editado ou após submit (nunca por keystroke virgem). */
  function visibleError(name: keyof AnamneseValues): string | null {
    const error = form.formState.errors[name];
    if (!error?.message) return null;
    if (form.formState.dirtyFields[name] === true) return error.message;
    if (form.formState.isSubmitted) return error.message;
    return null;
  }

  function fieldId(name: FieldName | "consent"): string {
    return name === "consent" ? "anamnese-consent" : FIELD_IDS[name];
  }

  /** Foco no 1º campo inválido (ordem do formulário; troca de passo). */
  function focusFirstInvalid(): void {
    const order: Array<FieldName | "consent"> = [
      "allergies",
      "medications",
      "clinicalNotes",
      "consent",
    ];
    const first = order.find(
      (name) => form.getFieldState(name).invalid === true,
    );
    if (first === undefined) return;
    const targetStep: StepIndex =
      first === "allergies" ? 0 : first === "consent" ? 2 : 1;
    if (targetStep !== step) {
      pendingFocusRef.current = fieldId(first);
      setStep(targetStep);
    } else {
      document.getElementById(fieldId(first))?.focus();
    }
  }

  /**
   * Avanço de passo: valida só limites dos campos do passo (a regra de
   * mínimo 1 campo é do submit final, para não travar a navegação).
   */
  function goNext(): void {
    const names: readonly FieldName[] =
      step === 0 ? ["allergies"] : ["medications", "clinicalNotes"];
    let firstBad: string | null = null;
    for (const name of names) {
      const value = form.getValues(name) ?? "";
      const limit = CLINICAL_FIELD_LIMITS[name];
      if (value.length > limit) {
        form.setError(name, {
          type: "maxLength",
          message: `${FIELD_LABELS[name]}: máximo de ${limit} caracteres.`,
        });
        form.setValue(name, value, { shouldDirty: true });
        firstBad ??= fieldId(name);
      } else {
        form.clearErrors(name);
      }
    }
    if (firstBad !== null) {
      document.getElementById(firstBad)?.focus();
      return;
    }
    setConfirmingDiscard(false);
    setStep((step + 1) as StepIndex);
  }

  function goBack(): void {
    setConfirmingDiscard(false);
    setStep((step - 1) as StepIndex);
  }

  function discardDraft(): void {
    if (!confirmingDiscard) {
      setConfirmingDiscard(true);
      return;
    }
    try {
      draftStore()?.removeItem(storageKey);
    } catch {
      /* sem armazenamento: nada a remover */
    }
    form.reset({
      allergies: "",
      medications: "",
      clinicalNotes: "",
      consent: false,
    });
    setConfirmingDiscard(false);
    setStep(0);
  }

  async function onValid(values: AnamneseValues): Promise<void> {
    const emptyToNull = (value: string) =>
      value.trim() === "" ? null : value.trim();
    try {
      await createRecord.mutateAsync({
        appointmentId,
        customerId,
        allergies: emptyToNull(values.allergies),
        medications: emptyToNull(values.medications),
        clinicalNotes: emptyToNull(values.clinicalNotes),
        supersedesId: null,
      });
      try {
        draftStore()?.removeItem(storageKey);
      } catch {
        /* rascunho já inexistente: segue */
      }
      toast.success("Registro salvo.");
      setOpen(false);
    } catch (error) {
      toast.error(mapClinicalRecordError(error));
    }
  }

  function renderField(name: FieldName, enterKeyHint: "next" | "done") {
    const errorMessage = visibleError(name);
    const describedBy =
      `${FIELD_IDS[name]}-count${errorMessage !== null ? ` ${FIELD_IDS[name]}-erro` : ""}`;
    const value =
      name === "allergies"
        ? allergiesValue
        : name === "medications"
          ? medicationsValue
          : clinicalNotesValue;
    const registration = form.register(name);
    return (
      <div className="space-y-1.5">
        <label htmlFor={FIELD_IDS[name]} className="text-sm font-medium">
          {FIELD_LABELS[name]}
        </label>
        <Textarea
          id={FIELD_IDS[name]}
          rows={name === "clinicalNotes" ? 4 : 2}
          maxLength={CLINICAL_FIELD_LIMITS[name]}
          enterKeyHint={enterKeyHint}
          aria-describedby={describedBy}
          aria-invalid={errorMessage !== null}
          className="text-base"
          placeholder={
            name === "allergies"
              ? "Ex.: penicilina, látex"
              : name === "medications"
                ? "Ex.: losartana 50mg pela manhã"
                : "Evolução, conduta, retorno…"
          }
          {...registration}
          onChange={(event) => {
            void registration.onChange(event);
            // Limpa no input (nunca valida por keystroke): o erro volta
            // a aparecer no próximo blur/submit, se ainda inválido.
            if (
              event.target.value.length <= CLINICAL_FIELD_LIMITS[name]
            ) {
              form.clearErrors(name);
            }
          }}
        />
        <p
          id={`${FIELD_IDS[name]}-count`}
          className="text-xs tabular-nums text-muted-foreground"
        >
          {value.length}/{CLINICAL_FIELD_LIMITS[name]}
        </p>
        {errorMessage !== null ? (
          <p
            id={`${FIELD_IDS[name]}-erro`}
            role="alert"
            className="text-sm text-destructive"
          >
            {errorMessage}
          </p>
        ) : null}
      </div>
    );
  }

  if (!open) {
    return (
      <StatePanel
        titulo="Ficha não criada"
        descricao="Este atendimento ainda não tem ficha clínica. Crie a primeira ficha com o assistente guiado."
      >
        <Button type="button" onClick={() => setOpen(true)}>
          {loadDraft(appointmentId) !== null
            ? "Continuar ficha (rascunho salvo)"
            : "Criar primeira ficha"}
        </Button>
      </StatePanel>
    );
  }

  const consentError = visibleError("consent");

  return (
    <section aria-label="Assistente de anamnese" className="space-y-4">
      <ol aria-label="Progresso da anamnese" className="flex gap-2 text-xs">
        {STEP_LABELS.map((label, index) => (
          <li
            key={label}
            aria-current={index === step ? "step" : undefined}
            className={
              index === step
                ? "font-semibold text-foreground underline underline-offset-4"
                : "text-muted-foreground"
            }
          >
            {index + 1}. {label}
          </li>
        ))}
      </ol>

      <form
        onSubmit={form.handleSubmit(onValid, focusFirstInvalid)}
        className="space-y-4"
      >
      <div hidden={step !== 0}>
        <h2
          id="anamnese-titulo"
          ref={step === 0 ? headingRef : undefined}
          tabIndex={-1}
          className="text-base font-semibold outline-none"
        >
          Quem
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Passo 1 de 3 — registre alergias e contraindicações conhecidas.
        </p>
        <div className="mt-4">{renderField("allergies", "next")}</div>
      </div>

      <div hidden={step !== 1}>
        <h2
          ref={step === 1 ? headingRef : undefined}
          tabIndex={-1}
          className="text-base font-semibold outline-none"
        >
          Histórico e contraindicações
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Passo 2 de 3 — medicamentos em uso e observações do atendimento.
        </p>
        <div className="mt-4 space-y-4">
          {renderField("medications", "next")}
          {renderField("clinicalNotes", "next")}
        </div>
      </div>

      <div hidden={step !== 2}>
        <h2
          ref={step === 2 ? headingRef : undefined}
          tabIndex={-1}
          className="text-base font-semibold outline-none"
        >
          Revisão e consentimento
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Passo 3 de 3 — confira os dados antes de salvar a primeira ficha.
        </p>
        <dl className="mt-4 space-y-2 rounded-md border border-border p-3 text-sm">
          {(Object.keys(FIELD_LABELS) as FieldName[]).map((name) => {
            const value = form.getValues(name).trim();
            return (
              <div key={name}>
                <dt className="font-medium">{FIELD_LABELS[name]}</dt>
                <dd className="text-muted-foreground">
                  {value === "" ? "—" : value}
                </dd>
              </div>
            );
          })}
        </dl>
        <div className="mt-4 space-y-1.5">
          <div className="flex items-start gap-2">
            <Checkbox
              id="anamnese-consent"
              checked={form.watch("consent")}
              onCheckedChange={(checked) =>
                form.setValue("consent", checked === true, {
                  shouldDirty: true,
                  shouldValidate: true,
                })
              }
              aria-invalid={consentError !== null}
              aria-describedby={
                consentError !== null ? "anamnese-consent-erro" : undefined
              }
            />
            <label htmlFor="anamnese-consent" className="text-sm font-medium">
              Confirmo que conferi os dados e que o cliente consentiu com este
              registro.
            </label>
          </div>
          {consentError !== null ? (
            <p
              id="anamnese-consent-erro"
              role="alert"
              className="text-sm text-destructive"
            >
              {consentError}
            </p>
          ) : null}
        </div>
      </div>

        <div className="flex flex-wrap gap-2">
          {step > 0 ? (
            <Button type="button" variant="outline" onClick={goBack}>
              Voltar
            </Button>
          ) : null}
          {step < 2 ? (
            <Button type="button" onClick={goNext}>
              Continuar
            </Button>
          ) : (
            <Button type="submit" disabled={createRecord.isPending}>
              {createRecord.isPending ? (
                <>
                  <Loader2 className="animate-spin" aria-hidden="true" />
                  Salvando…
                </>
              ) : (
                "Salvar ficha"
              )}
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            onClick={() => setOpen(false)}
          >
            Fechar
          </Button>
          <Button type="button" variant="ghost" onClick={discardDraft}>
            {confirmingDiscard ? "Confirmar descarte" : "Descartar rascunho"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          O rascunho fica salvo neste dispositivo até o descarte. O registro é
          permanente: correções criam uma nova versão sem apagar a anterior.
        </p>
      </form>
    </section>
  );
}
