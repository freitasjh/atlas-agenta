/** Rótulos pt-BR dos papéis do tenant (ADR-004). Fonte única. */
export const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super admin",
  admin: "Administrador",
  professional: "Profissional",
  receptionist: "Recepção",
};

/** Papéis atribuíveis a membros do tenant (exclui super_admin). */
export const TENANT_ROLES = ["admin", "professional", "receptionist"] as const;

export type TenantRole = (typeof TENANT_ROLES)[number];