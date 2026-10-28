#!/usr/bin/env node
/**
 * seed-demo.mjs: base de exemplo local, parte 1 (ADR-08).
 *
 * Cria um tenant por ramo (barbearia, salão e clínica), com um usuário administrador em cada um.
 * Idempotente e não destrutivo: rodar de novo cria só o que falta. Tenant e senha de um usuário
 * já existente não são alterados, para preservar estados de teste (ex.: tenant bloqueado).
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
 * - Dados fictícios. Nada aqui é dado real de cliente.
 */
import { createClient } from '@supabase/supabase-js';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);
const MIN_PASSWORD_LENGTH = 6;
const TIMEZONE = 'America/Sao_Paulo';

/** Estado de demonstração do tenant. Usado para avisar quando um tenant reaproveitado diverge dele. */
const DEMO_TENANT_STATE = { plan: 'pro', subscription_status: 'ativo', trial_ends_at: null };

const DEMO_TENANTS = [
  {
    segment: 'barbearia',
    tradeName: 'Barbearia Demo',
    phone: '(00) 00000-0001',
    admin: { email: 'admin.barbearia@demo.invalido', fullName: 'Admin Demo Barbearia' },
  },
  {
    segment: 'salao',
    tradeName: 'Salão Demo',
    phone: '(00) 00000-0002',
    admin: { email: 'admin.salao@demo.invalido', fullName: 'Admin Demo Salão' },
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
 * - 'orphan': há tenant, mas nenhum tem perfil admin (sobrou de remoção do usuário).
 * - 'owned': algum tenant tem perfil admin. Pertence a outro cadastro, então nunca se sugere remoção.
 */
async function classifyNaturalKeyTenants(admin, def) {
  const tenants = await findTenantsByNaturalKey(admin, def);
  if (tenants.length === 0) return 'none';

  const { data, error } = await admin
    .from('profiles')
    .select('tenant_id')
    .in('tenant_id', tenants.map((tenant) => tenant.id))
    .eq('role', 'admin')
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
      `usuário ${def.admin.email} existe sem perfil. Remova o usuário e o tenant "${def.tradeName}" (${def.segment}) no banco local e rode de novo.`,
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
 * Retorna { created, realigned, divergences }.
 */
async function ensureTenantAdmin(admin, def, { password, realignPassword }) {
  const existing = await findUserByEmail(admin, def.admin.email);

  if (existing) {
    let realigned = false;
    if (realignPassword) {
      const { error } = await admin.auth.admin.updateUserById(existing.id, { password });
      if (error) throw error;
      realigned = true;
    }
    const profile = await loadAdminProfile(admin, def, existing.id);
    const divergences = await findDemoDivergences(admin, profile.tenant_id, def);
    return { created: false, realigned, divergences };
  }

  // Criar de novo duplicaria a empresa. Só órfão (sem admin) aceita limpeza manual; outro dono, não.
  const naturalKeyState = await classifyNaturalKeyTenants(admin, def);
  if (naturalKeyState === 'owned') {
    throw new Error(
      `já existe tenant "${def.tradeName}" (${def.segment}) com administrador cadastrado, diferente de ${def.admin.email}. O seed não reaproveita nem altera esse tenant. Use outro nome fantasia nos dados de teste.`,
    );
  }
  if (naturalKeyState === 'orphan') {
    throw new Error(
      `tenant "${def.tradeName}" (${def.segment}) existe sem usuário administrador. Remova a linha órfã em tenants no banco local e rode de novo.`,
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

  return { created: true, realigned: false, divergences: [] };
}

async function main() {
  const { supabaseUrl, password, serviceRoleKey, realignPassword } = readConfig(process.env);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  for (const def of DEMO_TENANTS) {
    const { created, realigned, divergences } = await ensureTenantAdmin(admin, def, {
      password,
      realignPassword,
    });
    const status = created ? 'criado' : 'reaproveitado (estado preservado)';
    const suffix = realigned ? ', senha realinhada' : '';
    console.log(`${status}: ${def.segment} (${def.admin.email})${suffix}`);
    if (divergences.length > 0) {
      // Não corrige nada: pode ser estado de teste intencional ou falha parcial de uma execução anterior.
      console.warn(
        `ATENÇÃO: tenant ${def.segment} fora do padrão de demonstração (${divergences.join(', ')}). ` +
          'Se não for estado de teste intencional, corrija no banco local ou remova o usuário e o tenant e rode de novo.',
      );
    }
  }
}

main().catch((err) => {
  console.error(`Falha no seed: ${err.message ?? err}`);
  process.exit(1);
});
