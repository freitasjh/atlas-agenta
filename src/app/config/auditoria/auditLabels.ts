import type { UserAuditAction } from "@/hooks/useUserAuditLog";

/** Rótulos pt-BR das ações de auditoria de usuários (ADR-006). */
export const USER_AUDIT_ACTION_LABELS: Record<UserAuditAction, string> = {
  "invitation.created": "Convite enviado",
  "invitation.accepted": "Convite aceito",
  "invitation.revoked": "Convite revogado",
  "invitation.resent": "Convite reenviado",
  "user.role_changed": "Papel alterado",
  "user.deactivated": "Usuário desativado",
  "user.reactivated": "Usuário reativado",
  "professional.linked": "Profissional vinculado",
  "professional.unlinked": "Profissional desvinculado",
};

export function userAuditActionLabel(action: string): string {
  return (
    (USER_AUDIT_ACTION_LABELS as Record<string, string>)[action] ?? action
  );
}
