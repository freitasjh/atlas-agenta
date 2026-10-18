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

/**
 * Entidades do cadastro operacional (serviços, profissionais, vínculo N:N,
 * grade de horários). Shape das linhas lidas sob RLS — o cliente nunca envia
 * `tenant_id`, o banco o devolve. Dinheiro em centavos inteiros; horas da grade
 * em `time` (`HH:MM`), não instante UTC.
 */

/** Linha de `services`. Preço em centavos inteiros. */
export interface Service {
  id: string;
  tenant_id: string;
  name: string;
  duration_minutes: number;
  price_cents: number;
  active: boolean;
  created_at: string;
}

/** Linha de `professionals`. `profile_id` é somente-leitura nesta fase. */
export interface Professional {
  id: string;
  tenant_id: string;
  name: string;
  profile_id: string | null;
  active: boolean;
  created_at: string;
}

/** Linha de `service_professionals` (vínculo N:N serviço↔profissional). */
export interface ServiceProfessional {
  id: string;
  tenant_id: string;
  service_id: string;
  professional_id: string;
  created_at: string;
}

/**
 * Linha de `working_hours` (grade semanal por profissional). `weekday` 0–6
 * (0 = domingo); horas no formato `HH:MM`. Intervalo (`break_*`) é
 * ambos-ou-nenhum.
 */
export interface WorkingHour {
  id: string;
  tenant_id: string;
  professional_id: string;
  weekday: number;
  start_time: string;
  end_time: string;
  break_start: string | null;
  break_end: string | null;
  created_at: string;
}

/**
 * Dias da semana (0 = domingo … 6 = sábado), alinhado ao `weekday` de
 * `working_hours`. A ordem de exibição na grade (segunda→domingo) é decidida na
 * tela; aqui o índice é o valor persistido.
 */
export const WEEKDAYS = [
  { value: 0, label: "Domingo" },
  { value: 1, label: "Segunda-feira" },
  { value: 2, label: "Terça-feira" },
  { value: 3, label: "Quarta-feira" },
  { value: 4, label: "Quinta-feira" },
  { value: 5, label: "Sexta-feira" },
  { value: 6, label: "Sábado" },
] as const;

export type Weekday = (typeof WEEKDAYS)[number]["value"];
