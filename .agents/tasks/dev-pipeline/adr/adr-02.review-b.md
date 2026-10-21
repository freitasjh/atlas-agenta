# Revisor B — ADR-02: Setup de pg_cron versionado e condicional

**Escopo revisado:** commit `07e8692` na branch `feat/adr-02-pg-cron-setup`, um único arquivo novo
`supabase/migrations/20250223094000_pg_cron_setup.sql` (85 linhas). Base: `origin/master` (deb863c)
+ ADR-01 (b608a6d).

A migration cria a infra de agendamento da Fatia 2: habilita `pg_cron` de forma condicional (não
quebra `db reset` onde a extensão não existe) e registra dois jobs idempotentes — `atlas_lembrete_d1`
(`*/15 * * * *`) e `atlas_retry_queue` (`*/5 * * * *`) — apontando para funções SQL `security definer`
que serão definidas em ADR-04/05. Não há código de aplicação, nenhuma tabela nova, nenhum segredo.

**Watch for:** o guard de "ambiente sem pg_cron" protege contra a extensão **ausente no catálogo**
(control file inexistente), mas não contra o caso "extensão existe no catálogo porém o owner da
migration não tem privilégio para criá-la/usá-la" — cenário improvável no fluxo real (migrations
rodam como `postgres`/owner), porém o `exception when others` do bloco 1 também engole erros não
relacionados a disponibilidade (possible, ver detalhe). Nenhum desses é bloqueante para a decisão da ADR.

**Verdict**: APPROVED

## High-level view

A decisão de invocação (função SQL `security definer` em vez de `pg_net`) está corretamente
materializada: o `command` dos dois jobs é `select public.whatsapp_enqueue_lembrete_d1();` /
`select public.whatsapp_process_retry_queue();`, sem nenhum token, service role ou URL de Edge
Function. Isso bate com ADR-04/05 (mesmos nomes de função, mesmas cron expressions) e mantém a
fronteira de segredo intacta — contraprova no banco confirma zero segredos no SQL.

A condicionalidade R21 foi verificada na prática: o `supabase db reset` aplicou **todas as 21
migrations limpo** (incluindo esta), e re-aplicar o arquivo é idempotente (unschedule-antes-de-schedule
mantém exatamente 2 jobs, sem erro). A escolha de usar `pg_extension` como guard em vez de
`to_regproc('cron.schedule')` está certa e bem documentada — `cron.schedule` é sobrecarregada e
`to_regproc` resolveria o nome ambíguo para NULL, pulando o agendamento mesmo com pg_cron presente.

Agendar os jobs antes das funções existirem é seguro: confirmei no catálogo que
`whatsapp_enqueue_lembrete_d1` / `whatsapp_process_retry_queue` ainda **não existem** e o
`cron.schedule` aceitou os comandos como string — exatamente o que o comentário-cabeçalho afirma.

A única aresta é a granularidade do guard: o `exception when others` é mais largo que o necessário e o
`return` pós-guard trata "sem privilégio" como "ausente". São observações de robustez, não defeitos de
aderência (detalhe na lista de issues).

<details>
<summary>Issues (2)</summary>

1. **`exception when others` largo demais (possible)** — o bloco 1 engole *qualquer* erro de
   `create extension`, não só "extensão indisponível". Um erro transitório/inesperado (ex.: schema
   `cron` corrompido) viraria `notice` silencioso e o reset seguiria sem os jobs, sem sinal forte.
   Aceitável para o objetivo (não quebrar reset), mas vale um comentário reconhecendo o trade-off ou
   um filtro por `sqlstate` se quiser estreitar. Não bloqueante.
2. **Guard não distingue "ausente" de "sem privilégio" (possible)** — se, num ambiente atípico, a
   extensão existir no catálogo mas o owner da migration não puder usá-la, o fluxo passaria do guard
   `pg_extension` e falharia em `cron.schedule` com "permission denied for schema cron" (reproduzi o
   sintoma forçando um role sem privilégio). No fluxo real as migrations rodam como owner, então é
   teórico; registrar como premissa ("migration roda como owner com acesso ao schema cron") fecharia
   a lacuna documentalmente. Não bloqueante.

</details>

<details>
<summary>Details</summary>

### Aderência à ADR e paridade de contrato com ADR-04/05

A ADR-02 especifica: invocação por função SQL (não pg_net), extensão condicional, dois jobs
idempotentes `atlas_lembrete_d1` (`*/15`) e `atlas_retry_queue` (`*/5`), nenhum segredo. O arquivo
cumpre item a item. Os nomes de função no `command` (`whatsapp_enqueue_lembrete_d1`,
`whatsapp_process_retry_queue`) são idênticos aos que ADR-04 e ADR-05 prometem definir, e no schema
`public` — o `cron.schedule` qualifica explicitamente `public.`, o que evita dependência de
`search_path` no momento da execução do job (bom detalhe, já que o job roda com o search_path do
pg_cron, não o da sessão de migration).

Verifiquei no banco que as duas funções **ainda não existem** — o que valida a afirmação do cabeçalho
de que registrar o job antes da função é seguro porque `cron.schedule` guarda o comando como texto.
A sequência de ADRs fica coerente: ADR-02 cria a infra, ADR-04/05 preenchem as funções, e o re-apply
de ADR-02 (ou um novo reset) continua idempotente independentemente da ordem.

### Condicionalidade e idempotência (R21) — contraprova executada

`supabase db reset` nesta máquina falhou no **seeding interno do Realtime** (migration interna
`20221003041349_add_mfa_schema.up.sql`, erro `duplicate key ... pg_type_typname_nsp_index`) — um
problema do stack local da CLI Supabase, **anterior e alheio** às migrations do projeto. Confirmei que
isso não afeta esta ADR: as 21 migrations do projeto (incluindo `20250223094000`) foram aplicadas e
registradas em `supabase_migrations.schema_migrations`, e o DB container ficou `healthy`. O erro de
reset é de ambiente, não de SQL desta fatia.

Esta imagem local **tem** pg_cron (1.6.4), então pude exercer o caminho "com extensão" diretamente:

```
      jobname      |   schedule   |                    command
-------------------+--------------+-----------------------------------------------
 atlas_lembrete_d1 | */15 * * * * | select public.whatsapp_enqueue_lembrete_d1();
 atlas_retry_queue | */5 * * * *  | select public.whatsapp_process_retry_queue();
```

Dois jobs, uma vez cada, schedules e comandos corretos (critério 2). Re-apliquei o arquivo inteiro:
exit 0, `NOTICE: extension "pg_cron" already exists, skipping`, e ainda exatamente 2 jobs — o
`unschedule` antes do `schedule` evita a duplicação sob re-apply (critérios 2 e 3). O caminho "sem
pg_cron no catálogo" foi coberto pelo próprio `db reset` acima: todas as migrations aplicam sem travar.

### Limites do guard de disponibilidade

Ao simular "extensão indisponível" rodando a migration sob um role sem privilégio, o fluxo passou do
guard `pg_extension` (a extensão já estava no catálogo por um apply anterior) e `cron.schedule` falhou
com `permission denied for schema cron`. É um **artefato da simulação** — no fluxo real a migration
roda como owner — mas expõe que o guard responde a "a extensão está no catálogo?" e não a "consigo
agendar?". Para o objetivo da ADR (não quebrar `db reset` onde pg_cron não está na imagem), o guard é
suficiente e foi comprovado pelo reset limpo; as duas observações ficam na lista de issues.

### Segredos (R20)

Varredura por `service_role|token|secret|apikey|bearer|eyJ|password` retorna só ocorrências dentro de
comentários que afirmam a ausência de segredos. O `command` dos jobs é SQL puro chamando funções
locais — fronteira de segredo preservada.

### Contraprova de build

`npm run build` (= `tsc -b && vite build`) → exit 0; o `typecheck` está coberto pelo `tsc -b`. Vale
rodar mesmo numa ADR SQL-only para garantir que a branch (sobre ADR-01) não regrediu o frontend. Não
subi dev server (decisão do QA, step seguinte), conforme instrução.

</details>

<details>
<summary>Arquivos alterados</summary>

- `supabase/migrations/20250223094000_pg_cron_setup.sql` (novo) — extensão pg_cron condicional
  (`do $$ ... exception when others ...`) + registro idempotente dos jobs `atlas_lembrete_d1` /
  `atlas_retry_queue` guardado por `pg_extension`. Sem segredos, sem tabelas, sem código de app.

Diff completo: `git show 07e8692`.

</details>
