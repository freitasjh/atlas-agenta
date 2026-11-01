# ADR-03 — `appointments.combo_id` opcional em XOR com `service_id` — Revisão Independente B

**Revisor independente B** (modelo distinto do revisor A, análise cega ao parecer A).
Escopo revisado: commit `f242dbb` (`feat: appointments.combo_id em XOR com service_id
[ADR-03]`), um único arquivo novo
`supabase/migrations/20250226096000_appointments_combo.sql` (77 linhas). Base de
comparação: `master` (`8d6bab7`) + ADR-01 (`3037cbe`) e ADR-02 (`422f4e6`), ambas já
`approved` no índice.

Esta é a última ADR de dados da fatia: fecha o contrato que o frontend (ADR-04/05)
vai consumir. Decisão (a) do PRD — Opção A: o combo entra no agendamento como coluna
`combo_id` opcional em XOR com `service_id`, mantendo o agendamento como **uma linha,
uma janela** `[starts_at, ends_at)`. A migration torna `service_id` nullable, adiciona
`combo_id uuid`, a FK composta por tenant `(tenant_id, combo_id) → combos(tenant_id,
id)`, o CHECK de XOR e um índice parcial. Não toca o trigger da máquina de estados, as
policies de `appointments`, nem introduz qualquer cláusula de `segment`. A
implementação corresponde exatamente ao que a ADR descreveu e passou em todos os
critérios de aceite que executei ao vivo contra o Postgres local.

**Watch for:**
- **(confirmed)** `on delete restrict` na FK de combo cria uma assimetria com o CASCADE
  de `tenants`: apagar um `tenant` ainda apaga seus `appointments` (via
  `appointments.tenant_id → tenants on delete cascade`, migration `20250219091000`), mas
  apagar um `combo` com agendamento que o referencia é barrado. Isso é **intencional e
  correto** (a app usa soft-delete `active=false`, nunca DELETE físico) e está alinhado
  ao padrão das outras três FKs de `appointments`. Registrado para o QA confirmar que a
  UI de inativação de combo nunca tenta DELETE físico — mas não é defeito desta ADR.
- **(confirmed)** O XOR é garantido no banco, mas "combo não-vazio" e "snapshot de
  preço/duração corretos" continuam sendo responsabilidade da app (ADR-05), por decisão
  explícita do PRD §7.3. Esta ADR não regride isso; só é um lembrete de que o CHECK
  sozinho não impede um `combo_id` apontando para um pacote sem serviços (`ends_at =
  starts_at` seria barrado por outro CHECK, ver Details).

**Verdict**: APPROVED

## High-level view

A modelagem está correta e idempotente. `combo_id` é aditivo; tornar `service_id`
nullable não regride serviço avulso porque a FK composta `appointments_service_fk` usa
MATCH SIMPLE (coluna nula não é checada) e todas as linhas existentes já têm
`service_id`. O CHECK `appointments_service_xor_combo` força exatamente um dos dois
preenchido, e a FK composta `appointments_combo_fk` fecha o cruzamento cross-tenant no
schema — não só na UI. Verifiquei os quatro objetos no banco após o reset: nulabilidade,
definição do CHECK, definição da FK (`ON DELETE RESTRICT`) e o índice parcial batem
byte a byte com a ADR.

As invariantes que o PRD mandou preservar continuam intactas, e confirmei que a
migration não as toca: a constraint de exclusão `appointments_no_overlap` opera sobre
`(tenant_id, professional_id, tstzrange(starts_at, ends_at))` — nenhuma dessas colunas
mudou, então a prevenção de conflito funciona igual para linha vinda de serviço ou de
combo. O trigger `appointments_validate_transition()` não é recriado (grep negativo
confirma) e segue com o bloco de comissão lendo `new.price_cents` como `base_cents` —
válido vindo de combo, porque o snapshot de preço mora em `appointments.price_cents`
(a app grava, ADR-05). As policies RLS de `appointments` não são tocadas: `combo_id`
herda `appointments_write_staff`/`appointments_write_own_professional`/
`appointments_select_tenant`, e o `WITH CHECK` por tenant somado à FK composta barra
qualquer escrita cross-tenant.

Fronteiras de segurança: nenhuma cláusula de `segment` (gating é UI-only, correto); FK
composta por tenant impede o cruzamento por construção; dinheiro segue em `price_cents
int` (nenhuma coluna de preço nova); nenhum segredo no SQL; nenhuma Edge Function. Não
há superfície de webhook/LGPD neste escopo. Build, typecheck e os 84 testes passam — e,
como a ADR é SQL-pura, isso é esperado (os tipos TS entram na ADR-04). O gate real desta
ADR é o banco, e executei a contraprova funcional dos cinco CAs testáveis ao vivo: todos
passaram.

<details>
<summary>Issues (0)</summary>

Nenhum defeito acionável. Os dois itens em "Watch for" são confirmações de design
intencional (assimetria RESTRICT vs CASCADE; regra de combo-não-vazio delegada à app) a
serem verificadas no QA da ADR-05, não correções nesta ADR.

</details>

<details>
<summary>Details</summary>

### XOR no banco: os quatro casos, verificados ao vivo

Rodei inserts num `tenant salao` com cliente/profissional/serviço/combo próprios, dentro
de transação revertida, contra o Postgres local após o `supabase db reset`:

```
service_id=null, combo_id=null      => ERRO 23514 appointments_service_xor_combo   (rejeitado)
service_id=set,  combo_id=set       => ERRO 23514 appointments_service_xor_combo   (rejeitado)
service_id=null, combo_id=set       => INSERT 0 1                                   (aceito)
service_id=set,  combo_id=null      => INSERT 0 1                                   (aceito)
```

Isto cobre **CA-03.1** (XOR, RF-S7/AC-6) e **CA-03.7** (não-regressão de serviço avulso).
A definição aplicada no banco bate com a ADR:

```
CHECK (((service_id IS NOT NULL) AND (combo_id IS NULL))
    OR ((service_id IS NULL) AND (combo_id IS NOT NULL)))
```

### Anti cross-tenant: a FK composta fecha o buraco

Criei tenant A (cliente + profissional) e tenant B (combo), e tentei um agendamento do
tenant A referenciando o `combo_id` do tenant B:

```
INSERT appointments(tenant_id=A, combo_id=<combo de B>) =>
  ERRO 23503 appointments_combo_fk
  "Key (tenant_id, combo_id)=(A, <combo de B>) is not present in table combos."
```

Cobre **CA-03.2** (RF-S9/AC-3). O par `(tenant_id, combo_id)` referenciando
`combos(tenant_id, id)` só acha linha quando o combo é do mesmo tenant — cruzar tenants
é impossível por construção, igual às FKs compostas de `customer_id`/`professional_id`/
`service_id` já existentes. O alvo `combos_tenant_id_unique unique (tenant_id, id)` vem
da ADR-01 e existe; a FK aplicou sem erro.

### Invariantes preservadas: confirmei que a migration não as toca

`appointments_no_overlap` (migration `20250219092000`) é `EXCLUDE USING gist (tenant_id
with =, professional_id with =, tstzrange(starts_at, ends_at) with &&) WHERE status not
in ('cancelado','nao_compareceu')`. Nenhuma dessas colunas é alterada por esta ADR, logo
a prevenção de conflito opera idêntica para agendamento vindo de serviço **ou** de combo;
a duração do combo entra no range porque `ends_at` continua derivado na app (ADR-05).
Isto satisfaz **CA-03.3** no plano estrutural — a prova funcional ao vivo (dois
agendamentos sobrepostos, um por serviço e outro por combo) depende do caminho de
escrita do frontend e fica para o QA da ADR-05, como a própria ADR registra.

O trigger `appointments_validate_transition()` **não** é recriado. Grep negativo na
migration:

```
grep -i "create or replace function appointments_validate_transition|create trigger|create policy" \
  20250226096000_appointments_combo.sql
# única ocorrência: linha 10, um COMENTÁRIO dizendo que NÃO recria o trigger.
```

E no banco, após o reset, `pg_get_functiondef('appointments_validate_transition')` ainda
contém o bloco `appointment_commissions` — o corpo com guardas + carimbo de
`confirmed_at` + apuração de comissão de `20250226092000` está íntegro. Isto cobre
**CA-03.5** (RF-S15/AC-14). Como a apuração usa `new.price_cents` como `base_cents` e o
combo grava seu snapshot em `appointments.price_cents` (ADR-05), **CA-03.4** (comissão
não regride) está preservado estruturalmente; a prova funcional ponta a ponta
(`pendente→…→concluido` via combo) é QA da ADR-05.

### `service_id` nullable não regride serviço avulso

`information_schema.columns` após o reset confirma `service_id` com `is_nullable = YES`
e `combo_id uuid` nullable. A FK `appointments_service_fk` segue válida: em FK composta
com MATCH SIMPLE (default do Postgres), se **qualquer** coluna da chave é nula, a FK não
é checada — então uma linha com `service_id=null, combo_id=set` não viola
`appointments_service_fk`, e uma com `service_id=set` continua sendo checada normalmente.
O insert de serviço-avulso passou no teste acima. **CA-03.7** confirmado.

### Idempotência: dois `supabase db reset`, exit 0

```
supabase db reset  (1ª vez) => aplica até 20250226096000_appointments_combo.sql, exit 0
supabase db reset  (2ª vez) => reaplica tudo do zero, exit 0
```

O reset recria o banco do zero a cada vez, então a prova de "re-apply no-op" vem das
construções idempotentes: `add column if not exists`, `alter column ... drop not null`
(no-op quando já nullable), o bloco `do $$ ... pg_constraint ... $$` que checa a
existência da constraint antes de criar (mesmo padrão de `appointments_no_overlap`), e
`create index if not exists`. Duas execuções limpas satisfazem **CA-03.6** (RF-S14/AC-13).

### `ON DELETE RESTRICT` — assimetria intencional com o CASCADE de tenant

`appointments_combo_fk` é `ON DELETE RESTRICT`: não dá pra apagar um `combo` que ainda
tem agendamento apontando pra ele. Isto é coerente com as outras três FKs de
`appointments` (todas RESTRICT) e protege o histórico — a app inativa o combo
(`active=false`), nunca faz DELETE físico. Note que isso **não** conflita com o
`tenant_id → tenants ON DELETE CASCADE`: apagar o tenant ainda cascateia e apaga os
`appointments` antes de qualquer RESTRICT de combo entrar em jogo (o combo também é
cascateado pelo tenant). A assimetria só importa no caminho "apagar combo isolado", que a
app não exerce. Registrado como ponto de atenção para o QA (ADR-05/07) confirmar que a
inativação de pacote na UI usa `active=false`, não DELETE — mas é comportamento esperado,
não defeito.

### Combo-não-vazio continua sendo regra de app (por decisão do PRD)

O CHECK garante XOR, não garante que o `combo_id` aponte para um pacote com ≥1 serviço.
O PRD §7.3 travou isso como regra de app (zod na UI + escrita transacional), espelhando
`service_professionals`. Esta ADR respeita essa divisão. Vale notar que o CHECK
pré-existente `ends_at > starts_at` (migration `20250219091000`) dá uma segunda rede: um
pacote vazio derivaria `ends_at = starts_at` e seria barrado na escrita — mas a trava
primária é a app, como a ADR e o PRD definem. Nada a corrigir aqui.

### Fronteiras — varredura

- **Multi-tenant/RLS:** nenhuma policy criada/alterada; `combo_id` herda as policies de
  `appointments` por tenant (`WITH CHECK` + FK composta barram cross-tenant). `tenant_id`
  nunca vem do cliente. **OK.**
- **RBAC:** inalterado — quem já gravava o agendamento grava `combo_id` sob a mesma
  policy. Nenhum caminho super_admin novo. **OK.**
- **`segment` não é fronteira de segurança:** a migration não tem nenhuma cláusula de
  `segment`. **OK** (gating é UI-only, ADR-04).
- **Dinheiro/tempo:** nenhuma coluna de preço nova; reusa `price_cents int`; `combo_id`
  é uuid; tempo segue `timestamptz`. **OK.**
- **Idempotência/migration:** timestamp `20250226096000` > última aplicada
  (`20250226095000`); não edita migration aplicada; constraints em bloco guardado. **OK.**
- **Segredos/Edge Function/webhook/LGPD:** nenhum segredo no SQL; nenhuma função nova;
  não toca webhook nem PII. **Não aplicável / OK.**

### Contraprova executada

- `npm run build` (`tsc -b && vite build`): **verde**. Aviso pré-existente de chunk
  > 500 kB, não relacionado a esta ADR.
- `npm run test` (`vitest run`): **84/84 passando** (10 suites). Nenhum teste novo nesta
  ADR — esperado, é SQL-pura; os tipos TS entram na ADR-04. Não há script de lint no
  `package.json`.
- `supabase db reset` **duas vezes**: exit 0 em ambas (idempotência, CA-03.6).
- Inspeção de schema pós-reset (`information_schema` + `pg_constraint` + `pg_indexes`):
  nulabilidade, CHECK XOR, FK composta `ON DELETE RESTRICT` e índice parcial conferem com
  a ADR.
- Testes funcionais ao vivo contra o Postgres local (transações revertidas): XOR
  (CA-03.1), cross-tenant FK (CA-03.2), serviço-avulso (CA-03.7) — todos com o SQLSTATE
  esperado.
- Grep negativo da recriação do trigger (CA-03.5) + `pg_get_functiondef` confirmando o
  bloco de comissão intacto.

Observação de ambiente: a verificação funcional de conflito/estados ao vivo (CA-03.3/
CA-03.4 ponta a ponta) depende do caminho de escrita do frontend e é retomada no QA
visual da ADR-05, conforme a própria ADR declara. Não é lacuna desta revisão.

### Escopo versus ADR

A ADR pediu exatamente um arquivo novo
(`supabase/migrations/20250226096000_appointments_combo.sql`) com os quatro passos
numerados; o commit `f242dbb` entrega esse arquivo e nada mais. Sem mudança de TS, sem
tocar outras migrations, sem policy nova. Zero desvio de escopo.

</details>

<details>
<summary>Mapa de arquivos</summary>

- `supabase/migrations/20250226096000_appointments_combo.sql` — **novo**. (1) `add column
  if not exists combo_id uuid`; (2) `alter column service_id drop not null`; (3) bloco
  `do $$` idempotente criando `appointments_combo_fk` (FK composta por tenant, `on delete
  restrict`) e `appointments_service_xor_combo` (CHECK de XOR); (4) índice parcial
  `appointments_tenant_combo_idx` em `(tenant_id, combo_id) where combo_id is not null`.
  Não recria trigger nem policies; sem cláusula de `segment`; sem segredo. **Correto e
  aprovado.**

Diff completo: `git show f242dbb`.

</details>
