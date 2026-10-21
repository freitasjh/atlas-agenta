# ADR-01 — Vigência da grade e passo-base de slots em `professionals`

**Status:** proposto

## Contexto

A grade semanal recorrente (`working_hours`) já existe e é reusável, mas o módulo de agenda precisa
de dois atributos novos **por profissional** que a geração de slots consome:

- **Vigência** da grade: o período `[início, fim]` em que o profissional atende (pedido explícito do
  usuário na mensagem 10 — "o intervalo de dias que vai ser trabalhado"). Fora da vigência, nenhum
  slot é ofertado mesmo havendo grade semanal para o dia (RF-AG-01 / AC-12).
- **Passo-base de slot** (`slot_step_minutes`): a granularidade com que os horários de início andam
  (RF-AG-04 / AC-15). É a modelagem do "tempo de consulta do profissional" (mensagem 12.2): o
  profissional controla o **passo** de oferta, enquanto o **bloco** ocupado vem sempre da duração do
  serviço. Default **30** min.

As duas análises (data §5/§6.1, frontend §1.3) e o PRD §9 (pontos 1, 2 e 3, aprovados no gate)
convergem: esses atributos moram em **colunas novas em `professionals`** — são um valor único por
profissional, não por dia (pôr em `working_hours` duplicaria o dado por linha de dia e abriria
inconsistência entre dias). O passo-base **não** nasce como constante de UI: o gate aprovou
`slot_step_minutes` persistido e configurável por profissional (PRD §9 ponto 1).

RBAC da escrita: **admin-only no MVP** (PRD §9 ponto 3). A policy `professionals_write_admin` já
existente cobre essas colunas; o `professional` **não** ganha escrita em `professionals` nesta
entrega (evita ampliar a superfície de escrita numa tabela que carrega `profile_id`/`active`), com
backlog registrado para own-update granular.

Última migration aplicada: `20250220091000_messages.sql`. Nova migration usa timestamp posterior e
**nunca** edita migration aplicada (RNF-SEG-06).

## Decisão

Criar **uma migration nova** `supabase/migrations/20250221090000_professionals_schedule_vigencia.sql`
que faz `ALTER TABLE professionals`, idempotente no re-apply (`add column if not exists`):

- `schedule_start_date date` (null = sem limite de início);
- `schedule_end_date date` (null = sem limite de fim);
- `slot_step_minutes int not null default 30 check (slot_step_minutes between 5 and 240)`;
- CHECK de coerência de vigência (`professionals_schedule_vigencia_coherent`): quando ambas as datas
  presentes, `schedule_start_date <= schedule_end_date` (null em qualquer uma dispensa a checagem).

Datas em `date` (dia de calendário no fuso do tenant — a conversão para instante UTC acontece só na
geração de slots, ADR-05), coerente com `RNF-SEG-05`. Nenhuma coluna `tenant_id` nova (já existe); a
RLS/policies de `professionals` **já cobrem** as colunas novas, então **nenhuma policy nova** é
criada aqui. Nenhum segredo no SQL.

Esta é uma decisão de arquitetura durável (onde moram vigência/passo-base e por quê); candidata a
promoção para `docs/` depois do run — não copiar agora.

## Consequências

- **Positivas:** a geração de slots (ADR-05) passa a ter vigência e passo por profissional sem tabela
  nova; paridade de RBAC com o que já existe; re-apply seguro.
- **Custos/limitações:** o `professional` não edita a própria vigência/passo no MVP (admin-only);
  fica backlog explícito. Alterar o `default`/range do passo depois exige nova migration.
- **Risco controlado:** CHECK no banco é a trava; o zod (ADR-03) é só UX.

### Escopo

Dados (apenas Supabase/migration).

### Arquivos / pastas afetados

- `supabase/migrations/20250221090000_professionals_schedule_vigencia.sql` (novo).

### Critérios de aceite testáveis (desta ADR)

Via `supabase start` + `psql`/SQL editor, sessões de papéis distintos:

- **AC-08a:** inserir/atualizar `professionals` com `schedule_start_date > schedule_end_date` é
  rejeitado pelo CHECK `professionals_schedule_vigencia_coherent`.
- **AC-08b:** `slot_step_minutes` fora de `5..240` é rejeitado; omitir o campo grava `30` (default).
- **AC-08c:** `schedule_start_date`/`schedule_end_date` nulos são aceitos (sem limite).
- **AC-03 (parcial):** `admin` do tenant consegue `update` dessas colunas em qualquer profissional do
  tenant; `professional`/`receptionist` **não** conseguem (sem policy de escrita em `professionals`).
- **Re-apply:** rodar a migration duas vezes não falha (idempotência).
- **Verificação:** `npx supabase db reset` (ou `supabase start` + aplicar migrations) conclui sem erro
  e as colunas aparecem em `professionals`.

### Dependência

Nenhuma ADR anterior deste conjunto. Depende apenas do schema já aplicado (`professionals` da
migration `20250217090000_operational_catalog.sql` e dos helpers `current_tenant_id()`/
`current_role_name()` de `20250216091000_profiles_and_helpers.sql`).
