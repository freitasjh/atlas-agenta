import { describe, expect, it } from "vitest";

import { TROCAR_SENHA_COPY } from "@/auth/TrocarSenhaPage";

/**
 * Contrato de cópia da tela de troca de senha (ADR-10, critério 1/3).
 *
 * Sem DOM: os textos vivem no mapa exportado `TROCAR_SENHA_COPY` e a tela
 * renderiza exatamente dele. O teste trava as strings pt-BR exigidas pelo PRD
 * para que uma edição acidental não troque o tema nem introduza inglês.
 */
describe("TrocarSenhaPage — textos pt-BR", () => {
  it("selo do primeiro acesso", () => {
    expect(TROCAR_SENHA_COPY.firstAccessBadge).toBe("Primeiro acesso");
  });

  it("título e descrição", () => {
    expect(TROCAR_SENHA_COPY.title).toBe("Crie sua nova senha");
    expect(TROCAR_SENHA_COPY.description).toBe(
      "Sua senha atual é provisória. Defina uma senha só sua para entrar no painel.",
    );
  });

  it("rótulos dos campos e dica de tamanho mínimo", () => {
    expect(TROCAR_SENHA_COPY.passwordLabel).toBe("Nova senha");
    expect(TROCAR_SENHA_COPY.confirmPasswordLabel).toBe("Confirmar nova senha");
    expect(TROCAR_SENHA_COPY.passwordHint).toBe("Use ao menos 8 caracteres.");
  });

  it("rótulo acessível da conta exibida", () => {
    expect(TROCAR_SENHA_COPY.accountLabel).toBe("Conta:");
  });

  it("botão e anúncio de progresso", () => {
    expect(TROCAR_SENHA_COPY.submit).toBe("Salvar nova senha");
    expect(TROCAR_SENHA_COPY.submitting).toBe("Salvando…");
    expect(TROCAR_SENHA_COPY.submittingAnnouncement).toBe("Salvando nova senha");
  });

  it("saída e mensagens de desfecho", () => {
    expect(TROCAR_SENHA_COPY.success).toBe("Senha salva. Painel liberado.");
    expect(TROCAR_SENHA_COPY.reloginWarning).toBe(
      "Senha salva. Entre com a nova senha.",
    );
    expect(TROCAR_SENHA_COPY.loginLink).toBe("Ir para o login");
  });

  it("não duplica o rótulo do botão de saída (vem do SignOutButton)", () => {
    expect(Object.keys(TROCAR_SENHA_COPY)).not.toContain("signOut");
  });

  it("nenhum texto vazio", () => {
    for (const [key, value] of Object.entries(TROCAR_SENHA_COPY)) {
      expect(value.trim(), key).not.toBe("");
    }
  });
});
