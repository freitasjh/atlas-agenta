# prd-adr-pipeline — política descritiva da esteira PRD → ADR → SDD (RF-06)

> **Descritivo, não enforcement.** Mesmo estatuto de `gate-contract.md`: prosa
> descreve, runtime nega (SPEC ADR-003). Toda afirmação de gate abaixo cita o
> mecanismo que a sustenta (DOC-01). Nenhuma linha aqui nega tool por si só.

## 1. Layout (SPEC §4.1)

```
.spec/prd/{prd-id}/
├── PRD.md            # 16 seções; bloco §16 = aprovação humana
├── RESEARCH.md       # ≥2 alternativas com fonte (http) + trade-off + 1 recomendação
├── ADR-INDEX.md      # ledger 1:1 com o disco
└── ADRs/ADR-00N-{slug}/ADR.md   # decisão + depende-de + interface congelada
```

**PRD.md**: 16 seções; **7 obrigatórias** (§1, §2, §5, §6, §7, §9, §16 — SPEC
§4.4), as demais recomendadas. `PRD-01` só exige as obrigatórias.

**Direção obrigatória**: PRD aprovado → RESEARCH → ADR-INDEX → ADR → branch → SDD.
Nenhum `ADRs/**` nasce antes do bloco §16 do PRD estar preenchido.

## 2. Contrato de `ADR-INDEX.md` (SPEC §4.2)

Colunas: `order` `id` `title` `status` `depends_on` `dir` `branch` `merge`.

- **Imposto por `ADR-01`/`ADR-02`** (mecanismo: `checks.mjs`; ⚠️ **não roda
  neste repo** — `scripts/static-checks.mjs` não existe e nenhum workflow de CI o
  invoca, então é 🟡 processo; 🟡 processo também no repo-destino até F3):
  `order` inteiro ≥1 e `status` no enum; `id` único; `dir` no padrão
  `ADRs/ADR-00N-{slug}/`; `branch` casando `^adr/[a-z0-9-]+/\d{2}-[a-z0-9-]+$`;
  `merge` preenchido quando `status=merged`; ≤1 `in-progress`; sem pulo de `order`.
- **Descritivo** (a tabela declara a forma; os checks **não** impõem): texto de
  `title`, conteúdo de `depends_on`, formato de `merge`, continuidade de `order`
  (buraco não reprova), coerência `id`×`dir`.

## 3. Cerimônia — limites explícitos (SPEC §4.4)

- **Isenção** (não gera PRD nem ADR): typo, doc, rename interno, formatação,
  refactor sem comportamento observável, bump de patch. Arquitetural sem valor de
  produto novo ⇒ ADR sem PRD.
- **Teto** (🟡 processo — sem mecanismo; a recusa é humana): 5 ADRs por PRD;
  acima disso o PRD se divide em dois escopos.
- **Destino** (🟡 processo — sem mecanismo; a recusa é humana): todos `merged`
  ⇒ `.spec/archive/[YYYYMMDD]-prd-{prd-id}/`; `prd_status: archived` só
  **depois** do move.
- **ADR decision-only**: exceção declarada quando o SDD do ADR já é o ciclo
  corrente ⇒ só `ADR.md`; `ADR-01` valida `ADR.md` + 1:1 com o índice.

## 4. Operação de branch/PR sem `gh` (RF-09)

Por ADR: `git checkout -b adr/{prd-id}/{nn}-{slug}` → `git push -u origin <branch>`
→ imprimir a URL de compare (`<remote>/compare/main...<branch>`). O **merge é
humano** — 🟡 processo, sem mecanismo (1 ADR = 1 PR = 1 revisão). Nenhum passo
exige `gh`; nenhum push automático.

## 5. Escopo de escrita e níveis de garantia

- `product-manager`/`architect` escrevem apenas `.spec/prd/**` — **mitigação de
  processo** do gap D11 (⚠️ lacuna aberta: sem `gate.js`, não há deny; `gate.js`
  fica intocado — SPEC §12.1). O bloqueio é o PR humano.
- `prompt-optimizer` valida a **demanda** (E1..E6), **nunca** o PRD (fecha o
  parcial D13; `workflow-rules.md` §0).
- `.agents/skills/prd-adr-pipeline/` é **path propagável** (installer). O
  enforcement da esteira é 🟡 processo em todo destino **incluindo este repo**:
  não há CI prometido e `scripts/static-checks.mjs` (que rodaria `checks.mjs`)
  não existe aqui — os checks só valem por invocação explícita.

## 6. O que cada afirmação prova (SPEC §5)

| Check | Mecanismo citado | Nível |
|---|---|---|
| `PRD-01` | `checks.mjs` (`runPrdChecks`) — invocação explícita; **não** ligado ao `suiteFull` | 🟡 processo (repo e destino) |
| `ADR-01` | idem `checks.mjs` | 🟡 processo (repo e destino) |
| `ADR-02` | idem `checks.mjs` | 🟡 processo (repo e destino) |
| `V4`/`SDD-01..03`/`R-NODENY` | `scripts/sdd-checks.mjs` — **não existe neste repo** (invocação explícita) | 🟡 processo (repo e destino) |
| `V17` | idem `sdd-checks.mjs` — prova só o **marcador** da tabela, não o conteúdo das linhas | 🟡 processo (repo e destino) |
| merge de path protegido | trailer `Harness-Gate-Change` (pre-commit + `harness-integrity.yml`) — ⚠️ **nenhum dos dois existe neste repo** | 🟡 processo (repo e destino) |

Invariante **sem mecanismo** (🟡 processo): rótulo da esteira não cria valor novo
de `current_phase` — `gate.js` só compara com `Completed`; a recusa é humana.
