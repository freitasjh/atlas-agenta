# prd-adr-pipeline — política descritiva da esteira PRD → ADR → SDD (RF-06)

> **Descritivo, não enforcement.** Mesmo estatuto de `gate-contract.md`: prosa
> descreve, runtime nega (SPEC ADR-003). Toda afirmação de gate abaixo cita o
> mecanismo que a sustenta (DOC-01). Nenhuma linha aqui nega tool por si só.

## 1. Layout (SPEC §4.1)

`.spec/prd/{prd-id}/` = `PRD.md` (16 seções; §16 = aprovação humana) ·
`RESEARCH.md` (≥2 alternativas com fonte + trade-off + recomendação) ·
`ADR-INDEX.md` (ledger 1:1 com o disco) · `ADRs/ADR-00N-{slug}/ADR.md` (decisão +
`depende-de` + interface congelada). `PRD-01` exige 7 das 16 seções (§1, §2, §5,
§6, §7, §9, §16 — SPEC §4.4).

**Direção obrigatória**: PRD aprovado → RESEARCH → ADR-INDEX → ADR → branch → SDD;
nenhum `ADRs/**` nasce antes do bloco §16 do PRD estar preenchido.

## 2. Contrato de `ADR-INDEX.md` (SPEC §4.2)

Colunas: `order` `id` `title` `status` `depends_on` `dir` `branch` `merge`; a
**opcional** `unit` (`adr`|`legacy`; ausente ⇒ `legacy`) é interruptor de layout.

- **Imposto por `ADR-01`/`ADR-02`** (mecanismo: `checks.mjs`; 🟢 neste repo via
  `static-checks.mjs` no `commands.suiteFull`, 🟡 processo no repo-destino até F3):
  `order` inteiro ≥1 e `status` no enum; `id` único; `dir` no padrão
  `ADRs/ADR-00N-{slug}/`; `branch` casando `^adr/[a-z0-9-]+/\d{2}-[a-z0-9-]+$`;
  `merge` preenchido quando `status=merged`; ≤1 `in-progress`; sem pulo de `order`.
- **`unit` — três efeitos, medidos** (enum **estrito em minúsculas**: `unit: ADR`
  reprova como typo e `ADR-02` nomeia a célula; `unitOf` não normaliza a caixa):
  `adr` ⇒ `SPEC.md`+`TASKS.md` no dir do ADR (`ADR-01`); `adr` **e**
  `status: merged` ⇒ + `VERIFY.md` (`ADR-01`; `in-progress` não deve nada); PRD
  `prd_version: 2` ⇒ toda linha `in-progress`/`merged` declara `unit: adr`
  (`ADR-02`; `todo`/`dropped` isentos).
- **Descritivo** (a tabela declara a forma; os checks **não** impõem): texto de
  `title`, conteúdo de `depends_on`, formato de `merge`, continuidade de `order`
  (buraco não reprova), coerência `id`×`dir`.
- **Retrocompatível, medido:** PRD sem `prd_version: 2` passa sem a coluna
  (ausente ⇒ `legacy` ⇒ `ADR.md` só). `SDD-02` usa a mesma régua: ADR `legacy`
  nomeado pelo estado exige `ADR.md`; só `unit: adr` é ciclo scoped.

## 3. Cerimônia — limites explícitos (SPEC §4.4)

- **Isenção** (não gera PRD nem ADR): typo, doc, rename interno, formatação,
  refactor sem comportamento observável, bump de patch. Arquitetural sem valor de
  produto novo ⇒ ADR sem PRD.
- **Teto** (🟡 processo — sem mecanismo; a recusa é humana): 5 ADRs por PRD;
  acima disso o PRD se divide em dois escopos.
- **Destino** (🟡 processo — sem mecanismo; a recusa é humana): todos `merged`
  ⇒ `.spec/archive/[YYYYMMDD]-prd-{prd-id}/`; `prd_status: archived` só
  **depois** do move.
- **ADR decision-only** (o SDD do ADR já é o ciclo corrente): só `ADR.md` é
  exigido, na forma `unit: legacy` + `status: todo` (fora de `in-progress|merged`)
  e `ADR-01` valida `ADR.md` + 1:1. Em PRD `prd_version: 2` **não se aplica**:
  `unit: legacy` em `in-progress|merged` reprova por construção (`ADR-02`).

## 4. Operação de branch/PR sem `gh` (RF-09)

Por ADR: `git checkout -b adr/{prd-id}/{nn}-{slug}` → `git push -u origin <branch>`
→ imprimir a URL de compare (`<remote>/compare/main...<branch>`). O **merge é
humano** — 🟡 processo (1 ADR = 1 PR = 1 revisão). Nenhum passo exige `gh`.

## 5. Escopo de escrita e níveis de garantia

- `product-manager`/`architect` escrevem apenas `.spec/prd/**` — mitigação de
  processo do gap D11 (sem `gate.js` não há deny). O bloqueio é o PR humano.
- `prompt-optimizer` valida a **demanda** (E1..E6), **nunca** o PRD (`workflow-rules.md` §0).
- `.opencode/plugins/lib/prd-adr-pipeline/` é path propagável (copiado por
  `scripts/harness-sync.mjs`): módulo = mecanismo + templates, a norma é esta
  rule. No destino: 🟡 processo até F3; só aqui roda.

## 6. O que cada afirmação prova (SPEC §5)

`PRD-01`/`ADR-01`/`ADR-02` = `checks.mjs` via `static-checks.mjs` no
`commands.suiteFull` (🟢 repo · 🟡 destino até F3). `V4`/`V17`/`SDD-01..03`/
`R-NODENY` = `scripts/sdd-checks.mjs` no CI + invocação explícita (🟠 CI · ⚠️
inexistente no destino até F3; `V17` prova só o **marcador** da tabela). Merge de
path protegido = trailer `Harness-Gate-Change` (pre-commit + workflow de integridade).

Invariante **sem mecanismo** (🟡 processo): rótulo da esteira não cria valor novo
de `current_phase` — `gate.js` só compara com `Completed`; a recusa é humana.
