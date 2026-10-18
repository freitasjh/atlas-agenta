import { useCurrentUser } from "@/hooks/useCurrentUser";

/**
 * Capacidades de RBAC derivadas do `role` já resolvido sob RLS (nunca enviado
 * pelo cliente). As telas consultam capacidades, não `role` cru, para manter a
 * regra RBAC num só lugar. É **defesa em profundidade** — esconde botões de
 * escrita; a trava real é o RLS no banco.
 *
 * Mapa (PRD §5):
 *   admin        -> gerencia catálogo e qualquer grade.
 *   professional -> lê o catálogo; edita apenas a própria grade (via profile_id).
 *   receptionist -> só leitura.
 */
export interface Permissions {
  /** Criar/editar/inativar serviços, profissionais e vínculos N:N (admin). */
  canManageCatalog: boolean;
  /** Editar a grade de qualquer profissional (admin). */
  canEditAnySchedule: boolean;
  /** Editar a própria grade (admin ou professional). */
  canEditOwnSchedule: boolean;
  /** Papel sem nenhuma escrita de catálogo (receptionist). */
  isReadOnly: boolean;
  isAdmin: boolean;
  isProfessional: boolean;
}

export function usePermissions(): Permissions {
  const { role } = useCurrentUser();

  const isAdmin = role === "admin";
  const isProfessional = role === "professional";

  return {
    canManageCatalog: isAdmin,
    canEditAnySchedule: isAdmin,
    canEditOwnSchedule: isAdmin || isProfessional,
    isReadOnly: role === "receptionist",
    isAdmin,
    isProfessional,
  };
}
