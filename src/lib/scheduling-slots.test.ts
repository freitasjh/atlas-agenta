import { describe, expect, it } from "vitest";

import {
  generateAvailableSlots,
  type GenerateAvailableSlotsInput,
} from "@/lib/scheduling-slots";
import type { ScheduleOverride, WorkingHour } from "@/types/domain";

/**
 * Cobertura do gerador puro de slots (ADR-05 agenda). Casos derivados dos
 * critérios de aceite AC-09..AC-17 + edição. Determinístico via `nowUtc`
 * injetado bem no passado, salvo nos testes que exercitam o corte de passado.
 */

const TZ = "America/Sao_Paulo";
// Instante bem anterior a qualquer dia de teste (2025) — neutraliza o corte de
// passado nos casos que não o exercitam.
const PAST = new Date("2000-01-01T00:00:00.000Z");

function workingHour(partial: Partial<WorkingHour>): WorkingHour {
  return {
    id: "wh",
    tenant_id: "t",
    professional_id: "p",
    weekday: 1,
    start_time: "09:00",
    end_time: "12:00",
    break_start: null,
    break_end: null,
    created_at: "2025-01-01T00:00:00.000Z",
    ...partial,
  };
}

function override(partial: Partial<ScheduleOverride>): ScheduleOverride {
  return {
    id: "o",
    tenant_id: "t",
    professional_id: "p",
    override_date: "2025-03-10",
    is_closed: false,
    start_time: null,
    end_time: null,
    break_start: null,
    break_end: null,
    reason: null,
    created_at: "2025-01-01T00:00:00.000Z",
    ...partial,
  };
}

function baseInput(
  partial: Partial<GenerateAvailableSlotsInput>,
): GenerateAvailableSlotsInput {
  return {
    day: "2025-03-10", // segunda-feira (weekday 1)
    timeZone: TZ,
    durationMinutes: 60,
    slotStepMinutes: 30,
    scheduleStartDate: null,
    scheduleEndDate: null,
    workingHours: [workingHour({ weekday: 1 })],
    override: null,
    busy: [],
    nowUtc: PAST,
    ...partial,
  };
}

describe("generateAvailableSlots", () => {
  it("AC-09: slots dentro da janela da grade, descontando o break", () => {
    const slots = generateAvailableSlots(
      baseInput({
        workingHours: [
          workingHour({
            start_time: "09:00",
            end_time: "12:00",
            break_start: "10:00",
            break_end: "11:00",
          }),
        ],
        durationMinutes: 60,
        slotStepMinutes: 30,
      }),
    );
    // Janela 09-12, duração 60, passo 30. 09:00 ok; 09:30 cruza break; 10:00
    // dentro do break; 10:30 cruza break; 11:00 ok (termina 12:00).
    expect(slots.map((s) => s.label)).toEqual(["09:00", "11:00"]);
  });

  it("AC-10: exceção fechada → nenhum slot, mesmo com grade no weekday", () => {
    const slots = generateAvailableSlots(
      baseInput({
        override: override({ is_closed: true }),
      }),
    );
    expect(slots).toHaveLength(0);
  });

  it("AC-11: exceção aberta → slots seguem a janela da exceção, não a grade", () => {
    const slots = generateAvailableSlots(
      baseInput({
        workingHours: [workingHour({ start_time: "09:00", end_time: "12:00" })],
        override: override({
          is_closed: false,
          start_time: "14:00",
          end_time: "16:00",
        }),
        durationMinutes: 60,
        slotStepMinutes: 60,
      }),
    );
    expect(slots.map((s) => s.label)).toEqual(["14:00", "15:00"]);
  });

  it("AC-12: fora da vigência → nenhum slot; dentro → há", () => {
    const fora = generateAvailableSlots(
      baseInput({
        scheduleStartDate: "2025-04-01",
        scheduleEndDate: "2025-04-30",
      }),
    );
    expect(fora).toHaveLength(0);

    const dentro = generateAvailableSlots(
      baseInput({
        scheduleStartDate: "2025-03-01",
        scheduleEndDate: "2025-03-31",
      }),
    );
    expect(dentro.length).toBeGreaterThan(0);
  });

  it("AC-13: bloco que sobrepõe ocupado ativo não é ofertado", () => {
    // Ocupado 09:00-10:00 (local BRT = 12:00-13:00 UTC). Janela 09-12.
    const slots = generateAvailableSlots(
      baseInput({
        busy: [
          {
            startsAt: "2025-03-10T12:00:00.000Z",
            endsAt: "2025-03-10T13:00:00.000Z",
          },
        ],
        durationMinutes: 60,
        slotStepMinutes: 60,
      }),
    );
    // 09:00 colide; 10:00 colide (09:30-10:30 na verdade — com passo 60: 09:00,
    // 10:00, 11:00). 09:00 colide com 09-10; 10:00 ok; 11:00 ok.
    expect(slots.map((s) => s.label)).toEqual(["10:00", "11:00"]);
  });

  it("AC-13: cancelado/nao_compareceu não devem bloquear (não entram em busy)", () => {
    // O chamador não passa cancelados em `busy`; aqui confirmamos que sem busy
    // o slot volta a ser ofertado.
    const slots = generateAvailableSlots(
      baseInput({ busy: [], durationMinutes: 60, slotStepMinutes: 60 }),
    );
    expect(slots.map((s) => s.label)).toEqual(["09:00", "10:00", "11:00"]);
  });

  it("AC-14: serviço de 2h oferta menos opções que o de 1h", () => {
    const umaHora = generateAvailableSlots(
      baseInput({ durationMinutes: 60, slotStepMinutes: 60 }),
    );
    const duasHoras = generateAvailableSlots(
      baseInput({ durationMinutes: 120, slotStepMinutes: 60 }),
    );
    expect(umaHora.map((s) => s.label)).toEqual(["09:00", "10:00", "11:00"]);
    // Janela 09-12: só 09:00 e 10:00 cabem um bloco de 2h.
    expect(duasHoras.map((s) => s.label)).toEqual(["09:00", "10:00"]);
    expect(duasHoras.length).toBeLessThan(umaHora.length);
  });

  it("AC-15: inícios andam de slot_step_minutes a partir do começo da janela", () => {
    const slots = generateAvailableSlots(
      baseInput({ durationMinutes: 30, slotStepMinutes: 15 }),
    );
    expect(slots.slice(0, 3).map((s) => s.label)).toEqual([
      "09:00",
      "09:15",
      "09:30",
    ]);
  });

  it("AC-16: fuso do tenant respeitado (09:00 local = 09:00 no rótulo)", () => {
    const slots = generateAvailableSlots(
      baseInput({ durationMinutes: 60, slotStepMinutes: 60 }),
    );
    expect(slots[0]?.label).toBe("09:00");
    // 09:00 BRT (UTC-3) = 12:00 UTC.
    expect(slots[0]?.startUtc).toBe("2025-03-10T12:00:00.000Z");
  });

  it("AC-17: horários no passado são omitidos no dia corrente", () => {
    // "Agora" = 10:00 BRT (13:00 UTC). 09:00 e parte do dia já passaram.
    const now = new Date("2025-03-10T13:00:00.000Z");
    const slots = generateAvailableSlots(
      baseInput({
        durationMinutes: 60,
        slotStepMinutes: 60,
        nowUtc: now,
      }),
    );
    // 09:00 passou; 10:00 == agora (não é passado, ofertável); 11:00 ok.
    expect(slots.map((s) => s.label)).toEqual(["10:00", "11:00"]);
  });

  it("múltiplas faixas no mesmo weekday viram união sem duplicar inícios", () => {
    const slots = generateAvailableSlots(
      baseInput({
        workingHours: [
          workingHour({ start_time: "09:00", end_time: "11:00" }),
          workingHour({ start_time: "14:00", end_time: "16:00" }),
          // faixa sobreposta à primeira — não deve duplicar o 09:00.
          workingHour({ start_time: "09:00", end_time: "10:00" }),
        ],
        durationMinutes: 60,
        slotStepMinutes: 60,
      }),
    );
    expect(slots.map((s) => s.label)).toEqual([
      "09:00",
      "10:00",
      "14:00",
      "15:00",
    ]);
  });

  it("duração maior que a janela → lista vazia (vazio honesto)", () => {
    const slots = generateAvailableSlots(
      baseInput({
        workingHours: [workingHour({ start_time: "09:00", end_time: "10:00" })],
        durationMinutes: 120,
      }),
    );
    expect(slots).toHaveLength(0);
  });

  it("profissional sem grade no dia → vazio", () => {
    const slots = generateAvailableSlots(baseInput({ workingHours: [] }));
    expect(slots).toHaveLength(0);
  });

  it("edição: o próprio agendamento não é descontado (o chamador o exclui de busy)", () => {
    // Sem o ocupante do próprio appointment em `busy`, o slot continua ofertado.
    const comOcupado = generateAvailableSlots(
      baseInput({
        busy: [
          {
            startsAt: "2025-03-10T12:00:00.000Z",
            endsAt: "2025-03-10T13:00:00.000Z",
          },
        ],
        durationMinutes: 60,
        slotStepMinutes: 60,
      }),
    );
    const semOcupado = generateAvailableSlots(
      baseInput({ busy: [], durationMinutes: 60, slotStepMinutes: 60 }),
    );
    expect(comOcupado.map((s) => s.label)).toEqual(["10:00", "11:00"]);
    expect(semOcupado.map((s) => s.label)).toEqual(["09:00", "10:00", "11:00"]);
  });

  it("DST: slots no fuso do tenant permanecem no horário de parede correto", () => {
    // 2025-02-15 — America/Sao_Paulo não tem mais DST desde 2019, então o
    // offset é estável (-03:00). O teste garante que a conversão de parede para
    // UTC é consistente num mês diferente.
    const slots = generateAvailableSlots(
      baseInput({
        day: "2025-02-17", // segunda-feira
        durationMinutes: 60,
        slotStepMinutes: 60,
      }),
    );
    expect(slots[0]?.label).toBe("09:00");
    expect(slots[0]?.startUtc).toBe("2025-02-17T12:00:00.000Z");
  });
});
