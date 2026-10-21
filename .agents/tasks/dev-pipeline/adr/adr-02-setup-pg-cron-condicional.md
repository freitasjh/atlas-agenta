# ADR-02 — Setup de pg_cron versionado e condicional (não quebrar o db reset local)

**Status:** proposto
**Escopo:** dados (Supabase/Postgres — migration de infra de agendamento)
**Depende de:** adr-01 (as funções SQL agendadas operam sobre as tabelas/campos criados lá)

## Contexto

O lembrete D-1 (ADR-04) e o worker de retentativa (ADR-05) precisam rodar **periodicamente** sem
ninguém clicar. A decisão do PRD (§7, ponto 6, e confirmação do humano) é usar **pg_cron**,
versionado em migration. O problema prático: `pg_cron` é uma extensão que **existe no Supabase
hosted** mas pode **não existir** no Postgres do `supabase db reset` local (Docker), o que
quebraria o reset de todo o projeto — inaceitável (R21).

Além do agendamento, é preciso decidir **como o cron invoca** a lógica. Duas opções (PRD §7):
- (a) função SQL `security definer` chamada direto pelo `cron.schedule` (roda dentro do banco);
- (b) `pg_net` fazendo POST para a Edge Function.

## Decisão

1. **Invocação = função SQL `security definer` (Opção a).** O lembrete D-1 (ADR-04) e o worker de
   retentativa (ADR-05) são expostos como **funções SQL** que o `cron.schedule` chama diretamente.
   Justificativa: (i) toda a lógica de elegibilidade e enfileiramento é SQL/dados — não precisa sair
   do banco; (ii) evita depender de `pg_net` + segredo de service role embutido no SQL do cron
   (menos superfície de segredo, coerente com "segredos fora do versionado"); (iii) o envio físico
   via Evolution continua responsabilidade de quem drena a fila (o worker de retentativa processa
   `messages.status='fila'`), mantendo o adapter atrás da porta. **Consequência aceita:** o
   disparo real pela Evolution a partir do cron puro-SQL não chama a Edge Function; o worker
   (ADR-05) é quem concretiza o envio. Esta ADR cria só a INFRA de agendamento; as funções
   agendadas são escritas em ADR-04/05 e aqui só referenciadas pelos nomes acordados
   (`whatsapp_enqueue_lembrete_d1()`, `whatsapp_process_retry_queue()`).

2. **Condicionalidade para não quebrar `db reset`.** A migration usa um bloco `DO $$ ... $$` que:
   - tenta `create extension if not exists pg_cron;` dentro de um `begin ... exception when others
     then raise notice ...` — se a extensão não estiver disponível no ambiente, **não falha** o
     reset, só emite `notice` e segue;
   - só registra os jobs (`cron.schedule(...)`) **se** `pg_cron` estiver de fato instalado
     (checar `pg_extension` / `to_regproc('cron.schedule')` não-nulo antes de chamar). Em ambiente
     sem a extensão, os jobs simplesmente não são agendados, e o SQL de lembrete/retentativa
     (ADR-04/05) continua **testável chamando a função manualmente** (é o caminho de verificação
     documentado no PRD §3: "testar cron/retentativa pela lógica quando o scheduler real não
     estiver disponível").
   - o agendamento é **idempotente**: antes de `cron.schedule`, remover um job homônimo prévio
     (`cron.unschedule` por nome, tolerando ausência) para o re-apply não duplicar.

3. **Granularidade do cron (resolve PRD §7).**
   - Lembrete D-1: job a cada **15 minutos** (`*/15 * * * *`). A varredura é barata (índice) e 15min
     dá folga para a janela de 23h–25h sem spam.
   - Worker de retentativa: a cada **5 minutos** (`*/5 * * * *`), respeitando `next_attempt_at`.
   - Os nomes dos jobs: `atlas_lembrete_d1` e `atlas_retry_queue`.

4. **Nenhum segredo no SQL.** As funções agendadas rodam com os privilégios do owner (security
   definer) e operam só no banco; não há token/chave no SQL do cron.

## Consequências

- `supabase db reset` local roda limpo **com ou sem** `pg_cron` (R21). Onde a extensão não existe,
  os jobs não são criados, mas as funções `whatsapp_enqueue_lembrete_d1()` /
  `whatsapp_process_retry_queue()` (ADR-04/05) existem e podem ser chamadas manualmente para teste.
- O ambiente hosted do Supabase (onde `pg_cron` existe) agenda os dois jobs automaticamente ao
  aplicar as migrations.
- Decisão registrada para o brain: cron por função SQL `security definer` (não `pg_net`), com
  guard condicional de extensão — é a primeira vez que o projeto versiona pg_cron.

## Arquivos afetados

- `supabase/migrations/20250223094000_pg_cron_setup.sql` (novo — extensão condicional + agendamento
  dos dois jobs, idempotente). As FUNÇÕES agendadas são definidas nas migrations de ADR-04/05; se o
  coder preferir, o `cron.schedule` pode viver na mesma migration que define a função (ADR-04/05) em
  vez de aqui — nesse caso esta ADR cria só a extensão condicional e um comentário-contrato. O coder
  decide, mantendo: (i) extensão condicional sem quebrar reset; (ii) agendamento idempotente.

## Critérios de aceite testáveis (desta ADR)

1. `supabase db reset` em ambiente **sem** pg_cron aplica a migration sem erro (exit 0): emite
   `notice` de extensão ausente e não agenda jobs.
2. Em ambiente **com** pg_cron, a migration cria os dois jobs (`atlas_lembrete_d1`,
   `atlas_retry_queue`) com os cron expressions acordados; re-aplicar não duplica (unschedule prévio).
3. O bloco é idempotente: segundo `db reset` não falha por job/extensão já existente.
4. Nenhum segredo (service role/token) aparece no arquivo de migration.

## Verificação

- `cd <worktree> && supabase db reset` → exit 0 (duas vezes). Procurar no output o `notice` quando a
  extensão não existe.
- Em ambiente com pg_cron: `select jobname, schedule from cron.job;` lista os dois jobs uma única vez.
