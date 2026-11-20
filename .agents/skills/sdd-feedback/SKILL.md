---
name: sdd-feedback
description: "10-Point Summary template for SDD phases. Mandatory after every SDD command (spec-from-adr/tasks-from-adr/verify/archive). Eliminates 'done without proof' anti-pattern."
---

# SDD Feedback: 10-Point Summary

Gere resumo estruturado APÓS qualquer comando SDD que gere ou modifique artefatos.

## Quando Usar

| Comando SDD | Obrigatório? |
|-------------|--------------|
| `spec-from-adr` | ✅ SIM |
| `tasks-from-adr` | ✅ SIM |
| `verify` | ✅ SIM |
| `archive` | ✅ SIM (resumo final) |
| legado: `generate-proposal`/`generate-spec`/`generate-plan`/`generate-tasks` | ✅ SIM, só em ciclos `unit: legacy` |

## Template 10-Point

```
## ✅ [Command Name] Completed

### 🎯 Key Decisions Made (Top 3)
1. [Decision] — **Rationale:** [Why]
2. [Decision] — **Rationale:** [Why]
3. [Decision] — **Rationale:** [Why]

### 📋 What Was Generated
- [Artifact 1]: [Description]
- [Artifact 2]: [Description]

### 🔍 Important Items to Review (Top 3)
1. [Critical item] — Why it matters
2. [Important detail] — Potential impact
3. [Edge case] — How it affects design

### ⚠️ Watch Out For (Top 2)
- [Issue] — **How to avoid:** [Guidance]
- [Mistake] — **How to avoid:** [Guidance]

### 🔄 What This Enables Next
- **Option 1:** [Next step] — Best if: [Condition]
- **Option 2:** [Alternative] — Best if: [Condition]

📊 **Feature Status:** [Name] ([Stage]) → Next: [Next]
   Progress: [●●●○○] [X]% | Completed: [N] of [Total] | Dependencies: [Status]

**Your options:** [A] Proceed [B] Modify [C] Explain [D] Show status
```

## Mapeamento Comando → Artefato → Extração

### spec-from-adr
- **Ler:** `.spec/prd/{prd-id}/ADRs/ADR-00N-{slug}/SPEC.md` (+ `ADR.md`/`PRD.md`)
- **Extrair:** `RF`/`NFR` rastreáveis ao ADR, interface congelada, invariantes, delta specs
- **Watch-outs:** requisito sem origem no ADR, critério de aceite não executável

### tasks-from-adr
- **Ler:** `.spec/prd/{prd-id}/ADRs/ADR-00N-{slug}/TASKS.md`
- **Extrair:** número de tasks, dependências, complexidade, cobertura `RF`→task
- **Watch-outs:** task sem teste, dependência circular, ID fora de `[A-Z]+-\d+`

### verify
- **Ler:** `.spec/prd/{prd-id}/ADRs/ADR-00N-{slug}/VERIFY.md`
- **Extrair:** completeness, correctness, coherence (3 dimensões)
- **Watch-outs:** gaps restantes, débitos técnicos, `VERIFY.md` ausente com ADR `merged`

### archive
- **Ler:** `.spec/archive/[YYYYMMDD]-prd-{prd-id}/` (PRD inteiro movido)
- **Extrair:** ADRs fechados, delta mesclado, lições
- **Watch-outs:** ADR sem `VERIFY.md`, delta não mesclado

### legado (`generate-proposal`/`generate-spec`/`generate-plan`/`generate-tasks`)
- **Ler:** `.spec/[backend|frontend]/[feature]/` (ciclo de 4 artefatos congelado)
- **Extrair:** mesma estrutura da v1
- **Watch-outs:** não é caminho de feature nova (`workflow.md` §3)

## Integração com Brain

Após cada summary, avaliar se há lição relevante:

```python
# Se summary revelou gap ou issue crítica:
brain_store(
    layer="regras",
    path="atlas-ecm/sdd-lessons/[feature]/[date]",
    content="## SDD Lesson\n\n### Contexto\n...\n### Issue\n...\n### Solução\n...",
    scope="projetos"
)
```

## Integração com Feature Status Dashboard

Incluir brief status no final de todo summary:

```
📊 **Feature Status:** [name] ([stage]) | [progress]% | [N/M complete]
```

Stage values: Specifying(20%) → Planning(40%) → Tasking(60%) → InProgress(80%) → Complete(100%)

## Exemplo Pós-generate-spec

```
## ✅ Specify Completed

### 🎯 Key Decisions Made
1. **Multi-tenancy via tenant_id column** — Rationale: Isolamento por schema complexo demais para fase atual
2. **JWT RS256 para auth** — Rationale: Padrão industry, suporta validação stateless
3. **Flyway para migrations** — Rationale: Controle versionado, rollback possibility

### 📋 What Was Generated
- `.spec/tenant-user-management/SPEC.md`: 12 requisitos, 8 ADRs, 5 invariantes

### 🔍 Important Items to Review
1. **RF-05: invite flow** — Verificar se SHA256+TTL 72h atende caso de uso real
2. **ADR-03: role hierarchy** — Confirmar que PLATFORM_ADMIN não expõe via API tenant
3. **Invariant I-02: tenant isolation** — Validar em todas as queries JPQL

### ⚠️ Watch Out For
- **CompanyUser composite key** — How to avoid: Usar @IdClass, não @EmbeddedId
- **Block per-tenant vs global** — How to avoid: Flag `blocked` + `blocked_global` separados

### 🔄 What This Enables Next
- **Option 1:** Run `/sdd.plan` — Best if: Requisitos claros
- **Option 2:** Run `/sdd.clarify` — Best if: Dúvidas em edge cases

📊 **Feature Status:** tenant-user-management (Specified) → Next: Planning
   Progress: [●○○○○] 20% | Completed: 0 of 3 | Dependencies: None

**Your options:** [A] Proceed to planning [B] Modify requirements [C] Clarify edge cases [D] Show status
```
