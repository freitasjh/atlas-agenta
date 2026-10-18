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

/**
 * Entidades do agendamento base (clientes finais + agendamentos). Shape das
 * linhas lidas sob RLS — o cliente nunca envia `tenant_id`, o banco o devolve.
 * Dinheiro em centavos inteiros; instantes em `timestamptz` UTC (ISO string),
 * convertidos para o fuso do tenant só na borda da UI (`src/lib/datetime.ts`).
 */

/** Linha de `customers`. `email` é opcional; `active` é soft-delete. */
export interface Customer {
  id: string;
  tenant_id: string;
  name: string;
  phone: string;
  email: string | null;
  whatsapp_opt_in: boolean;
  active: boolean;
  created_at: string;
}

/**
 * Linha de `appointments`. `price_cents` é snapshot do serviço no ato;
 * `starts_at`/`ends_at`/`confirmed_at`/`created_at` são `timestamptz` UTC.
 */
export interface Appointment {
  id: string;
  tenant_id: string;
  customer_id: string;
  professional_id: string;
  service_id: string;
  starts_at: string;
  ends_at: string;
  price_cents: number;
  status: AppointmentStatus;
  confirmed_at: string | null;
  created_at: string;
}

/**
 * Shape do join embutido do PostgREST que a leitura da agenda (ADR-06) lê para
 * os nomes legíveis: `select("…, customers(name), services(name),
 * professionals(name)")`. Cada relação pode vir `null` defensivamente (o zod do
 * hook valida o shape aninhado antes do uso).
 */
export interface AppointmentWithRelations extends Appointment {
  customers: { name: string } | null;
  services: { name: string } | null;
  professionals: { name: string } | null;
}

/**
 * Entidades do módulo WhatsApp (conexão + log de disparos). Shape das linhas
 * lidas sob RLS — o cliente nunca envia `tenant_id`, o banco o devolve. A
 * escrita de `messages` é exclusiva da Edge Function (service role, ADR-04); o
 * cliente só lê. PII mínima em log: `Message` não carrega telefone/documento,
 * e `payload` só expõe metadados não sensíveis.
 */

/** Estados observáveis da conexão (espelha `whatsapp_instances.connection_status`, ADR-02). */
export const WHATSAPP_CONNECTION_STATUSES = [
  "desconectado",
  "aguardando_qr",
  "conectado",
] as const;

export type WhatsAppConnectionStatus =
  (typeof WHATSAPP_CONNECTION_STATUSES)[number];

/** Estados de um disparo de mensagem (espelha `messages.status`, ADR-03). */
export const MESSAGE_STATUSES = [
  "fila",
  "enviado",
  "entregue",
  "falha",
] as const;

export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

/** Templates da régua de comunicação (espelha `messages.template`, dominio.md). */
export const MESSAGE_TEMPLATES = [
  "confirmacao",
  "lembrete_d1",
  "cobranca",
  "comprovante",
] as const;

export type MessageTemplate = (typeof MESSAGE_TEMPLATES)[number];

/**
 * Linha de `whatsapp_instances` (uma por tenant). `evolution_instance_name` é o
 * nome lógico derivado do tenant — **sem segredo**. QR/token não são
 * persistidos; o QR vem só na resposta efêmera de `pair` (ADR-04).
 */
export interface WhatsAppInstance {
  id: string;
  tenant_id: string;
  evolution_instance_name: string;
  connection_status: WhatsAppConnectionStatus;
  last_connected_at: string | null;
  created_at: string;
}

/**
 * Linha de `messages` (log de disparo). PII-safe: sem telefone/documento em
 * claro; o vínculo ao destino é `customer_id`. `payload` é um jsonb de
 * metadados não sensíveis (sem PII); `created_at` é `timestamptz` UTC.
 */
export interface Message {
  id: string;
  tenant_id: string;
  customer_id: string;
  appointment_id: string | null;
  channel: "whatsapp";
  template: MessageTemplate;
  status: MessageStatus;
  provider_message_id: string | null;
  failure_reason: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}
