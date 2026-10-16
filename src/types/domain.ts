/**
 * Enums de domínio do Atlas Agenda (conforme dominio.md).
 * Centralizados aqui para evitar strings mágicas em badges e guards.
 */

/** Estados da máquina de estados do agendamento. */
export const APPOINTMENT_STATUSES = [
  "pendente",
  "confirmado",
  "em_atendimento",
  "concluido",
  "cancelado",
  "nao_compareceu",
] as const;

export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** Status de assinatura do tenant. */
export const SUBSCRIPTION_STATUSES = [
  "trial",
  "ativo",
  "pendente",
  "bloqueado",
  "cancelado",
] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** Papéis de acesso (RBAC). */
export const ROLES = [
  "super_admin",
  "admin",
  "professional",
  "receptionist",
] as const;

export type Role = (typeof ROLES)[number];

/**
 * Projeção do `profiles` do usuário logado lida pelos hooks de identidade.
 * `tenant_id` é `null` para `super_admin` (invariante garantida no banco).
 */
export interface CurrentProfile {
  id: string;
  role: Role;
  tenant_id: string | null;
}

/**
 * Projeção do `tenants` do profile lida pelos hooks de identidade.
 * Só os campos que o chrome/guards consomem nesta fase.
 */
export interface CurrentTenant {
  id: string;
  trade_name: string | null;
  subscription_status: SubscriptionStatus;
  timezone: string;
}
