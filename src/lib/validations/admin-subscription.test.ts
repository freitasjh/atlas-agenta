import { describe, expect, it } from "vitest";

import {
  adminTenantRowSchema,
  adminTenantsResponseSchema,
  changeStatusFormSchema,
  changeStatusResponseSchema,
} from "@/lib/validations/admin-subscription";

/**
 * AC-04.3: trava os schemas zod do contrato admin-subscription. Dado não
 * confiável (form + respostas de PostgREST/Edge Function) validado na borda;
 * mensagens de usuário em pt-BR.
 */

const VALID_ROW = {
  id: "11111111-1111-1111-1111-111111111111",
  trade_name: "Studio Alfa",
  legal_name: "Alfa Serviços LTDA",
  document: "12345678000190",
  owner_email: "dono@alfa.com",
  plan: "clinica",
  subscription_status: "ativo",
  trial_ends_at: null,
  timezone: "America/Sao_Paulo",
  created_at: "2025-01-01T00:00:00.000Z",
};

describe("changeStatusFormSchema (AC-04.3)", () => {
  it("reason com 281 chars falha com a mensagem pt-BR", () => {
    const result = changeStatusFormSchema.safeParse({
      status: "ativo",
      reason: "a".repeat(281),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        "O motivo deve ter no máximo 280 caracteres.",
      );
    }
  });

  it("reason ausente passa", () => {
    const result = changeStatusFormSchema.safeParse({ status: "bloqueado" });
    expect(result.success).toBe(true);
  });

  it("reason exatamente 280 (após trim) passa", () => {
    const result = changeStatusFormSchema.safeParse({
      status: "ativo",
      reason: `  ${"a".repeat(280)}  `,
    });
    expect(result.success).toBe(true);
  });

  it("status fora do enum falha", () => {
    const result = changeStatusFormSchema.safeParse({ status: "arquivado" });
    expect(result.success).toBe(false);
  });
});

describe("adminTenantRowSchema / adminTenantsResponseSchema", () => {
  it("linha válida passa e infere os enums de domínio", () => {
    expect(adminTenantRowSchema.safeParse(VALID_ROW).success).toBe(true);
    expect(adminTenantsResponseSchema.safeParse([VALID_ROW]).success).toBe(
      true,
    );
  });

  it("trial_ends_at e campos nullable aceitam null", () => {
    const row = { ...VALID_ROW, trade_name: null, document: null };
    expect(adminTenantRowSchema.safeParse(row).success).toBe(true);
  });

  it("plan ou subscription_status fora do enum falha", () => {
    expect(
      adminTenantRowSchema.safeParse({ ...VALID_ROW, plan: "enterprise" })
        .success,
    ).toBe(false);
    expect(
      adminTenantRowSchema.safeParse({
        ...VALID_ROW,
        subscription_status: "suspenso",
      }).success,
    ).toBe(false);
  });

  it("id não-uuid falha", () => {
    expect(
      adminTenantRowSchema.safeParse({ ...VALID_ROW, id: "nao-uuid" }).success,
    ).toBe(false);
  });
});

describe("changeStatusResponseSchema", () => {
  it("DTO de sucesso válido passa", () => {
    const dto = {
      ok: true,
      tenant_id: "11111111-1111-1111-1111-111111111111",
      old_status: "trial",
      new_status: "ativo",
    };
    expect(changeStatusResponseSchema.safeParse(dto).success).toBe(true);
  });

  it("ok diferente de true (literal) falha", () => {
    const dto = {
      ok: false,
      tenant_id: "11111111-1111-1111-1111-111111111111",
      old_status: "trial",
      new_status: "ativo",
    };
    expect(changeStatusResponseSchema.safeParse(dto).success).toBe(false);
  });

  it("new_status fora do enum falha", () => {
    const dto = {
      ok: true,
      tenant_id: "11111111-1111-1111-1111-111111111111",
      old_status: "ativo",
      new_status: "zumbi",
    };
    expect(changeStatusResponseSchema.safeParse(dto).success).toBe(false);
  });
});
