/**
 * Enums de domínio do Atlas Agenda (conforme dominio.md).
 * Centralizados aqui para evitar strings mágicas em badges e guards.
 */

import type { PlanSlug } from "@/lib/plans";

/** Estados da máquina de estados do agendamento. */
export const APPOINTMENT_STATUSES = [
  "pendente",
  "aguardando_deposito",
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

/**
 * Projeção de uma linha de `tenants` lida cross-tenant pelo super_admin na
 * lista do painel admin (ADR-04 / Painel do Super Admin, Fatia 1). Shape do
 * SELECT role-gated por RLS (`tenants_super_admin`) — o cliente nunca envia
 * `tenant_id`; o banco devolve as linhas que a policy autoriza. Dado não
 * confiável: validado por zod (`adminTenantRowSchema`) antes do uso.
 *
 * `plan` reusa `PlanSlug` de `src/lib/plans.ts` (mesmos valores do enum
 * persistido `tenants.plan`: `free|starter|premium|enterprise`) — fonte única de slugs
 * e rótulos de plano, sem duplicar o enum aqui.
 */
export interface TenantListItem {
  id: string;
  trade_name: string | null;
  legal_name: string;
  document: string | null;
  owner_email: string;
  plan: PlanSlug;
  subscription_status: SubscriptionStatus;
  trial_ends_at: string | null;
  timezone: string;
  created_at: string;
}

/** Papéis de acesso (RBAC). */
export const ROLES = [
  "super_admin",
  "admin",
  "professional",
  "receptionist",
] as const;

export type Role = (typeof ROLES)[number];

/** Ramos de negócio suportados (enum persistido em tenants.segment). */
export const BUSINESS_SEGMENTS = ["barbearia", "clinica", "salao"] as const;
export type BusinessSegment = (typeof BUSINESS_SEGMENTS)[number];

/**
 * Projeção do `tenants` do usuário lida pelos hooks de identidade.
 * Só os campos que o chrome/guards consomem nesta fase.
 */
export interface CurrentTenant {
  id: string;
  trade_name: string | null;
  legal_name: string | null;
  subscription_status: SubscriptionStatus;
  timezone: string;
  /** Ramo de negócio do tenant; `null` = legado/genérico. */
  segment: BusinessSegment | null;
  /**
   * Slug do plano (`tenants.plan`: `free|starter|premium|enterprise`,
   * CHECK `tenants_plan_check`). String aberta de propósito: o catálogo
   * (`get_plans()`) é a SSoT dos slugs vigentes — valor fora do catálogo
   * degrada para `null` no consumo, nunca derruba o parse do tenant.
   */
  plan: string | null;
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
  processing_minutes: number;
  price_cents: number;
  backbar_cost_cents: number;
  active: boolean;
  created_at: string;
  /**
   * Config de depósito/sinal (Fase 4, ADR-02). Opcionais: backend anterior à
   * migration não retorna as colunas — ausência = depósito desabilitado.
   */
  deposit_enabled?: boolean;
  deposit_type?: "percent" | "fixed" | null;
  deposit_value?: number;
  deposit_deadline_hours?: number;
  deposit_refund_policy?: "total" | "partial" | "none";
  deposit_refund_percent?: number | null;
}

/**
 * Linha de `combos` (pacote/combo do salão — ADR-01 Fase 1b). Agrupa serviços
 * do próprio tenant por um preço próprio fechado (`price_cents`, centavos
 * inteiros — nunca float). `active` é soft-delete (sem DELETE físico na app). A
 * duração do pacote NÃO mora aqui: é derivada da soma das durações dos serviços
 * vinculados (D-3). Shape lido sob RLS — o cliente nunca envia `tenant_id`.
 */
export interface Combo {
  id: string;
  tenant_id: string;
  name: string;
  price_cents: number;
  active: boolean;
  created_at: string;
}

/**
 * Linha de `combo_services` (vínculo N:N combo↔services — ADR-02 Fase 1b).
 * FK composta por tenant dos dois lados garante que combo e serviço são do
 * mesmo tenant (cross-tenant impossível no schema). Espelho de
 * `ServiceProfessional`.
 */
export interface ComboService {
  id: string;
  tenant_id: string;
  combo_id: string;
  service_id: string;
  created_at: string;
}

/**
 * Linha de `professionals`. `profile_id` é somente-leitura nesta fase.
 * `schedule_start_date`/`schedule_end_date` são a vigência da grade (dia de
 * calendário `YYYY-MM-DD`, ambas opcionais; `null` = sem limite naquela ponta).
 * `slot_step_minutes` é o passo-base de oferta de slots (5..240, default 30).
 */
export interface Professional {
  id: string;
  tenant_id: string;
  name: string;
  profile_id: string | null;
  active: boolean;
  schedule_start_date: string | null;
  schedule_end_date: string | null;
  slot_step_minutes: number;
  created_at: string;
}

/**
 * Linha de `schedule_overrides` (exceção por profissional/data, sobrepõe a
 * grade recorrente num dia específico). `override_date` é dia de calendário
 * (`YYYY-MM-DD`) no fuso do tenant; horas em `HH:MM`. `is_closed = true` =
 * folga/feriado sem janela; `is_closed = false` = janela atípica (campos de
 * janela preenchidos). `reason` é rótulo opcional não-PII.
 */
export interface ScheduleOverride {
  id: string;
  tenant_id: string;
  professional_id: string;
  override_date: string;
  is_closed: boolean;
  start_time: string | null;
  end_time: string | null;
  break_start: string | null;
  break_end: string | null;
  reason: string | null;
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
 * Origem da confirmação de um agendamento (coluna `appointments.confirmed_via`,
 * migration 20250223091000). `cliente_whatsapp` = o cliente respondeu "1" no
 * lembrete D-1 (gravado pelo webhook, Fatia 2); `manual` = confirmado pela UI
 * (recepção/admin). `null` = ainda não confirmado OU linha legada da Fatia 1
 * (a UI trata ausência como origem manual/desconhecida).
 */
export const APPOINTMENT_CONFIRMED_VIA = [
  "cliente_whatsapp",
  "manual",
] as const;

export type AppointmentConfirmedVia =
  (typeof APPOINTMENT_CONFIRMED_VIA)[number];

/**
 * Origem do agendamento (coluna `appointments.origin`, migration
 * 20261111000000 — PDV balcão, modelo 1R). `agendado` = compromisso com
 * horário marcado, sempre com cliente; `walk_in` = venda de balcão criada na
 * hora, `customer_id` pode ser nulo (cliente anônimo → "Cliente de balcão").
 * Ortogonal ao `status`: não entra em máquina de estados, RLS ou relatório
 * financeiro — só filtra UI e autoriza o cliente nulo.
 */
export const APPOINTMENT_ORIGINS = ["agendado", "walk_in"] as const;

export type AppointmentOrigin = (typeof APPOINTMENT_ORIGINS)[number];

/**
 * Linha de `appointments`. `price_cents` é snapshot do serviço/pacote no ato;
 * `starts_at`/`ends_at`/`confirmed_at`/`created_at` são `timestamptz` UTC.
 * `confirmed_via` registra a ORIGEM da confirmação (ver `AppointmentConfirmedVia`).
 * `customer_id` é nullable no modelo 1R: só `origin='walk_in'` pode ser
 * anônimo (CHECK `appointments_walk_in_customer_check` no banco).
 *
 * `service_id` e `combo_id` estão em **XOR** (ADR-03, CHECK
 * `appointments_service_xor_combo`): exatamente um dos dois é preenchido — um
 * agendamento é de um serviço avulso OU de um pacote, nunca ambos nem nenhum.
 * Por isso ambos são nullable no tipo; a garantia de "exatamente um" é do banco.
 */
export interface Appointment {
  id: string;
  tenant_id: string;
  origin: AppointmentOrigin;
  customer_id: string | null;
  professional_id: string;
  service_id: string | null;
  combo_id: string | null;
  /**
   * Vínculo opcional ao crédito de pacote (Fase 2, ADR-02): nulo = avulso.
   * FK composta por tenant no banco; a baixa de 1 sessão é efeito automático
   * do trigger ao entrar em `concluido`.
   */
  package_credit_id: string | null;
  starts_at: string;
  ends_at: string;
  processing_minutes: number;
  price_cents: number;
  status: AppointmentStatus;
  confirmed_at: string | null;
  confirmed_via: AppointmentConfirmedVia | null;
  created_at: string;
}

/**
 * Shape do join embutido do PostgREST que a leitura da agenda (ADR-06) lê para
 * os nomes legíveis: `select("…, customers(name), services(name),
 * professionals(name)")`. Cada relação pode vir `null` defensivamente (o zod do
 * hook valida o shape aninhado antes do uso).
 *
 * `commission_cents` é o valor de comissão apurado — snapshot imutável gravado
 * ao concluir (ADR-02/ADR-03), lido por um join aninhado a
 * `appointment_commissions`. É normalizado pelo hook para `number | null`
 * (`null` = sem snapshot OU relação recortada pelo RLS: `receptionist` nunca
 * recebe a linha; `professional` só a própria). A UI trata `null` como "sem
 * comissão para exibir" e nunca calcula nada — só lê.
 */
export interface AppointmentWithRelations extends Appointment {
  customers: { name: string; whatsapp_opt_in: boolean } | null;
  services: { name: string; processing_minutes?: number } | null;
  /**
   * Join embutido do pacote quando o agendamento veio de um combo (`combo_id`
   * preenchido, XOR com `service_id`). `null` quando é serviço avulso ou a
   * relação não foi selecionada — nullable defensivo, como `services`. O preço
   * exibido continua vindo de `price_cents` (snapshot); `combos.price_cents` é
   * o preço-base do pacote, mantido aqui para referência na exibição.
   */
  combos: { name: string; price_cents: number } | null;
  professionals: { name: string } | null;
  resources: { name: string }[];
  commission_cents: number | null;
}

/**
 * Linha de `package_credits` — crédito de pacote por cliente (Fase 2, ADR-02).
 * 1 linha por venda; sem DELETE físico e sem UPDATE de valor (correção = venda
 * nova). `used_sessions` só anda pela baixa automática ao `concluido` (trigger)
 * ou pelo `redeem_session` direto. Dinheiro em centavos inteiros; tempos UTC.
 * Shape lido sob RLS — o cliente nunca envia `tenant_id`.
 */
export type ResourceType = "sala" | "equipamento" | "cadeira";

export interface Resource {
  id: string;
  tenant_id: string;
  name: string;
  type: ResourceType;
  capacity: number;
  color: string | null;
  active: boolean;
  created_at: string;
}

export type PackageCreditStatus = "active" | "exhausted" | "expired";

export interface PackageCredit {
  id: string;
  tenant_id: string;
  customer_id: string;
  service_id: string;
  total_sessions: number;
  used_sessions: number;
  price_cents: number;
  validity_days: number;
  expires_at: string;
  status: PackageCreditStatus;
  created_at: string;
}

/**
 * Linha retornada por `get_package_balance(p_customer_id)` — saldo por crédito
 * (leitura escopada ao cliente, sob RLS). `remaining = total - used`;
 * `expired` é flag ao vivo (`expires_at <= now()`), nunca status gravado.
 */
export interface PackageBalance {
  credit_id: string;
  service_id: string;
  total_sessions: number;
  used_sessions: number;
  remaining: number;
  expires_at: string;
  expired: boolean;
  status: PackageCreditStatus;
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

/**
 * Estados de um disparo de mensagem (espelha `messages.status`). `enviando` é o
 * estado transitório de CLAIM da fila de retentativa (ADR-05, migration
 * 20250223097000): a drenadora `whatsapp-dispatch` flipa `fila`→`enviando` ao
 * reivindicar a linha para envio. Como o histórico lê as linhas mais recentes
 * (`created_at desc`), esse estado chega ao cliente e precisa existir no enum —
 * senão o `.parse()` do histórico (ADR-06) derruba a lista inteira.
 */
export const MESSAGE_STATUSES = [
  "fila",
  "enviando",
  "enviado",
  "entregue",
  "falha",
] as const;

export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

/**
 * Templates da régua de comunicação (espelha `messages.template`, dominio.md).
 * `reagendar_retorno` é o retorno enviado quando o cliente responde "2" ao
 * lembrete D-1 (Fatia 2, migration 20250223093000).
 */
export const MESSAGE_TEMPLATES = [
  "confirmacao",
  "lembrete_d1",
  "cobranca",
  "comprovante",
  "reagendar_retorno",
] as const;

export type MessageTemplate = (typeof MESSAGE_TEMPLATES)[number];

/**
 * Linha de `message_templates` (uma por `(tenant_id, template_key)`). Texto
 * editável da régua de comunicação, sob RLS (leitura/escrita só admin). O
 * `template_key` espelha o enum `MessageTemplate`; `body` aceita até 2000 chars
 * no banco (o form limita a 1000). Nenhum segredo.
 */
export interface MessageTemplateRow {
  id: string;
  tenant_id: string;
  template_key: MessageTemplate;
  body: string;
  active: boolean;
  updated_at: string;
  created_at: string;
}

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

/** Categoria de produto (ADR-02). */
export type ProductCategory = "backbar" | "retail" | "both";

/** Linha de `products` (ADR-02). Dinheiro em centavos; saldo materializado em `stock_qty`. */
export interface Product {
  id: string;
  tenant_id: string;
  name: string;
  sku: string | null;
  category: ProductCategory;
  unit: string;
  cost_cents: number;
  price_cents: number;
  min_qty: number;
  active: boolean;
  commission_pct: number;
  stock_qty: number;
  created_at: string;
}

/** Linha de `product_professionals` (N:N). */
export interface ProductProfessional {
  id: string;
  tenant_id: string;
  product_id: string;
  professional_id: string;
  created_at: string;
}

/** Tipo de movimento de estoque (ADR-03). */
export type StockMovementType = "consume" | "replenish" | "adjust";

/** Linha de `stock_movements` (ledger append-only). */
export interface StockMovement {
  id: string;
  tenant_id: string;
  product_id: string;
  movement_type: StockMovementType;
  qty_delta: number;
  qty_before: number | null;
  qty_after: number | null;
  reason: string | null;
  appointment_id: string | null;
  batch: string | null;
  expires_at: string | null;
  supplier: string | null;
  unit_cost_cents: number | null;
  created_by: string | null;
  created_at: string;
}

/** Status de alerta de estoque (ADR-03). */
export type StockStatus = "ok" | "low" | "critical";

/** Linha retornada por `list_low_stock()` / `get_stock_alerts()`. */
export interface StockAlert {
  product_id: string;
  product_name: string;
  stock_qty: number;
  min_qty: number;
  status: StockStatus;
  next_expires_at: string | null;
}
