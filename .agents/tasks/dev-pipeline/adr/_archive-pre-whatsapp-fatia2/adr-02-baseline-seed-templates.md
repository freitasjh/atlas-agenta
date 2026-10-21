# ADR-02 — Baseline/seed dos 4 templates padrão por tenant

**Status:** proposto

**Escopo:** dados

**Depende de:** ADR-01 (a tabela `message_templates` precisa existir antes do seed).

## Contexto

Um tenant nunca pode começar sem templates: a tela (ADR-06) e a renderização no envio (ADR-04)
assumem a existência das 4 chaves por tenant. O PRD (RF-T02 / AC-02) exige que **tenant novo nasça
com exatamente 4 linhas** e que **tenants existentes** sejam backfilled de forma **idempotente**
(re-executar não duplica). O signup atômico server-side já existe em
`20250216092000_signup_trigger.sql` (`handle_new_user()`, `after insert on auth.users`, security
definer) — a baseline deve se acoplar a esse fluxo sem editar a migration antiga (RNF-T04): recriar
`handle_new_user` com `create or replace` numa migration nova.

Os textos padrão em pt-BR usam a lista fechada de variáveis da fatia (`{nome} {servico} {dataHora}
{empresa}`). O `lembrete_d1` já comporta o texto livre `1 confirmar / 2 reagendar` para **preparar**
a Fatia 2 (confirmação interativa numérica) **sem** acoplar webhook/cron/parsing agora (RF-T09 /
AC-09). `{valor}` fica fora (decisão D4 do PRD — depende do módulo Asaas).

## Decisão

Criar **uma segunda migration nova** `supabase/migrations/<timestamp>_message_templates_baseline.sql`
(timestamp posterior ao da ADR-01), com três responsabilidades, todas idempotentes:

1. **Função `seed_message_templates(p_tenant_id uuid)`** `security definer`, `set search_path =
   public`: insere as 4 chaves com os textos padrão pt-BR, `on conflict (tenant_id, template_key)
   do nothing`. Roda fora do RLS (como as demais funções de signup).
2. **`create or replace function handle_new_user()`** reproduzindo o corpo atual
   (`20250216092000_signup_trigger.sql`) **e** acrescentando, após o `insert into profiles`, uma
   chamada `perform seed_message_templates(v_tenant_id);` — no mesmo fluxo atômico do signup. Não
   recriar o trigger `on_auth_user_created` (continua válido apontando para a mesma função). Copiar
   o corpo existente fielmente para não regredir a criação de tenant/profile.
3. **Backfill idempotente para tenants existentes:** `insert into message_templates (tenant_id,
   template_key, body) select t.id, k.key, k.body from tenants t cross join (values ...4 chaves...)
   as k(key, body) on conflict (tenant_id, template_key) do nothing;`.

Textos padrão pt-BR (redação final desta ADR; manter as variáveis exatamente assim):

```
confirmacao:  "Olá {nome}! Seu horário de {servico} na {empresa} está marcado para {dataHora}."
lembrete_d1:  "Oi {nome}, lembrete do seu {servico} na {empresa} em {dataHora}. Responda 1 para confirmar ou 2 para reagendar."
cobranca:     "Olá {nome}, segue a cobrança do seu {servico} na {empresa}."
comprovante:  "Recebemos o pagamento do seu {servico} na {empresa}. Obrigado, {nome}!"
```

## Consequências

- Tenant novo nasce com as 4 linhas no mesmo passo do signup (sem janela de tenant sem template).
- Tenants legados ganham as 4 linhas ao aplicar a migration; o re-apply não duplica.
- Se, por qualquer motivo, uma linha faltar em runtime, o servidor (ADR-04) ainda tem o fallback de
  "texto de sistema padrão" — a baseline zera esse caso, o fallback é a rede de segurança.
- A migration é a única dona da redação padrão; a UI (ADR-06) nunca inventa o texto inicial.

## Arquivos afetados

- `supabase/migrations/<timestamp>_message_templates_baseline.sql` (novo)

## Critérios de aceite (testáveis nesta ADR)

- **AC-02 (tenant novo):** após `supabase db reset`, criar um usuário via signup (ou executar o
  fluxo `handle_new_user`) → o tenant novo tem **exatamente 4 linhas** em `message_templates` (uma
  por chave), textos pt-BR não vazios. Verificar com `select template_key, body from
  message_templates where tenant_id = '<novo>'` (4 linhas).
- **AC-02 (idempotência/backfill):** re-executar o backfill (re-run do `db reset`, ou chamar
  `seed_message_templates` de novo para um tenant que já tem as 4) **não** cria duplicatas:
  `select tenant_id, template_key, count(*) from message_templates group by 1,2 having count(*) > 1`
  retorna 0 linhas.
- **`handle_new_user` preservado:** o signup continua criando `tenants` + `profiles` admin como
  antes (nenhuma regressão no fluxo existente) — verificável pelo mesmo teste de signup usado hoje.
- **Fatia 2 não antecipada (AC-09):** o `lembrete_d1` contém `1 confirmar / 2 reagendar` como texto
  livre; nenhum endpoint/cron/parsing é adicionado (ausência de arquivos correspondentes).
