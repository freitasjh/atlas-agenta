import { describe, expect, it } from "vitest";
import { mapWhatsAppError } from "./whatsapp-errors";

describe("mapWhatsAppError", () => {
  it("sessão expirada → mensagem de auth", () => {
    expect(mapWhatsAppError({ error: "Não autorizado (401: jwt expired)." })).toBe(
      "Sua sessão expirou. Entre novamente.",
    );
  });

  it("403/forbidden → mensagem de permissão", () => {
    expect(
      mapWhatsAppError({ error: "Você não tem permissão para parear o WhatsApp." }),
    ).toBe("Sem permissão para esta ação.");
  });

  it("instância ausente no servidor → mensagem específica da Edge Function (pt-BR controlado)", () => {
    expect(
      mapWhatsAppError({
        error: "A instância do WhatsApp não existe no servidor de WhatsApp.",
      }),
    ).toBe("A instância do WhatsApp não existe no servidor de WhatsApp.");
  });

  it("QR indisponível → mensagem específica da Edge Function", () => {
    expect(
      mapWhatsAppError({ error: "Não foi possível gerar o QR Code da conexão." }),
    ).toBe("Não foi possível gerar o QR Code da conexão.");
  });

  it("já conectado → mensagem específica da Edge Function", () => {
    expect(mapWhatsAppError({ error: "O WhatsApp já está conectado." })).toBe(
      "O WhatsApp já está conectado.",
    );
  });

  it("erro desconhecido → fallback genérico", () => {
    expect(mapWhatsAppError({ error: "Falha interna." })).toBe(
      "Não foi possível concluir a ação. Tente novamente.",
    );
  });

  it("shape inesperado (sem texto) → fallback genérico", () => {
    expect(mapWhatsAppError(null)).toBe(
      "Não foi possível concluir a ação. Tente novamente.",
    );
    expect(mapWhatsAppError({ issues: [] })).toBe(
      "Não foi possível concluir a ação. Tente novamente.",
    );
  });
});
