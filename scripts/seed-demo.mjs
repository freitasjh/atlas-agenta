#!/usr/bin/env node
/**
 * seed-demo.mjs: base de exemplo local (ADR-08 e ADR-09).
 *
 * Parte 1 (ADR-08): cria um tenant por ramo (barbearia, salão e clínica), com um usuário
 * administrador em cada um.
 * Parte 2 (ADR-09): para barbearia e salão, cria dados operacionais: profissionais, serviços,
 * grade de horário, clientes, comissão (barbearia), combos (salão) e agendamentos em vários estados.
 *
 * Idempotente e não destrutivo: rodar de novo cria só o que falta. Tenant e senha de um usuário
 * já existente não são alterados, para preservar estados de teste (ex.: tenant bloqueado).
 * A agenda só é semeada se o tenant ainda não tiver nenhum agendamento.
 *
 * Uso (somente com `supabase start` local):
 *   ATLAS_DEMO_SEED=1 \
 *   SUPABASE_URL=http://127.0.0.1:54321 \
 *   SUPABASE_SERVICE_ROLE_KEY=<service role local> \
 *   ATLAS_DEMO_PASSWORD=<6+ caracteres> \
 *   [ATLAS_DEMO_REALIGN_PASSWORD=1] \
 *   node scripts/seed-demo.mjs
 *
 * ATLAS_DEMO_REALIGN_PASSWORD=1 realinha a senha dos admins já existentes à ATLAS_DEMO_PASSWORD.
 * É opção explícita: sem ela, a senha atual de um usuário existente é mantida.
 *
 * Segurança:
 * - Service role e senha vêm só do ambiente. Nunca são impressas nem gravadas em arquivo.
 * - Recusa qualquer host que não seja 127.0.0.1 ou localhost, antes de qualquer requisição.
 *   A guarda olha só a URL: um túnel que mapeie projeto remoto para localhost passa por ela.
 * - E-mails usam o domínio reservado `.invalido` (RFC 2606), exigido pela guarda do harness pgTAP.
 * - Service role ignora RLS, então todo registro recebe `tenant_id` explícito (o default
 *   `current_tenant_id()` não tem JWT aqui e resultaria em nulo).
 * - Dados fictícios. Nada aqui é dado real de cliente.
 */
import { createClient } from '@supabase/supabase-js';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);
const MIN_PASSWORD_LENGTH = 6;
const TIMEZONE = 'America/Sao_Paulo';
// São Paulo está em UTC-03:00 fixo desde o fim do horário de verão (2019). Usado para converter
// horários de demonstração para UTC na gravação.
const TIMEZONE_OFFSET = '-03:00';

/** Estado de demonstração do tenant. Usado para avisar quando um tenant reaproveitado diverge dele. */
const DEMO_TENANT_STATE = { plan: 'pro', subscription_status: 'ativo', trial_ends_at: null };

/** Dias da semana com grade de atendimento (0 = domingo; 1 a 6 = segunda a sábado). */
const WEEK_DAYS = [1, 2, 3, 4, 5, 6];

/** Caminho de transições válidas a partir de 'pendente' (RF07). Estado final exige o intermediário. */
const TRANSITION_PATH = {
  pendente: [],
  confirmado: ['confirmado'],
  em_atendimento: ['em_atendimento'],
  concluido: ['em_atendimento', 'concluido'],
  cancelado: ['cancelado'],
  nao_compareceu: ['nao_compareceu'],
};

/*
 * Dados operacionais de demonstração. Nomes e preços de serviço seguem SEGMENT_SEED_SERVICES em
 * src/lib/segment-presets.ts. Este script é Node puro e não importa TypeScript, então a lista é
 * repetida aqui; ao mudar uma, mude a outra.
 *
 * Agendamento: `day` é a quantidade de dias a partir de hoje (fuso do tenant); `target` é o
 * estado final. O seed cria em 'pendente' e avança pelas transições válidas do banco.
 */
const BARBEARIA_OPERATIONAL = {
  label: 'Barbearia',
  phoneSegmentDigit: '1',
  workday: { start: '09:00', end: '18:00', breakStart: '12:00', breakEnd: '13:00' },
  professionals: [
    { name: 'Barbeiro Demo 1', commissionPct: 40 },
    { name: 'Barbeiro Demo 2', commissionPct: null },
  ],
  services: [
    { name: 'Corte de cabelo', durationMinutes: 30, priceCents: 4500 },
    { name: 'Barba', durationMinutes: 20, priceCents: 3000 },
    { name: 'Corte e barba', durationMinutes: 45, priceCents: 6500 },
  ],
  combos: [],
  customerCount: 6,
  appointments: [
    { day: -1, time: '10:00', professional: 0, service: 'Corte de cabelo', target: 'concluido' },
    { day: -1, time: '11:00', professional: 1, service: 'Barba', target: 'concluido' },
    { day: -1, time: '16:00', professional: 1, service: 'Corte e barba', target: 'nao_compareceu' },
    { day: 1, time: '09:00', professional: 0, service: 'Corte de cabelo', target: 'confirmado' },
    { day: 1, time: '10:00', professional: 1, service: 'Barba', target: 'pendente' },
    { day: 1, time: '15:00', professional: 1, service: 'Corte e barba', target: 'cancelado' },
  ],
};

const SALAO_OPERATIONAL = {
  label: 'Salão',
  phoneSegmentDigit: '2',
  workday: { start: '09:00', end: '19:00', breakStart: '13:00', breakEnd: '14:00' },
  professionals: [
    { name: 'Profissional Demo 1', commissionPct: null },
    { name: 'Profissional Demo 2', commissionPct: null },
  ],
  services: [
    { name: 'Corte', durationMinutes: 45, priceCents: 7000 },
    { name: 'Escova', durationMinutes: 40, priceCents: 6000 },
    { name: 'Coloração', durationMinutes: 90, priceCents: 15000 },
  ],
  // Preço de pacote fechado, menor que a soma dos serviços avulsos. Duração = soma (decisão D-3).
  combos: [
    { name: 'Corte + Escova', priceCents: 11000, services: ['Corte', 'Escova'] },
    { name: 'Coloração + Escova', priceCents: 19000, services: ['Coloração', 'Escova'] },
  ],
  customerCount: 6,
  appointments: [
    { day: -1, time: '10:00', professional: 0, combo: 'Corte + Escova', target: 'concluido' },
    { day: -1, time: '14:00', professional: 1, service: 'Coloração', target: 'concluido' },
    { day: 1, time: '09:00', professional: 0, combo: 'Coloração + Escova', target: 'confirmado' },
    { day: 1, time: '11:00', professional: 1, service: 'Escova', target: 'pendente' },
    { day: 1, time: '15:00', professional: 0, service: 'Corte', target: 'cancelado' },
  ],
};

const DEMO_TENANTS = [
  {
    segment: 'barbearia',
    tradeName: 'Barbearia Demo',
    phone: '(00) 00000-0001',
    admin: { email: 'admin.barbearia@demo.invalido', fullName: 'Admin Demo Barbearia' },
    operational: BARBEARIA_OPERATIONAL,
  },
  {
    segment: 'salao',
    tradeName: 'Salão Demo',
    phone: '(00) 00000-0002',
    admin: { email: 'admin.salao@demo.invalido', fullName: 'Admin Demo Salão' },
    operational: SALAO_OPERATIONAL,
  },
  {
    segment: 'clinica',
    tradeName: 'Clínica Demo',
    phone: '(00) 00000-0003',
    admin: { email: 'admin.clinica@demo.invalido', fullName: 'Admin Demo Clínica' },
  },
];

function fail(message) {
  console.error(`Erro: ${message}`);
  process.exit(1);
}

/** Valida todas as guardas antes de abrir qualquer conexão. Retorna a configuração lida do ambiente. */
function readConfig(env) {
  if (env.ATLAS_DEMO_SEED !== '1') {
    fail('defina ATLAS_DEMO_SEED=1 para executar o seed de demonstração.');
  }

  const supabaseUrl = env.SUPABASE_URL;
  if (!supabaseUrl) {
    fail('SUPABASE_URL não definida.');
  }

  let hostname;
  try {
    hostname = new URL(supabaseUrl).hostname;
  } catch {
    fail('SUPABASE_URL não é uma URL válida.');
  }
  if (!LOCAL_HOSTS.has(hostname)) {
    fail(`SUPABASE_URL aponta para host não local (${hostname}). O seed só roda em 127.0.0.1 ou localhost.`);
  }

  const password = env.ATLAS_DEMO_PASSWORD ?? '';
  if (password.length < MIN_PASSWORD_LENGTH) {
    fail(`ATLAS_DEMO_PASSWORD precisa ter ${MIN_PASSWORD_LENGTH} ou mais caracteres.`);
  }

  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    fail('SUPABASE_SERVICE_ROLE_KEY não definida.');
  }

  return {
    supabaseUrl,
    password,
    serviceRoleKey,
    realignPassword: env.ATLAS_DEMO_REALIGN_PASSWORD === '1',
  };
}

/** Busca usuário por e-mail varrendo as páginas do Auth admin. Retorna null se não existir. */
async function findUserByEmail(admin, email) {
  const perPage = 200;
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const found = data.users.find((user) => user.email === email);
    if (found) return found;
    if (data.users.length < perPage) return null;
  }
}

/** Busca tenants pela chave natural (trade_name + segment). Service role ignora RLS, então a busca é global. */
async function findTenantsByNaturalKey(admin, def) {
  const { data, error } = await admin
    .from('tenants')
    .select('id')
    .eq('trade_name', def.tradeName)
    .eq('segment', def.segment);
  if (error) throw error;
  return data;
}

/**
 * Classifica os tenants com a chave natural (trade_name + segment) quando o usuário demo não existe:
 * - 'none': não há tenant com a chave.
 * - 'orphan': há tenant, mas nenhum usuário vinculado a ele (sobrou de remoção do usuário).
 * - 'owned': algum tenant tem usuário vinculado (qualquer papel). Pertence a outro cadastro, então
 *   nunca se sugere remoção, porque apagar o tenant cascatearia para os perfis desses usuários.
 */
async function classifyNaturalKeyTenants(admin, def) {
  const tenants = await findTenantsByNaturalKey(admin, def);
  if (tenants.length === 0) return 'none';

  const { data, error } = await admin
    .from('profiles')
    .select('tenant_id')
    .in('tenant_id', tenants.map((tenant) => tenant.id))
    .limit(1);
  if (error) throw error;
  return data.length > 0 ? 'owned' : 'orphan';
}

/** Lê o perfil do admin e falha com instrução de limpeza se ele não existir ou estiver fora do esperado. */
async function loadAdminProfile(admin, def, userId) {
  const { data: profile, error } = await admin
    .from('profiles')
    .select('tenant_id, role')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!profile) {
    throw new Error(
      `usuário ${def.admin.email} existe sem perfil. No banco local, remova esse usuário em auth.users e, se a linha do tenant "${def.tradeName}" (${def.segment}) ainda existir sem outros usuários vinculados, remova também essa linha em tenants. Atenção: apagar a linha de tenants remove em cascata clientes, serviços, profissionais, grades de horário e demais dados operacionais desse tenant. Depois rode de novo.`,
    );
  }
  if (profile.role !== 'admin' || !profile.tenant_id) {
    throw new Error(`perfil de ${def.admin.email} fora do esperado (papel ou tenant ausente).`);
  }
  return profile;
}

/**
 * Compara segment, trade_name, plan, subscription_status e trial_ends_at do tenant com o padrão de
 * demonstração do ramo. Só lê: retorna a lista de campos que divergem (vazia se estiver tudo no padrão).
 */
async function findDemoDivergences(admin, tenantId, def) {
  const { data, error } = await admin
    .from('tenants')
    .select('segment, trade_name, plan, subscription_status, trial_ends_at')
    .eq('id', tenantId)
    .single();
  if (error) throw error;

  const divergences = [];
  if (data.segment !== def.segment) divergences.push(`segment=${data.segment}`);
  if (data.trade_name !== def.tradeName) divergences.push(`trade_name=${data.trade_name}`);
  if (data.plan !== DEMO_TENANT_STATE.plan) divergences.push(`plan=${data.plan}`);
  if (data.subscription_status !== DEMO_TENANT_STATE.subscription_status) {
    divergences.push(`subscription_status=${data.subscription_status}`);
  }
  if (data.trial_ends_at !== DEMO_TENANT_STATE.trial_ends_at) divergences.push('trial_ends_at preenchido');
  return divergences;
}

/**
 * Garante o tenant e o admin de um ramo.
 *
 * - Usuário novo: createUser dispara o trigger handle_new_user, que cria tenant + profile admin
 *   e os templates do ramo. Em seguida o tenant recebe o padrão de demonstração.
 * - Usuário existente: não altera tenant nem senha, salvo com realignPassword ativo. Apenas lê o
 *   estado do tenant e reporta divergências do padrão (ex.: falha parcial após createUser).
 *
 * Retorna { tenantId, created, realigned, divergences }.
 */
async function ensureTenantAdmin(admin, def, { password, realignPassword }) {
  const existing = await findUserByEmail(admin, def.admin.email);

  if (existing) {
    // Valida o perfil antes de qualquer escrita: não trocar a senha de um usuário sem perfil válido.
    const profile = await loadAdminProfile(admin, def, existing.id);
    let realigned = false;
    if (realignPassword) {
      const { error } = await admin.auth.admin.updateUserById(existing.id, { password });
      if (error) throw error;
      realigned = true;
    }
    const divergences = await findDemoDivergences(admin, profile.tenant_id, def);
    return { tenantId: profile.tenant_id, created: false, realigned, divergences };
  }

  // Criar de novo duplicaria a empresa. Só órfão (sem admin) aceita limpeza manual; outro dono, não.
  const naturalKeyState = await classifyNaturalKeyTenants(admin, def);
  if (naturalKeyState === 'owned') {
    throw new Error(
      `já existe tenant "${def.tradeName}" (${def.segment}) com usuários vinculados, e o administrador não é ${def.admin.email}. O seed não reaproveita nem altera esse tenant. Use outro nome fantasia nos dados de teste.`,
    );
  }
  if (naturalKeyState === 'orphan') {
    throw new Error(
      `tenant "${def.tradeName}" (${def.segment}) existe sem usuários vinculados. Remova a linha órfã em tenants no banco local e rode de novo. Atenção: isso remove em cascata clientes, serviços, profissionais, grades de horário e demais dados operacionais desse tenant.`,
    );
  }

  const { data, error } = await admin.auth.admin.createUser({
    email: def.admin.email,
    password,
    email_confirm: true,
    user_metadata: {
      trade_name: def.tradeName,
      full_name: def.admin.fullName,
      segment: def.segment,
    },
  });
  if (error) throw error;

  const profile = await loadAdminProfile(admin, def, data.user.id);

  const { error: tenantError } = await admin
    .from('tenants')
    .update({
      legal_name: `${def.tradeName} (demonstração)`,
      trade_name: def.tradeName,
      segment: def.segment,
      phone: def.phone,
      document: null,
      owner_email: def.admin.email,
      plan: 'pro',
      subscription_status: 'ativo',
      trial_ends_at: null,
      timezone: TIMEZONE,
    })
    .eq('id', profile.tenant_id);
  if (tenantError) throw tenantError;

  return { tenantId: profile.tenant_id, created: true, realigned: false, divergences: [] };
}

/** Dia de calendário de hoje no fuso informado, no formato AAAA-MM-DD (en-CA usa essa ordem). */
function todayInTimezone(timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** Soma dias a uma data AAAA-MM-DD sem depender do fuso local da máquina. */
function addDays(ymd, days) {
  const date = new Date(`${ymd}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Converte dia (AAAA-MM-DD) e hora (HH:MM) do fuso do tenant para instante UTC em ISO. */
function instantAt(ymd, time) {
  return new Date(`${ymd}T${time}:00${TIMEZONE_OFFSET}`).toISOString();
}

/**
 * Busca a linha pela chave natural (`match`, sempre com tenant_id) e cria só se não existir.
 * Retorna o id da linha.
 */
async function findOrCreate(admin, table, match, row = {}) {
  let query = admin.from(table).select('id');
  for (const [column, value] of Object.entries(match)) {
    query = query.eq(column, value);
  }
  const { data, error } = await query.limit(1);
  if (error) throw error;
  if (data.length > 0) return data[0].id;

  const { data: inserted, error: insertError } = await admin
    .from(table)
    .insert({ ...match, ...row })
    .select('id')
    .single();
  if (insertError) throw insertError;
  return inserted.id;
}

/** Vínculo N:N ou taxa: insere se não existir e mantém o que já existe (ON CONFLICT DO NOTHING). */
async function linkIgnoringDuplicates(admin, table, row, onConflict) {
  const { error } = await admin.from(table).upsert(row, { onConflict, ignoreDuplicates: true });
  if (error) throw error;
}

/**
 * Cria a agenda de demonstração do tenant. Só roda se o tenant não tiver agendamento nenhum.
 * Cada agendamento nasce em 'pendente' e avança pelas transições válidas, para que o trigger de
 * máquina de estados e o de comissão rodem como em produção.
 * Retorna a quantidade criada, ou null se a etapa foi pulada.
 */
async function seedAppointments(admin, tenantId, spec, refs) {
  const { count, error } = await admin
    .from('appointments')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId);
  if (error) throw error;
  if (count > 0) return null;

  const today = todayInTimezone(TIMEZONE);
  let created = 0;
  for (const [index, appt] of spec.appointments.entries()) {
    const line = appt.combo ? refs.combos.get(appt.combo) : refs.services.get(appt.service);
    const startsAt = instantAt(addDays(today, appt.day), appt.time);
    const endsAt = new Date(Date.parse(startsAt) + line.durationMinutes * 60_000).toISOString();

    const { data: inserted, error: insertError } = await admin
      .from('appointments')
      .insert({
        tenant_id: tenantId,
        customer_id: refs.customers[index % refs.customers.length],
        professional_id: refs.professionals[appt.professional],
        service_id: appt.combo ? null : line.id,
        combo_id: appt.combo ? line.id : null,
        starts_at: startsAt,
        ends_at: endsAt,
        price_cents: line.priceCents,
        status: 'pendente',
      })
      .select('id')
      .single();
    if (insertError) throw insertError;

    for (const status of TRANSITION_PATH[appt.target]) {
      const { error: stepError } = await admin
        .from('appointments')
        .update({ status })
        .eq('id', inserted.id);
      if (stepError) throw stepError;
    }
    created += 1;
  }
  return created;
}

/**
 * Semeia profissionais, grade, comissão, serviços, combos, clientes e agenda de um ramo.
 * Retorna a quantidade de agendamentos criados, ou null se a agenda já existia.
 */
async function seedOperational(admin, tenantId, spec) {
  const professionals = [];
  for (const prof of spec.professionals) {
    const professionalId = await findOrCreate(admin, 'professionals', { tenant_id: tenantId, name: prof.name });
    professionals.push(professionalId);

    for (const weekday of WEEK_DAYS) {
      await findOrCreate(
        admin,
        'working_hours',
        { tenant_id: tenantId, professional_id: professionalId, weekday },
        {
          start_time: spec.workday.start,
          end_time: spec.workday.end,
          break_start: spec.workday.breakStart,
          break_end: spec.workday.breakEnd,
        },
      );
    }

    if (prof.commissionPct != null) {
      await linkIgnoringDuplicates(
        admin,
        'professional_commissions',
        { tenant_id: tenantId, professional_id: professionalId, commission_pct: prof.commissionPct },
        'tenant_id,professional_id',
      );
    }
  }

  const services = new Map();
  for (const svc of spec.services) {
    const serviceId = await findOrCreate(
      admin,
      'services',
      { tenant_id: tenantId, name: svc.name },
      { duration_minutes: svc.durationMinutes, price_cents: svc.priceCents },
    );
    services.set(svc.name, { id: serviceId, durationMinutes: svc.durationMinutes, priceCents: svc.priceCents });
    for (const professionalId of professionals) {
      await linkIgnoringDuplicates(
        admin,
        'service_professionals',
        { tenant_id: tenantId, service_id: serviceId, professional_id: professionalId },
        'tenant_id,service_id,professional_id',
      );
    }
  }

  const combos = new Map();
  for (const combo of spec.combos) {
    const comboId = await findOrCreate(
      admin,
      'combos',
      { tenant_id: tenantId, name: combo.name },
      { price_cents: combo.priceCents },
    );
    const parts = combo.services.map((name) => services.get(name));
    for (const part of parts) {
      await linkIgnoringDuplicates(
        admin,
        'combo_services',
        { tenant_id: tenantId, combo_id: comboId, service_id: part.id },
        'tenant_id,combo_id,service_id',
      );
    }
    // Duração do pacote é a soma dos serviços (decisão D-3 do PRD).
    combos.set(combo.name, {
      id: comboId,
      durationMinutes: parts.reduce((total, part) => total + part.durationMinutes, 0),
      priceCents: combo.priceCents,
    });
  }

  const customers = [];
  for (let i = 0; i < spec.customerCount; i += 1) {
    const customerId = await findOrCreate(
      admin,
      'customers',
      { tenant_id: tenantId, phone: `+550000${spec.phoneSegmentDigit}${String(i + 1).padStart(3, '0')}` },
      {
        name: `Cliente ${spec.label} ${String(i + 1).padStart(2, '0')}`,
        whatsapp_opt_in: false,
      },
    );
    customers.push(customerId);
  }

  return seedAppointments(admin, tenantId, spec, { professionals, services, combos, customers });
}

async function main() {
  const { supabaseUrl, password, serviceRoleKey, realignPassword } = readConfig(process.env);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  for (const def of DEMO_TENANTS) {
    const { tenantId, created, realigned, divergences } = await ensureTenantAdmin(admin, def, {
      password,
      realignPassword,
    });
    const status = created ? 'criado' : 'reaproveitado (estado preservado)';
    let suffix = '';
    if (realigned) {
      suffix = ', senha realinhada';
    } else if (!created) {
      suffix =
        ', senha atual mantida (ATLAS_DEMO_PASSWORD ignorada); para realinhar à ATLAS_DEMO_PASSWORD, rode com ATLAS_DEMO_REALIGN_PASSWORD=1';
    }
    console.log(`${status}: ${def.segment} (${def.admin.email})${suffix}`);
    if (divergences.length > 0) {
      // Não corrige nada: pode ser estado de teste intencional ou falha parcial de uma execução anterior.
      console.warn(
        `ATENÇÃO: tenant ${def.segment} fora do padrão de demonstração (${divergences.join(', ')}). ` +
          'Se não for estado de teste intencional, corrija no banco local ou remova o usuário e o tenant e rode de novo.',
      );
    }

    if (def.operational) {
      const appointmentsCreated = await seedOperational(admin, tenantId, def.operational);
      const detail =
        appointmentsCreated === null
          ? 'agenda já existente, etapa pulada'
          : `${appointmentsCreated} agendamentos criados`;
      console.log(`dados operacionais (${def.segment}): ${detail}`);
    }
  }
}

main().catch((err) => {
  console.error(`Falha no seed: ${err.message ?? err}`);
  process.exit(1);
});
