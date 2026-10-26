import { useCurrentUser } from "@/hooks/useCurrentUser";

/**
 * Capacidades de RBAC derivadas do `role` já resolvido sob RLS (nunca enviado
 * pelo cliente). As telas consultam capacidades, não `role` cru, para manter a
 * regra RBAC num só lugar. É **defesa em profundidade** — esconde botões de
 * escrita; a trava real é o RLS no banco.
 *
 * Mapa (PRD §5):
 *   admin        -> gerencia catálogo, qualquer grade, clientes e agenda de todos.
 *   professional -> lê o catálogo; edita a própria grade/agenda (via profile_id);
 *                   lê clientes (apoio) e cria agendamento só para si.
 *   receptionist -> sem escrita de catálogo; gerencia clientes e agenda de todos
 *                   os profissionais (price_cents é operacional, não `charge`).
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
  /** Criar/editar clientes (admin ou receptionist; professional só lê). */
  canManageCustomers: boolean;
  /** Criar/editar/mudar status de agendamentos (admin, receptionist, professional). */
  canManageAppointments: boolean;
  /** Agendar para qualquer profissional (admin/receptionist). O professional
   * fica travado em si mesmo no seletor do formulário. */
  canScheduleForAnyProfessional: boolean;
  /** Parear/gerenciar a conexão de WhatsApp do tenant (admin). Configuração do dono. */
  canManageWhatsAppConnection: boolean;
  /** Ler/editar os templates de mensagem do tenant (admin). Conteúdo editorial do dono. */
  canManageMessageTemplates: boolean;
  /** Disparar mensagem de WhatsApp sob demanda (admin/receptionist/professional). */
  canSendWhatsAppMessage: boolean;
  /**
   * Ler comissão — taxa e valor apurado (admin **ou** professional). Comissão é
   * dado financeiro sensível (classe de `charges`): `receptionist` NUNCA lê.
   * O professional vê só a própria comissão — o recorte real é do RLS por
   * `professional_id`; aqui é só defesa em profundidade na UI.
   */
  canViewCommission: boolean;
  /**
   * Cadastrar/editar a % de comissão de um profissional (só admin). O
   * professional não edita nem a própria taxa. Trava real no RLS write admin.
   */
  canManageCommission: boolean;
  isAdmin: boolean;
  isProfessional: boolean;
  isReceptionist: boolean;
}

export function usePermissions(): Permissions {
  const { role } = useCurrentUser();

  const isAdmin = role === "admin";
  const isProfessional = role === "professional";
  const isReceptionist = role === "receptionist";

  return {
    canManageCatalog: isAdmin,
    canEditAnySchedule: isAdmin,
    canEditOwnSchedule: isAdmin || isProfessional,
    isReadOnly: isReceptionist,
    canManageCustomers: isAdmin || isReceptionist,
    canManageAppointments: isAdmin || isReceptionist || isProfessional,
    canScheduleForAnyProfessional: isAdmin || isReceptionist,
    canManageWhatsAppConnection: isAdmin,
    canManageMessageTemplates: isAdmin,
    canSendWhatsAppMessage: isAdmin || isReceptionist || isProfessional,
    canViewCommission: isAdmin || isProfessional,
    canManageCommission: isAdmin,
    isAdmin,
    isProfessional,
    isReceptionist,
  };
}
