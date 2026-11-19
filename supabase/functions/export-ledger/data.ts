// Leitura dos dados do export (ADR-10).
//
// A Edge roda com service_role: `tenant_id` NUNCA vem do corpo — é resolvido do
// JWT em `resolveIdentity` e passado explicitamente para cada consulta (o RLS
// de admin já é a trava da leitura pelo cliente; aqui o filtro é explícito).
//
// Nenhuma dessas consultas escreve em nada. Fronteira do ledger preservada:
// `appointment_payments` é lido como SSoT, com `voided_at is null`; avulsas
// saem de `receivable_settlements` (nunca migram para o ledger); recorrência
// (membership) é gateway-only, com `paid_at` e categoria própria ("Recorrência")
// — a MESMA base de caixa do `dre_report`, para o SPED-resumo fechar com o DRE.
//
// Cap do PostgREST: `config.toml` (e o default do Supabase hospedado) corta a
// resposta em 1000 linhas — inclusive para service_role. Um `select` único
// entregaria arquivo contábil truncado em silêncio e gravaria log de sucesso
// falso. Por isso toda leitura aqui pagina com `range` e ordenação estável, e
// `.in()` derivado dessas linhas vai em blocos (URL do gateway estoura com
// centenas de UUIDs).

import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { ApiError } from "../_shared/http.ts";
import {
  type BankLine,
  type BankMeta,
  type Escopo,
  type FiscalDoc,
  type Formato,
  type Movimento,
  type Payload,
  METODO_LABEL,
} from "./types.ts";

type Row = Record<string, unknown>;

const PERIODO_MAX_DIAS = 400;
/** Tamanho de página: nunca maior que o `max_rows` do PostgREST (1000). */
const PAGE_SIZE = 1000;
/** Guarda contra laço infinito: 500 páginas = 500k linhas por fonte. */
const MAX_PAGES = 500;
/** Blocos de `.in()`: centenas de UUIDs já passam do limite de URL do gateway. */
const IN_CHUNK = 150;

function asRows(data: unknown): Row[] {
  return Array.isArray(data) ? (data as Row[]) : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function integer(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

function fail(): never {
  throw new ApiError(500, "INTERNAL");
}

/** Valida a janela do export (bordas UTC semiabertas `[ini, fim)`). */
export function assertRange(ini: string, fim: string): void {
  const start = new Date(ini).getTime();
  const end = new Date(fim).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new ApiError(400, "INVALID_BODY");
  }
  if (end - start > PERIODO_MAX_DIAS * 24 * 60 * 60 * 1000) {
    throw new ApiError(400, "RANGE_TOO_LARGE");
  }
}

interface PageResponse {
  data: unknown;
  error: unknown;
}

type PageQuery = PromiseLike<PageResponse>;

/**
 * Lê todas as páginas de uma consulta. A consulta precisa ter ordenação
 * determinística (data + `id`) para a página seguinte não repetir nem pular
 * linhas. Se o limite de páginas for atingido, falha em vez de truncar.
 */
async function readAll(page: (from: number, to: number) => PageQuery): Promise<Row[]> {
  const rows: Row[] = [];
  for (let index = 0; index < MAX_PAGES; index += 1) {
    const from = index * PAGE_SIZE;
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) fail();
    const batch = asRows(data);
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return rows;
  }
  // Mais de MAX_PAGES páginas: recusar em vez de entregar arquivo parcial.
  fail();
}

function chunks<T>(items: readonly T[], size = IN_CHUNK): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    output.push(items.slice(index, index + size));
  }
  return output;
}

/** Busca linhas por `id` em blocos, sempre restrita ao tenant. */
async function readByIds(
  service: SupabaseClient,
  table: string,
  columns: string,
  tenantId: string,
  ids: readonly string[],
): Promise<Row[]> {
  const unique = [...new Set(ids.filter((id) => id !== ""))];
  const rows: Row[] = [];
  for (const part of chunks(unique)) {
    const { data, error } = await service
      .from(table)
      .select(columns)
      .eq("tenant_id", tenantId)
      .in("id", part);
    if (error) fail();
    rows.push(...asRows(data));
  }
  return rows;
}

/** Formata um instante como `YYYY-MM-DD` no fuso do tenant. */
export function dataNoFuso(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export async function readTenantTimezone(
  service: SupabaseClient,
  tenantId: string,
): Promise<string> {
  const { data, error } = await service
    .from("tenants")
    .select("timezone")
    .eq("id", tenantId)
    .maybeSingle();
  if (error) throw new ApiError(500, "INTERNAL");
  const tz = text((data as Row | null)?.timezone);
  return tz === "" ? "America/Sao_Paulo" : tz;
}

async function loadLedger(
  service: SupabaseClient,
  tenantId: string,
  ini: string,
  fim: string,
  timeZone: string,
): Promise<Movimento[]> {
  const payments = await readAll((from, to) =>
    service
      .from("appointment_payments")
      .select("id, appointment_id, amount_cents, tip_cents, method, received_at")
      .eq("tenant_id", tenantId)
      .is("voided_at", null)
      .gte("received_at", ini)
      .lt("received_at", fim)
      .order("received_at")
      .order("id")
      .range(from, to),
  );
  if (payments.length === 0) return [];

  const appointmentIds = payments.map((row) => text(row.appointment_id));
  const appointments = await readByIds(
    service,
    "appointments",
    "id, customer_id",
    tenantId,
    appointmentIds,
  );
  const customerByAppointment = new Map<string, string>();
  for (const appointment of appointments) {
    if (typeof appointment.customer_id === "string") {
      customerByAppointment.set(text(appointment.id), appointment.customer_id);
    }
  }

  const customerIds = [...customerByAppointment.values()];
  const nameById = new Map<string, string>();
  if (customerIds.length > 0) {
    for (const customer of await readByIds(service, "customers", "id, name", tenantId, customerIds)) {
      nameById.set(text(customer.id), text(customer.name));
    }
  }

  return payments
    .map((row): Movimento => {
      const customerId = customerByAppointment.get(text(row.appointment_id)) ?? "";
      const cliente = nameById.get(customerId) ?? "";
      const receivedAt = text(row.received_at);
      return {
        data: dataNoFuso(receivedAt, timeZone),
        tipo: "receita_atendimento",
        categoria: "Atendimentos",
        descricao: cliente === "" ? "Atendimento" : `Atendimento — ${cliente}`,
        metodo: METODO_LABEL[text(row.method)] ?? text(row.method),
        valor_cents: integer(row.amount_cents),
        gorjeta_cents: integer(row.tip_cents),
      };
    })
    .sort((a, b) => a.data.localeCompare(b.data));
}

async function loadAvulsas(
  service: SupabaseClient,
  tenantId: string,
  ini: string,
  fim: string,
  timeZone: string,
): Promise<Movimento[]> {
  const settlements = await readAll((from, to) =>
    service
      .from("receivable_settlements")
      .select("id, receivable_id, valor_cents, recebido_at, metodo")
      .eq("tenant_id", tenantId)
      .gte("recebido_at", ini)
      .lt("recebido_at", fim)
      .order("recebido_at")
      .order("id")
      .range(from, to),
  );
  if (settlements.length === 0) return [];

  const receivables = await readByIds(
    service,
    "receivables",
    "id, descricao, categoria, customer_id",
    tenantId,
    settlements.map((row) => text(row.receivable_id)),
  );
  const byId = new Map<string, Row>();
  for (const receivable of receivables) byId.set(text(receivable.id), receivable);

  const customerIds = receivables.map((row) => text(row.customer_id)).filter(Boolean);
  const nameById = new Map<string, string>();
  if (customerIds.length > 0) {
    for (const customer of await readByIds(service, "customers", "id, name", tenantId, customerIds)) {
      nameById.set(text(customer.id), text(customer.name));
    }
  }

  return settlements
    .map((row): Movimento => {
      const receivable = byId.get(text(row.receivable_id));
      const descricao = text(receivable?.descricao);
      const cliente = nameById.get(text(receivable?.customer_id)) ?? "";
      return {
        data: dataNoFuso(text(row.recebido_at), timeZone),
        tipo: "receita_avulsa",
        // Grupo próprio do DRE (ADR-09): a categoria da conta não muda o grupo —
        // assim o total por categoria do SPED bate com `dre_report`.
        categoria: "Receitas avulsas",
        descricao: cliente === "" || descricao === "" ? descricao || "Recebimento avulso" : `${descricao} — ${cliente}`,
        metodo: METODO_LABEL[text(row.metodo)] ?? text(row.metodo),
        valor_cents: integer(row.valor_cents),
        gorjeta_cents: 0,
      };
    })
    .sort((a, b) => a.data.localeCompare(b.data));
}

/**
 * Recorrência (membership) — gateway-only, fora do ledger de atendimento.
 * Mesma base de caixa do `dre_report`: `status = 'pago'` e `paid_at` na janela.
 */
async function loadMembership(
  service: SupabaseClient,
  tenantId: string,
  ini: string,
  fim: string,
  timeZone: string,
): Promise<Movimento[]> {
  const charges = await readAll((from, to) =>
    service
      .from("membership_charges")
      .select("id, subscription_id, amount_cents, paid_at")
      .eq("tenant_id", tenantId)
      .eq("status", "pago")
      .not("paid_at", "is", null)
      .gte("paid_at", ini)
      .lt("paid_at", fim)
      .order("paid_at")
      .order("id")
      .range(from, to),
  );
  if (charges.length === 0) return [];

  const subscriptions = await readByIds(
    service,
    "membership_subscriptions",
    "id, plan_id, customer_id",
    tenantId,
    charges.map((row) => text(row.subscription_id)),
  );
  const subscriptionById = new Map<string, Row>();
  for (const subscription of subscriptions) subscriptionById.set(text(subscription.id), subscription);

  const planIds = subscriptions.map((row) => text(row.plan_id)).filter(Boolean);
  const planNameById = new Map<string, string>();
  if (planIds.length > 0) {
    for (const plan of await readByIds(service, "membership_plans", "id, name", tenantId, planIds)) {
      planNameById.set(text(plan.id), text(plan.name));
    }
  }

  const customerIds = subscriptions.map((row) => text(row.customer_id)).filter(Boolean);
  const nameById = new Map<string, string>();
  if (customerIds.length > 0) {
    for (const customer of await readByIds(service, "customers", "id, name", tenantId, customerIds)) {
      nameById.set(text(customer.id), text(customer.name));
    }
  }

  return charges
    .map((row): Movimento => {
      const subscription = subscriptionById.get(text(row.subscription_id));
      const plano = planNameById.get(text(subscription?.plan_id)) ?? "Plano recorrente";
      const cliente = nameById.get(text(subscription?.customer_id)) ?? "";
      return {
        data: dataNoFuso(text(row.paid_at), timeZone),
        tipo: "receita_recorrencia",
        // Categoria idêntica à do `dre_report` (caixa) — paridade SPED/CSV ↔ DRE.
        categoria: "Recorrência",
        descricao: cliente === "" ? plano : `${plano} — ${cliente}`,
        metodo: "Asaas",
        valor_cents: integer(row.amount_cents),
        gorjeta_cents: 0,
      };
    })
    .sort((a, b) => a.data.localeCompare(b.data));
}

async function loadPayables(
  service: SupabaseClient,
  tenantId: string,
  ini: string,
  fim: string,
  timeZone: string,
): Promise<Movimento[]> {
  const settlements = await readAll((from, to) =>
    service
      .from("payable_settlements")
      .select("id, payable_id, valor_cents, pago_at, conta")
      .eq("tenant_id", tenantId)
      .gte("pago_at", ini)
      .lt("pago_at", fim)
      .order("pago_at")
      .order("id")
      .range(from, to),
  );
  if (settlements.length === 0) return [];

  const payables = await readByIds(
    service,
    "payables",
    "id, descricao, categoria, supplier_id",
    tenantId,
    settlements.map((row) => text(row.payable_id)),
  );
  const byId = new Map<string, Row>();
  for (const payable of payables) byId.set(text(payable.id), payable);

  const supplierIds = payables.map((row) => text(row.supplier_id)).filter(Boolean);
  const nameById = new Map<string, string>();
  if (supplierIds.length > 0) {
    for (const supplier of await readByIds(service, "suppliers", "id, nome", tenantId, supplierIds)) {
      nameById.set(text(supplier.id), text(supplier.nome));
    }
  }

  return settlements
    .map((row): Movimento => {
      const payable = byId.get(text(row.payable_id));
      const descricao = text(payable?.descricao) || "Baixa de conta a pagar";
      const fornecedor = nameById.get(text(payable?.supplier_id)) ?? "";
      return {
        data: dataNoFuso(text(row.pago_at), timeZone),
        tipo: "despesa",
        categoria: text(payable?.categoria) || "Sem categoria",
        descricao: fornecedor === "" ? descricao : `${descricao} — ${fornecedor}`,
        metodo: text(row.conta),
        valor_cents: integer(row.valor_cents),
        gorjeta_cents: 0,
      };
    })
    .sort((a, b) => a.data.localeCompare(b.data));
}

async function loadFiscal(
  service: SupabaseClient,
  tenantId: string,
  ini: string,
  fim: string,
  timeZone: string,
): Promise<FiscalDoc[]> {
  // A data de referência é `authorized_at ?? created_at`. O recorte vai para o
  // banco (índice `fiscal_documents_tenant_authorized_idx`): filtrar só em
  // memória depois de um `select` capado recortaria o período errado (422
  // falso ou parcial). O `.or` cobre as duas colunas da mesma regra.
  const iniIso = new Date(ini).toISOString();
  const fimIso = new Date(fim).toISOString();
  const documentos = await readAll((from, to) =>
    service
      .from("fiscal_documents")
      .select("id, numero, serie, chave_acesso, status, valor_cents, created_at, authorized_at")
      .eq("tenant_id", tenantId)
      .in("status", ["autorizada", "contingencia", "cancelada"])
      .or(
        `and(authorized_at.gte.${iniIso},authorized_at.lt.${fimIso}),` +
          `and(authorized_at.is.null,created_at.gte.${iniIso},created_at.lt.${fimIso})`,
      )
      .order("created_at")
      .order("id")
      .range(from, to),
  );

  const start = new Date(ini).getTime();
  const end = new Date(fim).getTime();

  return documentos
    .map((row): FiscalDoc | null => {
      const reference = text(row.authorized_at) || text(row.created_at);
      const when = new Date(reference).getTime();
      if (!Number.isFinite(when) || when < start || when >= end) return null;
      return {
        id: text(row.id),
        numero: text(row.numero) || null,
        serie: text(row.serie) || null,
        chave_acesso: text(row.chave_acesso) || null,
        status: text(row.status),
        valor_cents: integer(row.valor_cents),
        data: dataNoFuso(reference, timeZone),
      };
    })
    .filter((row): row is FiscalDoc => row !== null)
    .sort((a, b) => a.data.localeCompare(b.data));
}

async function loadBank(
  service: SupabaseClient,
  tenantId: string,
  periodoIni: string,
  periodoFim: string,
): Promise<{ lines: BankLine[]; meta: BankMeta | null; aberturaCents: number }> {
  const accounts = await readAll((from, to) =>
    service
      .from("bank_accounts")
      .select("id, nome, banco, conta_ultimos4, saldo_inicial_cents")
      .eq("tenant_id", tenantId)
      .eq("ativo", true)
      .order("id")
      .range(from, to),
  );

  const activeAccountIds = new Set(accounts.map((account) => text(account.id)));

  // `bank_lines` não tem `account_id`: a conta vem de `bank_statements`. Só
  // linhas de contas ATIVAS entram no extrato — senão a abertura somaria
  // histórico de conta inativa cujo saldo inicial ficou de fora.
  const statementAccount = new Map<string, string>();
  if (activeAccountIds.size > 0) {
    const statements = await readAll((from, to) =>
      service
        .from("bank_statements")
        .select("id, account_id")
        .eq("tenant_id", tenantId)
        .order("id")
        .range(from, to),
    );
    for (const statement of statements) {
      const accountId = text(statement.account_id);
      if (activeAccountIds.has(accountId)) statementAccount.set(text(statement.id), accountId);
    }
  }

  const activeStatement = (row: Row): boolean => statementAccount.has(text(row.statement_id));

  const lines = (
    await readAll((from, to) =>
      service
        .from("bank_lines")
        .select("id, statement_id, data, descricao, valor_cents")
        .eq("tenant_id", tenantId)
        .eq("status", "conciliado")
        .gte("data", periodoIni)
        .lte("data", periodoFim)
        .order("data")
        .order("id")
        .range(from, to),
    )
  )
    .filter(activeStatement)
    .map(
      (row): BankLine => ({
        id: text(row.id),
        data: text(row.data),
        descricao: text(row.descricao),
        valor_cents: integer(row.valor_cents),
      }),
    )
    .sort((a, b) => a.data.localeCompare(b.data));

  // Saldo de abertura do extrato CONCILIADO: saldo inicial das contas ativas +
  // linhas conciliadas dessas contas anteriores ao período.
  let aberturaCents = accounts.reduce(
    (total, account) => total + integer(account.saldo_inicial_cents),
    0,
  );
  if (statementAccount.size > 0) {
    const priorRows = await readAll((from, to) =>
      service
        .from("bank_lines")
        .select("id, statement_id, valor_cents")
        .eq("tenant_id", tenantId)
        .eq("status", "conciliado")
        .lt("data", periodoIni)
        .order("data")
        .order("id")
        .range(from, to),
    );
    aberturaCents += priorRows
      .filter(activeStatement)
      .reduce((total, row) => total + integer(row.valor_cents), 0);
  }

  const meta: BankMeta | null =
    accounts.length === 0
      ? null
      : {
          consolidado: accounts.length > 1,
          banco: accounts.length === 1 ? text(accounts[0].banco) : "Consolidado",
          contaUltimos4:
            accounts.length === 1 ? text(accounts[0].conta_ultimos4) : `${accounts.length} contas`,
        };

  return { lines, meta, aberturaCents };
}

export interface LoadInput {
  tenantId: string;
  ini: string;
  fim: string;
  periodoIni: string;
  periodoFim: string;
  formato: Formato;
  escopo: Escopo;
  timeZone: string;
}

export async function loadPayload(service: SupabaseClient, input: LoadInput): Promise<Payload> {
  assertRange(input.ini, input.fim);
  const { tenantId, ini, fim, timeZone, formato, escopo } = input;

  const base: Payload = {
    movimentos: [],
    fiscal: [],
    bankLines: [],
    bankMeta: null,
    saldoAberturaCents: 0,
    timeZone,
  };

  if (formato === "ofx") {
    const bank = await loadBank(service, tenantId, input.periodoIni, input.periodoFim);
    return { ...base, bankLines: bank.lines, bankMeta: bank.meta, saldoAberturaCents: bank.aberturaCents };
  }

  if (escopo === "receber") {
    const [ledger, avulsas, membership] = await Promise.all([
      loadLedger(service, tenantId, ini, fim, timeZone),
      loadAvulsas(service, tenantId, ini, fim, timeZone),
      loadMembership(service, tenantId, ini, fim, timeZone),
    ]);
    return {
      ...base,
      movimentos: [...ledger, ...avulsas, ...membership].sort((a, b) => a.data.localeCompare(b.data)),
    };
  }

  if (escopo === "pagar") {
    return { ...base, movimentos: await loadPayables(service, tenantId, ini, fim, timeZone) };
  }

  return { ...base, fiscal: await loadFiscal(service, tenantId, ini, fim, timeZone) };
}
