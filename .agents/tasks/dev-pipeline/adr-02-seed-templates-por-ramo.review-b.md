# Seed de templates por ramo + `handle_new_user()` lendo `segment` (ADR-02) — Revisor B

ADR-02 adiciona uma única migration nova (`20250225091000_segment_seed_templates.sql`) que recria `seed_message_templates` com um segundo parâmetro `p_segment` e recria `handle_new_user()` para ler/validar/gravar o ramo vindo de `raw_user_meta_data`. Nenhuma migration aplicada foi editada, o trigger `on_auth_user_created` não foi recriado, e a invariante "nenhum tenant sem os 4 templates" se mantém. O escopo é dados puro: o diff do commit `a9f5da1` é só esse arquivo de 165 linhas, batendo com a seção "Arquivos afetados" da ADR.

Rodei a contraprova completa contra o Supabase local: `npm run build` e `npm run test` verdes (43 testes, incluindo `message-templates`), `supabase db reset` com exit 0 aplicando as duas migrations da fatia, e simulei signups dos três ramos + ausente + inválido via `insert into auth.users`. Todos os critérios AC-02.1..AC-02.6 passaram e o `check` de ADR-01 rejeita o quarto valor. Não subi dev server (QA visual é o step seguinte).

Watch for: nada bloqueante. Dois pontos informativos de baixa relevância — o `nullif(...,'')`+validação no trigger deixa a cláusula `where seg.segment = p_segment` da função dependente de nunca receber string não-normalizada de outro chamador futuro (confirmed, defesa já presente e dupla), e o `drop function` da forma de 1 argumento é destrutivo mas seguro aqui (confirmed, os únicos chamadores foram auditados).

**Verdict**: APPROVED

## High-level view

A decisão D3 travada no gate (templates no trigger com variante de ramo; catálogo de `services` fica fora, na ADR-06) está respeitada à risca: a migration só mexe nas duas funções do signup e não introduz catálogo pesado no caminho atômico. O fallback genérico é cópia byte-a-byte dos textos da `20250222091000`, então legados e signups sem ramo não regridem — verifiquei que o `body` de `confirmacao` para `segment NULL` é idêntico ao baseline.

A robustez do trigger contra segmento inválido é real e testada: `xpto` entra, vira `NULL`, o signup não aborta pelo `check`, e caem os 4 textos genéricos. A normalização acontece no trigger (`nullif` + `not in (...)`), e a função ainda tem uma segunda barreira (o `not exists` contra a lista de ramos conhecidos) — defesa em profundidade coerente com a seção 4 do PRD.

A mudança de assinatura é tratada corretamente: `drop function if exists seed_message_templates(uuid)` antes do `create or replace` da forma de 2 argumentos, sem deixar as duas versões coexistindo. Confirmei no `pg_proc` pós-reset que só existe a forma `(uuid, text)`.

Idempotência verificada de duas formas: `db reset` reaplicou tudo sem erro, e re-chamar `seed_message_templates` para um tenant que já tem templates (inclusive com segmento diferente) não duplica nem reescreve, graças ao `on conflict (tenant_id, template_key) do nothing`.

Nenhuma fronteira de segurança foi tocada: o `segment` é metadado de signup validado no servidor, nunca chave de isolamento; `security definer` + `search_path = public` preservados em ambas as funções; `role` continua forçado a `admin` e nunca lido do payload; nenhum segredo no SQL; o `segment` não é PII.

<details>
<summary>Issues (0 bloqueantes, 2 informativos)</summary>

1. **Semântica de `on conflict do nothing` ao trocar de ramo** (informativo) — se um dia `seed_message_templates` for chamado para um tenant que já tem templates (ex.: futura tela de troca de ramo na Fase 1b), os textos do ramo novo NÃO serão aplicados. É o comportamento correto para esta fatia (preserva legados, RF-07) e a ADR nem prevê re-seed, mas vale registrar como gancho explícito para a 1b não assumir que trocar o ramo re-semeia templates.
2. **`drop function` é destrutivo por natureza** (informativo) — correto e seguro aqui porque os únicos chamadores (trigger e backfill já aplicado) foram auditados na própria ADR; nenhuma ação necessária.

</details>

<details>
<summary>Details</summary>

### Aderência à ADR e ao PRD

A ADR descreve exatamente o que foi entregue: migration nova e idempotente, `drop function` da forma antiga antes do `create or replace`, `handle_new_user()` com o corpo preservado e duas mudanças mínimas (ler/normalizar `v_segment`; gravar `segment` no insert de `tenants` e repassar ao seed), e a decisão explícita de não fazer backfill de texto por ramo. Comparei o corpo de `handle_new_user` com o da `20250222091000`: a lógica de `tenants` (trial 14d, coalesce de `legal_name`), de `profiles` (role `admin` fixo) e a ordem dos inserts são idênticas — as únicas adições são a coluna `segment` no insert e o segundo argumento no `perform`. Fiel ao requerido pela ADR ("corpo atual preservado fielmente").

Os textos por ramo usam a lista fechada `{nome} {servico} {dataHora} {empresa}` e nenhum introduz `{valor}`, coerente com `src/lib/message-templates.ts` (que também não conhece `{valor}`). As 4 chaves estão presentes em cada variante e nenhuma ficou vazia (verificado por `bool_or(trim(body)='')` = false para os 5 tenants de teste).

### Robustez do trigger e seleção de variante

A construção `union all` com `where seg.segment = p_segment` numa ponta e `where not exists (... known.segment = p_segment)` na outra é mutuamente exclusiva para qualquer valor de `p_segment`:

- `p_segment` conhecido → variante casa, genérico é excluído pelo `not exists`.
- `p_segment` inválido não-nulo → variante não casa, `not exists` é verdadeiro → genérico.
- `p_segment IS NULL` → `seg.segment = NULL` nunca é verdadeiro (variante vazia) e `known.segment = NULL` nunca é verdadeiro (`not exists` verdadeiro) → genérico.

Então a função sozinha já é robusta mesmo que algum chamador futuro passe um valor sujo sem normalizar — a normalização no trigger é uma segunda camada, não a única. Confirmei empiricamente que `none@` (sem `segment`) e `xpto@` (segmento inválido) produziram `segment NULL` e o `body` genérico idêntico ao baseline, sem o signup falhar.

### Idempotência comprovada

`supabase db reset` aplicou as 27 migrations (incluindo `20250225090000` antes de `20250225091000`, ordenação da ADR) com exit 0. Re-chamei `seed_message_templates` para um tenant já populado, inclusive com um `segment` diferente do original, e a query de duplicatas (`group by tenant_id, template_key having count(*)>1`) voltou vazia, com os textos originais do ramo intactos. É a prova de AC-02.5 e, por consequência, de que um legado nunca teria seus templates reescritos (AC-02.6).

### Fronteiras multi-tenant / RBAC / segredos / LGPD

Nenhuma tabela nova, nenhuma policy RLS alterada; `tenants`/`message_templates` herdam as RLS existentes. As duas funções mantêm `security definer` + `set search_path = public` (rodam fora do RLS do chamador, como as demais funções de signup), sem ampliar superfície. `role` continua `admin` fixo, nunca do payload. O `segment` entra por `raw_user_meta_data` e é validado no servidor antes de gravar — nunca é usado como chave de isolamento ou acesso, coerente com a seção 4 do PRD. Nenhum segredo no SQL; `segment` não é PII, então não há preocupação de log.

</details>

<details>
<summary>Arquivos alterados</summary>

- `supabase/migrations/20250225091000_segment_seed_templates.sql` (novo, 165 linhas) — recria `seed_message_templates(uuid, text)` com variante por ramo + fallback genérico, e `handle_new_user()` lendo/validando/gravando `segment`. Diff completo em `git show a9f5da1`.

</details>
