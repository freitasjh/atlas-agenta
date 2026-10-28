#!/usr/bin/env node
/**
 * seed-demo.mjs: base de exemplo local, parte 1 (ADR-08).
 *
 * Cria um tenant por ramo (barbearia, salão e clínica), com um usuário administrador em cada um.
 * Idempotente: rodar de novo reaproveita tenants e usuários, sem duplicar.
 *
 * Uso (somente com `supabase start` local):
 *   ATLAS_DEMO_SEED=1 \
 *   SUPABASE_URL=http://127.0.0.1:54321 \
 *   SUPABASE_SERVICE_ROLE_KEY=<service role local> \
 *   ATLAS_DEMO_PASSWORD=<6+ caracteres> \
 *   node scripts/seed-demo.mjs
 *
 * Segurança:
 * - Service role e senha vêm só do ambiente. Nunca são impressas nem gravadas em arquivo.
 * - Recusa qualquer host que não seja 127.0.0.1 ou localhost, antes de qualquer requisição.
 * - E-mails usam o domínio reservado `.invalido` (RFC 2606), exigido pela guarda do harness pgTAP.
 * - Dados fictícios. Nada aqui é dado real de cliente.
 */
import { createClient } from '@supabase/supabase-js';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);
const MIN_PASSWORD_LENGTH = 6;
const TIMEZONE = 'America/Sao_Paulo';

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

  return { supabaseUrl, password, serviceRoleKey };
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

/**
 * Garante o tenant e o admin de um ramo.
 * A criação do usuário dispara o trigger handle_new_user, que cria tenant + profile admin
 * e os templates de mensagem do ramo. Depois ajustamos o tenant para o padrão de demonstração.
 */
async function ensureTenantAdmin(admin, def, password) {
  let user = await findUserByEmail(admin, def.admin.email);
  const created = user === null;

  if (created) {
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
    user = data.user;
  } else {
    // Mantém a senha alinhada ao ambiente atual, para o login por papel continuar funcionando.
    const { error } = await admin.auth.admin.updateUserById(user.id, { password });
    if (error) throw error;
  }

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('tenant_id, role')
    .eq('id', user.id)
    .single();
  if (profileError) throw profileError;
  if (profile.role !== 'admin' || !profile.tenant_id) {
    throw new Error(`perfil de ${def.admin.email} fora do esperado (papel ou tenant ausente).`);
  }

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

  return { created, tenantId: profile.tenant_id };
}

async function main() {
  const { supabaseUrl, password, serviceRoleKey } = readConfig(process.env);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  for (const def of DEMO_TENANTS) {
    const { created } = await ensureTenantAdmin(admin, def, password);
    console.log(`${created ? 'criado' : 'reaproveitado'}: ${def.segment} (${def.admin.email})`);
  }
}

main().catch((err) => {
  console.error(`Falha no seed: ${err.message ?? err}`);
  process.exit(1);
});
