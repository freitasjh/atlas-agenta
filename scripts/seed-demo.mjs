#!/usr/bin/env node
/**
 * seed-demo.mjs: base de exemplo local (ADR-08 e ADR-09).
 *
 * Parte 1 (ADR-08): cria um tenant por ramo (barbearia, salão e clínica), com um usuário
 * administrador em cada um.
 * Parte 2 (ADR-09): para barbearia e salão, cria dados operacionais: profissionais, serviços,
 * grade de horário, clientes, comissão (barbearia), combos (salão) e agendamentos em vários estados.
 * Parte 3 (ADR-10): para clínica, cria profissional com login, profissional sem vínculo, recepção,
 * agendamentos em todos os estados e fichas (clinical_records) fictícias, com uma correção.
 *
 * Idempotente e não destrutivo: rodar de novo cria só o que falta. Tenant e senha de um usuário
 * já existente não são alterados, para preservar estados de teste (ex.: tenant bloqueado).
 * A agenda é semeada só com tenant sem agendamento. Se o tenant já tiver a quantidade, a distribuição
 * de status e o confirmed_via 'manual' dos confirmados da demonstração, a etapa é pulada. Qualquer outra
 * situação (ex.: execução anterior interrompida, ou agendamento criado, removido ou com status alterado pela UI) interrompe a etapa do ramo
 * com erro, sem gravar nada na agenda.
 * Um erro em um ramo não impede os demais; o processo termina com código 1 se algum ramo falhar.
 * Tenant fora do padrão de demonstração não recebe dados operacionais; o aviso indica a correção.
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
 * estado final. O seed cria em 'pendente' e avança pelas transições válidas do banco. Se a data
 * cair em domingo (sem grade), `day` negativo retrocede para o sábado e `day` positivo avança para
 * a segunda (ver workdayFor). Assim um agendamento de passado nunca cai hoje nem no futuro.
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

/*
 * Clínica (ADR-10). Serviços seguem SEGMENT_SEED_SERVICES em src/lib/segment-presets.ts (mesma
 * observação dos ramos acima). Equipe: `member` liga o profissional a um usuário de `members`; sem
 * `member`, o profissional não tem login (profile_id nulo).
 */
const CLINICA_OPERATIONAL = {
  label: 'Clínica',
  phoneSegmentDigit: '3',
  workday: { start: '08:00', end: '18:00', breakStart: '12:00', breakEnd: '13:00' },
  members: [
    {
      key: 'professional',
      email: 'profissional.clinica@demo.invalido',
      fullName: 'Profissional Demo Clínica',
      role: 'professional',
    },
    {
      key: 'receptionist',
      email: 'recepcao.clinica@demo.invalido',
      fullName: 'Recepção Demo Clínica',
      role: 'receptionist',
    },
  ],
  professionals: [
    { name: 'Profissional Demo 1', commissionPct: null, member: 'professional' },
    { name: 'Profissional Demo 2', commissionPct: null, member: null },
  ],
  services: [
    { name: 'Consulta', durationMinutes: 50, priceCents: 20000 },
    { name: 'Retorno', durationMinutes: 30, priceCents: 10000 },
    { name: 'Avaliação inicial', durationMinutes: 60, priceCents: 25000 },
  ],
  combos: [],
  customerCount: 6,
  // Fichas: todo atendimento em em_atendimento ou concluido ganha um registro original, com conteúdo
  // escolhido por profissional e serviço (CLINICAL_RECORD_CONTENT). A correção vai para um atendimento
  // fixo (CLINICAL_RECORD_CORRECTION.targetKey).
  clinicalRecords: true,
  appointments: [
    { day: -1, time: '09:00', professional: 0, service: 'Avaliação inicial', target: 'concluido' },
    { day: -1, time: '11:00', professional: 0, service: 'Retorno', target: 'concluido' },
    { day: -1, time: '14:00', professional: 0, service: 'Consulta', target: 'em_atendimento' },
    { day: -1, time: '09:00', professional: 1, service: 'Consulta', target: 'concluido' },
    { day: -1, time: '15:00', professional: 1, service: 'Retorno', target: 'nao_compareceu' },
    { day: 1, time: '09:00', professional: 0, service: 'Consulta', target: 'confirmado' },
    { day: 1, time: '10:00', professional: 1, service: 'Avaliação inicial', target: 'pendente' },
    { day: 1, time: '11:00', professional: 0, service: 'Retorno', target: 'cancelado' },
  ],
};

/**
 * Chave de uma ficha de demonstração: "<nome do profissional>|<nome do serviço>". Os pares usados pela
 * demonstração são únicos, então a chave identifica o atendimento sem depender de ordem nem de uuid.
 */
function recordKey(professionalName, serviceName) {
  return `${professionalName}|${serviceName}`;
}

/**
 * Conteúdo clínico fictício das fichas de demonstração (ADR-10), por chave de atendimento. Não é dado de
 * paciente real. Só atendimentos em em_atendimento ou concluido têm ficha.
 */
const CLINICAL_RECORD_CONTENT = {
  [recordKey('Profissional Demo 1', 'Avaliação inicial')]: {
    allergies: 'Dipirona',
    medications: 'Losartana 50 mg, uma vez ao dia',
    clinicalNotes: 'Relata cefaleia leve há três dias. Orientado a hidratar-se. Retorno em 30 dias.',
  },
  [recordKey('Profissional Demo 1', 'Retorno')]: {
    allergies: null,
    medications: 'Losartana 50 mg, uma vez ao dia',
    clinicalNotes: 'Retorno de rotina. Pressão arterial estável. Manter medicação atual.',
  },
  [recordKey('Profissional Demo 1', 'Consulta')]: {
    allergies: 'Penicilina',
    medications: 'Vitamina D 2.000 UI, uma vez por semana',
    clinicalNotes: 'Paciente em acompanhamento de rotina. Sem queixas no momento.',
  },
  [recordKey('Profissional Demo 2', 'Consulta')]: {
    allergies: null,
    medications: null,
    clinicalNotes: 'Consulta de rotina sem intercorrências. Plano de acompanhamento combinado.',
  },
};

/**
 * Correção de ficha (ADR-10): registro novo que aponta para o original do atendimento `targetKey`. Alergias
 * e medicações são copiadas do próprio original; só as observações mudam. O texto cita o prazo de 30 dias
 * que está no original de `targetKey`.
 */
const CLINICAL_RECORD_CORRECTION = {
  targetKey: recordKey('Profissional Demo 1', 'Avaliação inicial'),
  clinicalNotes: 'Correção: retorno em 15 dias, e não em 30 como estava registrado.',
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
    operational: CLINICA_OPERATIONAL,
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
 * Retorna { tenantId, userId, created, realigned, divergences }.
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
    return { tenantId: profile.tenant_id, userId: existing.id, created: false, realigned, divergences };
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

  return { tenantId: profile.tenant_id, userId: data.user.id, created: true, realigned: false, divergences: [] };
}

/**
 * Garante o perfil de um usuário de equipe (profissional ou recepção) no tenant do ramo.
 *
 * Todo usuário novo passa pelo trigger de cadastro, que cria um tenant próprio com perfil admin.
 * Este código move o perfil para o tenant do ramo com o papel certo e remove o tenant que o trigger
 * criou. A remoção só acontece se o tenant não tem nome fantasia nem ramo, é do próprio e-mail e
 * tem um único perfil (o do usuário). Qualquer outro caso aborta.
 */
async function attachMemberProfile(admin, tenantId, member, userId) {
  const { data: profile, error } = await admin
    .from('profiles')
    .select('tenant_id, role')
    .eq('id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!profile) {
    throw new Error(
      `usuário ${member.email} existe sem perfil. No banco local, remova esse usuário em auth.users e rode de novo.`,
    );
  }
  if (profile.tenant_id === tenantId) {
    if (profile.role !== member.role) {
      throw new Error(`perfil de ${member.email} com papel ${profile.role}, esperado ${member.role}.`);
    }
    // Falha parcial de execução anterior: o perfil já foi movido e o tenant do cadastro pode ter sobrado.
    await removeLeftoverSignupTenants(admin, tenantId, member);
    return;
  }

  if (profile.role !== 'admin' || !profile.tenant_id) {
    throw new Error(`perfil de ${member.email} fora do esperado (papel ou tenant ausente).`);
  }
  const { data: ownTenant, error: tenantError } = await admin
    .from('tenants')
    .select('id, trade_name, segment, owner_email')
    .eq('id', profile.tenant_id)
    .single();
  if (tenantError) throw tenantError;
  if (ownTenant.trade_name !== null || ownTenant.segment !== null || ownTenant.owner_email !== member.email) {
    throw new Error(
      `perfil de ${member.email} pertence a outro tenant. O seed não move esse perfil. Remova o usuário em auth.users e rode de novo.`,
    );
  }
  const { count, error: countError } = await admin
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', ownTenant.id);
  if (countError) throw countError;
  if (count !== 1) {
    throw new Error(`tenant de ${member.email} tem outros perfis. O seed não remove esse tenant.`);
  }

  const { error: moveError } = await admin
    .from('profiles')
    .update({ tenant_id: tenantId, role: member.role })
    .eq('id', userId);
  if (moveError) throw moveError;
  const { error: deleteError } = await admin.from('tenants').delete().eq('id', ownTenant.id);
  if (deleteError) throw deleteError;
}

/**
 * Remove tenants do cadastro do próprio membro que sobraram de uma execução interrompida entre mover o
 * perfil e apagar o tenant. Só apaga tenant do e-mail do membro, sem nome fantasia, sem ramo e sem perfil
 * (o perfil já foi movido). Qualquer outro caso aborta.
 */
async function removeLeftoverSignupTenants(admin, tenantId, member) {
  const { data: candidates, error } = await admin
    .from('tenants')
    .select('id')
    .eq('owner_email', member.email)
    .is('trade_name', null)
    .is('segment', null)
    .neq('id', tenantId);
  if (error) throw error;

  for (const candidate of candidates) {
    const { count, error: countError } = await admin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', candidate.id);
    if (countError) throw countError;
    if (count !== 0) {
      throw new Error(`tenant de ${member.email} tem perfis. O seed não remove esse tenant.`);
    }
    const { error: deleteError } = await admin.from('tenants').delete().eq('id', candidate.id);
    if (deleteError) throw deleteError;
  }
}

/**
 * Garante um usuário de equipe do ramo. Usuário novo é criado e recebe o perfil do ramo. Usuário
 * existente mantém a senha, salvo com realignPassword. Retorna o id do usuário (igual ao profiles.id).
 */
async function ensureTenantMember(admin, tenantId, member, { password, realignPassword }) {
  const existing = await findUserByEmail(admin, member.email);
  if (existing) {
    await attachMemberProfile(admin, tenantId, member, existing.id);
    if (realignPassword) {
      const { error } = await admin.auth.admin.updateUserById(existing.id, { password });
      if (error) throw error;
    }
    return existing.id;
  }

  const { data, error } = await admin.auth.admin.createUser({
    email: member.email,
    password,
    email_confirm: true,
    user_metadata: { full_name: member.fullName },
  });
  if (error) throw error;
  await attachMemberProfile(admin, tenantId, member, data.user.id);
  return data.user.id;
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

/**
 * Dia de atendimento para um deslocamento `offset` a partir de `today`. Se cair fora de WEEK_DAYS
 * (domingo), anda no sentido do offset até o dia de grade: offset negativo retrocede (domingo vai
 * para sábado), offset positivo avança (domingo vai para segunda). Como offsets negativos ficam
 * sempre antes de hoje e positivos sempre depois, um dia de passado nunca vira hoje ou futuro.
 */
function workdayFor(today, offset) {
  const step = offset < 0 ? -1 : 1;
  let current = addDays(today, offset);
  while (!WEEK_DAYS.includes(new Date(`${current}T00:00:00Z`).getUTCDay())) {
    current = addDays(current, step);
  }
  return current;
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

/**
 * Cliente demo pela chave natural (tenant_id, phone). O telefone é E.164-BR de 13 dígitos (+55, DDD 00
 * reservado para ficção, 9 + 8 dígitos), o mesmo formato que `toE164BR` devolve na UI. Assim, editar o
 * cliente pela UI e rodar o seed de novo não cria duplicata.
 * Linha gravada pela versão anterior do seed (telefone de 10 dígitos após o `+`) é migrada para o
 * telefone canônico, identificada pelo nome. Só migra se o telefone canônico ainda não existir.
 */
async function findOrCreateCustomer(admin, tenantId, spec, index) {
  const seq = String(index + 1).padStart(3, '0');
  const name = `Cliente ${spec.label} ${String(index + 1).padStart(2, '0')}`;
  const phone = `+550090000${spec.phoneSegmentDigit}${seq}`;
  const legacyPhone = `+550000${spec.phoneSegmentDigit}${seq}`;

  const { data: canonical, error } = await admin
    .from('customers')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('phone', phone)
    .limit(1);
  if (error) throw error;

  if (canonical.length === 0) {
    const { error: migrateError } = await admin
      .from('customers')
      .update({ phone })
      .eq('tenant_id', tenantId)
      .eq('name', name)
      .eq('phone', legacyPhone);
    if (migrateError) throw migrateError;
  }

  return findOrCreate(admin, 'customers', { tenant_id: tenantId, phone }, { name, whatsapp_opt_in: false });
}

/** Vínculo N:N ou taxa: insere se não existir e mantém o que já existe (ON CONFLICT DO NOTHING). */
async function linkIgnoringDuplicates(admin, table, row, onConflict) {
  const { error } = await admin.from(table).upsert(row, { onConflict, ignoreDuplicates: true });
  if (error) throw error;
}

/**
 * Resume os agendamentos do tenant: quantidade por status (Map(status -> quantidade)) e quantos
 * confirmados não têm confirmed_via = 'manual', que é a origem que o seed grava.
 */
async function summarizeAppointments(admin, tenantId) {
  const { data, error } = await admin
    .from('appointments')
    .select('status, confirmed_via')
    .eq('tenant_id', tenantId);
  if (error) throw error;
  const counts = new Map();
  let confirmedWithoutManual = 0;
  for (const { status, confirmed_via } of data) {
    counts.set(status, (counts.get(status) ?? 0) + 1);
    if (status === 'confirmado' && confirmed_via !== 'manual') confirmedWithoutManual += 1;
  }
  return { counts, confirmedWithoutManual };
}

/** Distribuição de status esperada pela demonstração: quantidade por estado final (target) da spec. */
function expectedStatusCounts(spec) {
  const counts = new Map();
  for (const appt of spec.appointments) {
    counts.set(appt.target, (counts.get(appt.target) ?? 0) + 1);
  }
  return counts;
}

/** Compara dois Map(status -> quantidade) e diz se são iguais. Status ausente conta como zero. */
function sameStatusCounts(actual, expected) {
  const statuses = new Set([...actual.keys(), ...expected.keys()]);
  return [...statuses].every((status) => (actual.get(status) ?? 0) === (expected.get(status) ?? 0));
}

/**
 * Cria a agenda de demonstração do tenant.
 * - Tenant sem agendamento: cria a agenda inteira.
 * - Tenant com a quantidade, a distribuição de status e a origem da confirmação (confirmed_via 'manual'
 *   em todo confirmado) da demonstração: pula a etapa (null).
 * - Quantidade igual mas status diferentes: lança erro. Uma transição que falhou depois do insert deixa
 *   o agendamento em 'pendente' com a contagem certa; sem essa conferência, a reexecução aceitaria.
 *   Mudança de status feita pela UI também cai aqui, e a reexecução falha por desenho.
 * - Quantidade igual, status certos, mas confirmado sem confirmed_via 'manual': lança erro. Base gravada
 *   por versão anterior do seed.
 * - Qualquer outra quantidade: lança erro sem gravar nada. Isso acontece quando uma execução anterior
 *   parou no meio, ou quando a UI criou ou removeu agendamento; o tenant precisa ser limpo antes de rodar de novo.
 * Cada agendamento nasce em 'pendente' e avança pelas transições válidas, para que o trigger de
 * máquina de estados e o de comissão rodem como em produção.
 * Retorna a quantidade criada, ou null se a etapa foi pulada.
 */
async function seedAppointments(admin, tenantId, spec, refs) {
  const { counts: actual, confirmedWithoutManual } = await summarizeAppointments(admin, tenantId);
  const current = [...actual.values()].reduce((total, n) => total + n, 0);
  const expected = spec.appointments.length;
  if (current === expected) {
    if (!sameStatusCounts(actual, expectedStatusCounts(spec))) {
      throw new Error(
        `o tenant ${spec.label} já tem ${expected} agendamentos, mas os status não batem com a demonstração. Uma execução anterior pode ter parado no meio, ou um status foi alterado manualmente pela UI. Apague os agendamentos desse tenant no banco local e rode de novo.`,
      );
    }
    if (confirmedWithoutManual > 0) {
      throw new Error(
        `o tenant ${spec.label} tem ${confirmedWithoutManual} agendamento(s) confirmado(s) sem confirmed_via = 'manual', gravados por uma versão anterior do seed. Apague os agendamentos desse tenant no banco local e rode de novo.`,
      );
    }
    return null;
  }
  if (current > 0) {
    throw new Error(
      `o tenant ${spec.label} tem ${current} agendamentos, e a demonstração prevê ${expected}. Uma execução anterior pode ter parado no meio, ou um agendamento foi criado ou removido pela UI. Apague os agendamentos desse tenant no banco local e rode de novo.`,
    );
  }

  const today = todayInTimezone(TIMEZONE);
  let created = 0;
  for (const [index, appt] of spec.appointments.entries()) {
    const line = appt.combo ? refs.combos.get(appt.combo) : refs.services.get(appt.service);
    const startsAt = instantAt(workdayFor(today, appt.day), appt.time);
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
      // Confirmação feita pela recepção/UI grava a origem junto da transição para 'confirmado'.
      const patch = status === 'confirmado' ? { status, confirmed_via: 'manual' } : { status };
      const { error: stepError } = await admin
        .from('appointments')
        .update(patch)
        .eq('id', inserted.id);
      if (stepError) throw stepError;
    }
    created += 1;
  }
  return created;
}

/**
 * Fichas de demonstração (ADR-10). Cada atendimento em em_atendimento ou concluido ganha um registro
 * original, com conteúdo pela chave profissional|serviço. O atendimento CLINICAL_RECORD_CORRECTION.targetKey
 * recebe uma correção (registro novo que aponta para o original; nunca UPDATE, que a ADR-07 bloqueia).
 *
 * Service role ignora RLS e não tem JWT, então tenant_id e created_by são passados explicitamente.
 * Autor: o profissional com login, no próprio atendimento; sem login, o admin do ramo.
 * Idempotente: original por (tenant_id, appointment_id) sem supersedes_id; correção por supersedes_id.
 * Retorna { originals, corrections } com a quantidade criada nesta execução.
 */
async function seedClinicalRecords(admin, tenantId, { adminUserId }) {
  const { data: professionals, error: profError } = await admin
    .from('professionals')
    .select('id, name, profile_id')
    .eq('tenant_id', tenantId);
  if (profError) throw profError;
  const professionalById = new Map(professionals.map((p) => [p.id, p]));

  const { data: services, error: servicesError } = await admin
    .from('services')
    .select('id, name')
    .eq('tenant_id', tenantId);
  if (servicesError) throw servicesError;
  const serviceNameById = new Map(services.map((s) => [s.id, s.name]));

  const { data: appointments, error } = await admin
    .from('appointments')
    .select('id, customer_id, professional_id, service_id, status')
    .eq('tenant_id', tenantId)
    .in('status', ['em_atendimento', 'concluido'])
    .order('starts_at', { ascending: true })
    .order('id', { ascending: true });
  if (error) throw error;

  let originals = 0;
  let corrections = 0;
  let correctionTarget = null;
  for (const appt of appointments) {
    const professional = professionalById.get(appt.professional_id);
    const serviceName = serviceNameById.get(appt.service_id);
    if (!professional || !serviceName) {
      throw new Error(`atendimento ${appt.id} sem profissional ou serviço para a ficha de demonstração.`);
    }
    const key = recordKey(professional.name, serviceName);
    const authorId = professional.profile_id ?? adminUserId;

    const { data: existing, error: findError } = await admin
      .from('clinical_records')
      .select('id, allergies, medications')
      .eq('tenant_id', tenantId)
      .eq('appointment_id', appt.id)
      .is('supersedes_id', null)
      .limit(1);
    if (findError) throw findError;

    let original = existing[0];
    if (!original) {
      const content = CLINICAL_RECORD_CONTENT[key];
      if (!content) {
        throw new Error(`sem conteúdo de ficha de demonstração para "${key}".`);
      }
      const { data: inserted, error: insertError } = await admin
        .from('clinical_records')
        .insert({
          tenant_id: tenantId,
          customer_id: appt.customer_id,
          appointment_id: appt.id,
          allergies: content.allergies,
          medications: content.medications,
          clinical_notes: content.clinicalNotes,
          created_by: authorId,
        })
        .select('id, allergies, medications')
        .single();
      if (insertError) throw insertError;
      original = inserted;
      originals += 1;
    }

    if (key === CLINICAL_RECORD_CORRECTION.targetKey) {
      if (appt.status !== 'concluido') {
        throw new Error(`atendimento alvo da correção "${key}" não está concluído.`);
      }
      correctionTarget = { original, appt, authorId };
    }
  }

  if (!correctionTarget) {
    throw new Error(`atendimento alvo da correção "${CLINICAL_RECORD_CORRECTION.targetKey}" não encontrado.`);
  }

  const { original, appt, authorId } = correctionTarget;
  const { data: corrected, error: corrError } = await admin
    .from('clinical_records')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('supersedes_id', original.id)
    .limit(1);
  if (corrError) throw corrError;
  if (corrected.length === 0) {
    const { error: insertError } = await admin.from('clinical_records').insert({
      tenant_id: tenantId,
      customer_id: appt.customer_id,
      appointment_id: appt.id,
      supersedes_id: original.id,
      allergies: original.allergies,
      medications: original.medications,
      clinical_notes: CLINICAL_RECORD_CORRECTION.clinicalNotes,
      created_by: authorId,
    });
    if (insertError) throw insertError;
    corrections += 1;
  }

  return { originals, corrections };
}

/**
 * Profissional demo pela chave natural (tenant_id, name), com o vínculo de login (profile_id) conferido.
 * Linha nova recebe o vínculo no insert. Linha existente sem vínculo recebe o vínculo esperado. Vínculo
 * diferente do esperado (inclusive vínculo onde o seed não espera nenhum) lança erro: senão o seed
 * terminaria com sucesso sem o login funcionar. Retorna o id do profissional.
 */
async function ensureProfessional(admin, tenantId, name, profileId) {
  const { data, error } = await admin
    .from('professionals')
    .select('id, profile_id')
    .eq('tenant_id', tenantId)
    .eq('name', name)
    .limit(1);
  if (error) throw error;

  if (data.length === 0) {
    const { data: inserted, error: insertError } = await admin
      .from('professionals')
      .insert({ tenant_id: tenantId, name, profile_id: profileId })
      .select('id')
      .single();
    if (insertError) throw insertError;
    return inserted.id;
  }

  const row = data[0];
  if (row.profile_id === profileId) return row.id;
  if (row.profile_id !== null) {
    throw new Error(
      `profissional "${name}" já está vinculado a outro usuário. O seed não troca esse vínculo. Ajuste o profissional no banco local e rode de novo.`,
    );
  }
  const { error: updateError } = await admin.from('professionals').update({ profile_id: profileId }).eq('id', row.id);
  if (updateError) throw updateError;
  return row.id;
}

/**
 * Semeia profissionais, grade, comissão, serviços, combos, clientes, agenda e, se o ramo tiver,
 * fichas. `memberIds` mapeia a chave de `spec.members` para o id do usuário de login.
 * Retorna { appointmentsCreated, records }. appointmentsCreated é null se a agenda já existia; records
 * é null se o ramo não tem fichas.
 */
async function seedOperational(admin, tenantId, spec, { memberIds, adminUserId }) {
  const professionals = [];
  for (const prof of spec.professionals) {
    const profileId = prof.member ? memberIds[prof.member] : null;
    const professionalId = await ensureProfessional(admin, tenantId, prof.name, profileId);
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
    customers.push(await findOrCreateCustomer(admin, tenantId, spec, i));
  }

  const appointmentsCreated = await seedAppointments(admin, tenantId, spec, {
    professionals,
    services,
    combos,
    customers,
  });
  const records = spec.clinicalRecords ? await seedClinicalRecords(admin, tenantId, { adminUserId }) : null;
  return { appointmentsCreated, records };
}

/**
 * Semeia um ramo: tenant e admin, e, se houver, os dados operacionais. Lança erro se o ramo não puder
 * ser semeado com segurança; quem chama decide o que fazer com os demais ramos.
 */
async function seedTenant(admin, def, { password, realignPassword }) {
  const { tenantId, userId: adminUserId, created, realigned, divergences } = await ensureTenantAdmin(admin, def, {
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

  if (!def.operational) return;
  if (divergences.length > 0) {
    // Não grava dados operacionais em tenant fora do padrão: preserva o estado de teste escolhido.
    console.warn(`dados operacionais (${def.segment}): não semeados, tenant fora do padrão de demonstração.`);
    return;
  }
  const memberIds = {};
  for (const member of def.operational.members ?? []) {
    memberIds[member.key] = await ensureTenantMember(admin, tenantId, member, { password, realignPassword });
  }
  const { appointmentsCreated, records } = await seedOperational(admin, tenantId, def.operational, {
    memberIds,
    adminUserId,
  });
  const detail =
    appointmentsCreated === null
      ? 'agenda já existente, etapa pulada'
      : `${appointmentsCreated} agendamentos criados`;
  console.log(`dados operacionais (${def.segment}): ${detail}`);
  if (records) {
    console.log(
      `fichas (${def.segment}): ${records.originals} originais e ${records.corrections} correção(ões) criadas nesta execução`,
    );
  }
}

async function main() {
  const { supabaseUrl, password, serviceRoleKey, realignPassword } = readConfig(process.env);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Um ramo com erro não interrompe os demais. Os erros ficam visíveis e o código de saída indica a falha.
  const failedSegments = [];
  for (const def of DEMO_TENANTS) {
    try {
      await seedTenant(admin, def, { password, realignPassword });
    } catch (err) {
      failedSegments.push(def.segment);
      console.error(`Falha no ramo ${def.segment}: ${err.message ?? err}`);
    }
  }
  if (failedSegments.length > 0) {
    fail(`seed concluído com falha nos ramos: ${failedSegments.join(', ')}.`);
  }
}

main().catch((err) => {
  console.error(`Falha no seed: ${err.message ?? err}`);
  process.exit(1);
});
