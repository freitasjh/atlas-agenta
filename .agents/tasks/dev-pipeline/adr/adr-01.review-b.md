# Review B — ADR-01: Migrations aditivas da Fatia 2 (webhook_events, confirmed_via, retentativa, reagendar_retorno)

Revisor independente B. Modelo diferente do revisor A, sem acesso ao parecer dele. Escopo: o commit `b608a6d` na branch `feat/adr-01-migrations-fatia2-whatsapp` (base `origin/master`), restrito às 4 migrations SQL novas. As mudanças em `.agents/` são documentos de planejamento e ficam fora do code review.

Quatro migrations aditivas montam a fundação de schema da Fatia 2: `webhook_events` (idempotência + auditoria de entrada), `appointments.confirmed_via` (origem da confirmação), 4 campos de retentativa em `messages`, e a 5ª chave de template `reagendar_retorno` com paridade em CHECKs + seed + backfill. Todas respeitam a regra de nunca editar migration aplicada, usam `if not exists` / blocos `do $$` com checagem de `pg_constraint` / `on conflict do nothing` para idempotência, e não recriam helpers existentes. Rodei a contraprova real contra o Postgres local (Supabase CLI + Docker disponíveis): `db reset` aplica as 20 migrations limpo, build/typecheck/vitest verdes, e exercitei empiricamente os invariantes (dedupe, CHECK de `confirmed_via`, FK composta cross-tenant, RLS por papel).

**Watch for:** nenhuma questão bloqueante. Um ponto de atenção não-bloqueante (possible): o `db reset` falhou na 1ª repetição com `error running container: exit 1` durante o bootstrap do Realtime da própria CLI (não nas migrations); re-rodar com `--debug` aplicou tudo limpo — é flapping de container, não defeito do SQL. Registrado para o QA (ADR-07) confirmar num ambiente estável.

**Verdict**: APPROVED

## High-level view

A substituição dos CHECKs auto-nomeados (`messages_template_check`, `message_templates_template_key_check`) por CHECKs nomeados com as 5 chaves é o ponto mais delicado da ADR, e está correto: o drop usa o nome real que o Postgres gera para constraint inline de coluna, guardado por `if exists`, e o add é guardado por `not exists` sobre o novo nome. Após dois resets verifiquei que sobra exatamente UM CHECK com 5 chaves em cada tabela — sem resíduo do antigo, sem duplicação.

A paridade do `reagendar_retorno` nos 3 pontos de banco (CHECK de `messages.template`, CHECK de `message_templates.template_key`, seed + backfill) está consistente, e o `create or replace` de `seed_message_templates` preserva os 4 textos originais byte a byte, apenas somando a 5ª linha. Como `handle_new_user()` chama a função por nome, novos signups passam a nascer com 5 templates automaticamente — confirmado: signup simulado criou exatamente 5.

`webhook_events` carrega a invariante de idempotência de entrada no índice único `(source, external_event_id)` e fecha o isolamento multi-tenant por três caminhos ao mesmo tempo: `tenant_id not null` sem default (escrita só por service role), FK composta `(tenant_id, appointment_id) → appointments(tenant_id, id)` que impede casar resposta a agendamento de outro tenant, e RLS mais restrito que `messages` (SELECT só admin do tenant, zero policy de write). Testei cada um: duplicado barrado, FK cross-tenant rejeitada, receptionist não lê e não insere, admin de outro tenant não enxerga.

`appointments.confirmed_via` e os campos de retentativa em `messages` são aditivos puros com defaults seguros, não quebram os inserts atuais do frontend (`useCreateAppointment` e `handleSend` não enviam as colunas) e o índice parcial da fila (`where status = 'fila'`) não toca o índice de dedupe existente.

<details>
<summary>Issues (2)</summary>

1. **Idempotência do `db reset` com flapping de container (possible)** — a 2ª execução falhou no bootstrap do Realtime da CLI (`error running container: exit 1`), não nas migrations; `--debug` aplicou as 20 limpo. Pedir ao QA (ADR-07) confirmar o duplo `db reset` num ambiente estável para fechar o critério de aceite 2 sem ressalva.
2. **Backfill do `reagendar_retorno` depende de `seed_message_templates` já recriada no mesmo passo (informativo/likely)** — a ordem dentro da migration `...093000` está correta (função recriada antes do backfill `insert ... select`), mas vale o QA validar que um tenant legado pré-existente ganha a 5ª linha sem duplicar em re-apply. Verifiquei por signup novo (5 linhas); o caminho legado puro não tinha tenant antigo no reset local.

</details>

<details>
<summary>Details</summary>

### Troca dos CHECKs auto-nomeados pela versão de 5 chaves

O risco real desta ADR mora aqui. Os CHECKs originais de `messages.template` e `message_templates.template_key` foram declarados inline na coluna, então o Postgres os auto-nomeia `<tabela>_<coluna>_check`. A migration `...093000` dropa esses nomes exatos (`messages_template_check`, `message_templates_template_key_check`) sob `if exists` e adiciona um CHECK nomeado novo (`*_allowed_check`) sob `not exists`, tudo em bloco `do $$` consultando `pg_constraint`. Confirmei contra os dois originais (`20250220091000_messages.sql`, `20250222090000_message_templates.sql`) que os nomes auto-gerados batem com os dropados.

Contraprova no banco após **dois** `db reset`:

```
messages_template_allowed_check              CHECK (template IN (... 5 chaves ...))
message_templates_template_key_allowed_check CHECK (template_key IN (... 5 chaves ...))
```

Exatamente uma constraint por tabela, com as 5 chaves, sem resíduo do CHECK antigo e sem duplicação no re-apply. Critério de aceite 2 satisfeito no local.

### Paridade e preservação do seed

Comparei linha a linha os 4 textos de `seed_message_templates` entre a baseline (`20250222091000`) e o `create or replace` desta ADR: idênticos. A 5ª linha (`reagendar_retorno`) usa só a lista fechada de variáveis `{nome}{servico}{empresa}`, sem PII e sem `{valor}` (coerente com a decisão de deixar valor fora até o módulo Asaas). Signup simulado (`insert` em `auth.users` disparando o trigger) resultou em 5 templates, todos ativos, body não-vazio — critério 4 ok. O backfill idempotente roda depois do `create or replace`, ordem correta dentro do arquivo.

### webhook_events: idempotência e três travas de isolamento

O índice `webhook_events_dedupe_uidx (source, external_event_id)` é a trava real de idempotência de entrada. Testei: segundo insert do mesmo par colide com `unique_violation` — R7 ok.

O isolamento multi-tenant está defendido em camadas no próprio banco, não só na app:

```
insert webhook_events(tenant=t1, appointment=<de t2>)  -> foreign_key_violation  (R12 ok)
insert webhook_events(tenant=t1, appointment=<de t1>)  -> aceito                 (sem falso positivo)
```

A FK composta `(tenant_id, appointment_id) → appointments(tenant_id, id)` só fecha porque `appointments_tenant_id_unique (tenant_id, id)` existe (migration `20250220089000`) — verifiquei o alvo. `appointment_id` nullable com MATCH SIMPLE deixa passar evento sem casamento, como a ADR pretende.

RLS exercitado como role `authenticated` dentro de transação (superuser bypassa RLS, então o teste precisa trocar de role de verdade):

```
admin t1        -> vê 1 evento do próprio tenant
receptionist t1 -> vê 0  (leitura negada, mais restrito que messages)
admin t2        -> vê 0 eventos de t1  (cross-tenant)
receptionist INSERT -> ERROR: new row violates row-level security policy  (R18)
```

Sem policy de INSERT/UPDATE/DELETE, qualquer escrita pelo cliente é negada — impede forjar um evento de confirmação. Posto de segurança correto e mais apertado que `messages` de propósito.

### confirmed_via e campos de retentativa

`confirmed_via text` nullable com `CHECK IN ('cliente_whatsapp','manual')` — valor inválido rejeitado por `check_violation` (critério 5 ok). Aditivo, não toca o trigger de transição nem o índice de exclusão de sobreposição, e não quebra o insert atual (a coluna não é enviada pela UI). A decisão de deixar a gravação de `confirmed_via` para o webhook (ADR-03) é coerente com o recorte da ADR.

Os 4 campos em `messages` conferem no catálogo: `attempts int not null default 0`, `max_attempts int not null default 3`, `last_attempt_at`/`next_attempt_at timestamptz` nullable. O índice parcial `messages_retry_queue_idx (next_attempt_at) where status = 'fila'` existe e é independente do `messages_dedupe_uidx` — o worker (ADR-05) varre a fila sem colidir com a trava de dedupe. Defaults seguros para o `handleSend` da Fatia 1 que não envia essas colunas.

### Contraprova de build

`npm run build` (tsc -b + vite build) exit 0; `npm run typecheck` coberto pelo mesmo `tsc -b`; `npm test` (vitest) 32/32 verdes. Nenhuma das migrations toca frontend, então o verde era esperado — serve de contraprova de não-regressão. Nenhum segredo nos arquivos SQL.

</details>

<details>
<summary>File map</summary>

- `supabase/migrations/20250223090000_webhook_events.sql` — tabela nova de auditoria/dedupe de entrada, RLS só-admin, índice único `(source, external_event_id)`, FK composta por tenant.
- `supabase/migrations/20250223091000_appointments_confirmed_via.sql` — coluna `confirmed_via` nullable com CHECK (`cliente_whatsapp|manual`).
- `supabase/migrations/20250223092000_messages_retry_fields.sql` — 4 colunas de retentativa + índice parcial da fila.
- `supabase/migrations/20250223093000_reagendar_retorno_template.sql` — CHECKs recriados com 5 chaves + `seed_message_templates` recriada + backfill idempotente.

Diff completo: `git show b608a6d -- supabase/`.
</details>
