// Constantes e decisão pura do bootstrap do super admin (ADR-07).
// Compartilhado pelo script de operador `scripts/bootstrap-super-admin.ts` e pela Edge Function
// `change-password` (ADR-08), que compara a senha nova com a provisória sem copiar o literal.
// Este arquivo não entra no bundle do frontend: o `src/` não o importa (RQ-13).

export const SUPER_ADMIN_EMAIL = "admin@neox.com.br";

// Marcador gravado só em app_metadata pelo servidor (Admin API). O trigger handle_new_user (ADR-06)
// o lê. Metadado de usuário é editável pelo próprio usuário, por isso nunca serve de marcador.
export const BOOTSTRAP_ROLE_KEY = "bootstrap_role";
export const BOOTSTRAP_ROLE_VALUE = "super_admin";

// Senha provisória fixa até o beta. Precisa ser trocada antes do beta, por senha por ambiente. Ver PRD D-07 e RQ-06.
export const PROVISIONAL_PASSWORD = "AtlasAgenda@123";

// Estado lido antes da criação. `exists: false` significa que o e-mail do super admin não existe.
export type BootstrapState =
  | { exists: false }
  | { exists: true; profileRole: string | null; tenantId: string | null };

// `criado`: o usuário não existe e deve ser criado.
// `ja_existe`: é o super admin sem tenant. Não mexe em senha nem em dados.
// `recusa_papel`: o e-mail já existe com outro papel ou sem profile. Nada é alterado.
export type BootstrapAction = "criado" | "ja_existe" | "recusa_papel";

export function decideBootstrapAction(state: BootstrapState): BootstrapAction {
  if (!state.exists) return "criado";
  if (state.profileRole === "super_admin" && state.tenantId === null) return "ja_existe";
  return "recusa_papel";
}
