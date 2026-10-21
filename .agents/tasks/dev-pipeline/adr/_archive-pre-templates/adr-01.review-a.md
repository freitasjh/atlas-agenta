# ADR-01 Revisão Independente A — Vigência da grade e passo-base de slots em `professionals`

**Revisor:** REVISOR INDEPENDENTE A  
**Data:** 2025-10-20  
**Status da ADR:** pending → _parecer abaixo_

---

## Resumo Executivo

A ADR-01 implementa duas colunas novas em `professionals` (`schedule_start_date`, `schedule_end_date`, `slot_step_minutes`) por meio de uma migration SQL idempotente, com validação por CHECK constraints e conformidade total aos critérios de aceite definidos no documento. A implementação é **aprovada com nenhuma questão bloqueante** — o código está correto, bem-documentado e verifica-se contra todos os AC.

**Contexto:** esta é a primeira ADR de uma demanda de evolução do módulo de agenda, focada em dados/banco. As colunas novas são base para a geração de slots sob demanda (ADR-05 em diante).

---

## Verificação de Critérios de Aceite (todos passam)

| AC | Descrição | Teste | Resultado | Observação |
|---|---|---|---|---|
| **AC-08a** | `schedule_start_date > schedule_end_date` rejeitado | UPDATE com datas invertidas | ✅ PASSA | CHECK `professionals_schedule_vigencia_coherent` bloqueia |
| **AC-08b** | `slot_step_minutes` fora de 5..240 rejeitado | UPDATE com valores 3 e 300 | ✅ PASSA | CHECK `professionals_slot_step_minutes_check` rejeita ambos |
| **AC-08c** | Datas nulas aceitas (sem limite) | UPDATE com NULL em ambas | ✅ PASSA | Vigência fica sem limite nas extremidades |
| **AC-08c** | Datas válidas aceitas | UPDATE com 2025-01-01..2025-12-31 | ✅ PASSA | CHECK coerente, rejeita apenas invertidas |
| **AC-08b** | Default de `slot_step_minutes` é 30 | INSERT novo professional sem valor | ✅ PASSA | Coluna assume `default 30` corretamente |
| **Re-apply** | Migration é idiopotente | Rodar SQL da migration novamente | ✅ PASSA | `add column if not exists` + bloco `do $$` com guarda de constraint |
| **AC-03 (parcial)** | RLS cobre as colunas novas | Verificar políticas em pg_policies | ✅ PASSA | `professionals_write_admin` já existe e aplica-se |

---

## Análise Detalhada

### 1. Escopo e Alinhamento com a ADR

A ADR descreve com precisão:
- **Duas colunas de vigência** (`schedule_start_date`, `schedule_end_date`) como `date` — sem `timestamptz`, correto por RNF-SEG-05 (conversão para UTC é feita na geração de slots, não na persistência).
- **Uma coluna de passo-base** (`slot_step_minutes`) como `int`, range 5..240, default 30 — exatamente conforme o PRD §9 aprovado no gate.
- **Localização em `professionals`** — justificativa clara: é um valor **único por profissional**, não por dia (evita duplicação e inconsistência se estivesse em `working_hours`).
- **RBAC admin-only no MVP** — design confirmado; a policy `professionals_write_admin` já cobre; nenhuma nova policy criada (correto para não ampliar superfície de escrita numa tabela que carrega `profile_id`/`active`).

### 2. Qualidade da Migration

#### Idempotência
O SQL é robusto:
- `add column if not exists` — seguro contra re-apply.
- Constraint de coerência protegido por bloco `do $$` com `if not exists (select 1 from pg_constraint...)` — reutiliza a guarda de catálogo do Postgres para evitar erro em re-apply.
- Não toca em migrations anteriores e não cria ciclos de dependência.

#### Documentação
Comentários do SQL estão **excelentes**:
- Cita a ADR, o RFC, os números de mensagem do usuário (rastreabilidade).
- Explica o **por quê** de cada coluna (vigência = período do usuário, passo = granularidade de encaixe).
- Justifica a localização em `professionals` (não em `working_hours`).
- Marca explicitamente RBAC "admin-only no MVP" + referência ao backlog de own-update.
- Declara conformidade com RNF-SEG-05 (date, não timestamptz) e RNF-SEG-06 (migration nova, nunca editar aplicada).
- **Não há segredos em código SQL** — RNF-SEG-07 cumprido.

#### Constraints
Os CHECKs refletem exatamente os AC:
- `slot_step_minutes between 5 and 240` — range validado, com padrão 30.
- `schedule_start_date is null or schedule_end_date is null or schedule_start_date <= schedule_end_date` — permite null em qualquer extremidade, invalida só inversão com ambas presentes.

### 3. Cobertura de Segurança (RNF multi-tenant + RBAC)

**RNF-SEG-01** — Isolamento multi-tenant por RLS:
- Tabela `professionals` já tem `tenant_id` com default `current_tenant_id()` (set em migration `20250218090000`).
- RLS já habilitada em `professionals` com política `professionals_select_same_tenant` (USING `tenant_id = current_tenant_id()`).
- As colunas novas herdam a isolação — não há coluna nova `tenant_id` e não há policy nova necessária.
- ✅ Cumprido.

**RNF-SEG-02** — `tenant_id` do JWT, nunca do cliente:
- A migration não toca em cliente; dados derivados (geração de slots, ADR-05) lerão as colunas novas via RLS já em vigor.
- ✅ Cumprido por design.

**RNF-SEG-03** — RBAC preservado:
- `admin`: escreve vigência/passo-base de qualquer profissional (policy `professionals_write_admin` cobre).
- `professional`: **não escreve em `professionals` nesta entrega** — sem policy de own-update (design confirmado no gate: MVP = admin-only).
- `receptionist`: lê (select sob RLS), não escreve.
- ✅ Cumprido; escrita restrita por policy existente.

**RNF-SEG-06** — Schema versionado, migration nova:
- Timestamp `20250221090000` é posterior a `20250220091000_messages.sql` (última aplicada).
- Nunca edita migration aplicada.
- ✅ Cumprido.

**RNF-SEG-07** — Sem segredos:
- ✅ Nenhum secret, chave, token ou credencial em SQL.

### 4. Dados Corretos e Coerência

**Tipos de dados:**
- `schedule_start_date`, `schedule_end_date` como `date` — correto. Semântica de "dia de calendário no fuso do tenant", sem instante. A conversão para UTC (início/fim do dia em UTC) fica para a geração de slots (ADR-05), aplicada na borda.
- `slot_step_minutes` como `int` — correto. Range 5..240 min cobre granularidade de 5 min (dentista de alta rotação) até 4h (workshops, retiros). Default 30 min é padrão razoável (metade de hora, fácil para UI).

**Coerência de vigência:**
- CHECK permite null em qualquer extremidade: `valid from 2025-01-01` (sem fim) ou `until 2025-12-31` (sem início) ou ambas nulas (sem limite). Semântica clara e sem surpresa.
- Rejeita apenas `start > end` com ambas presentes. Correto.

### 5. Completude vs. Escopo

A migration implementa **exatamente** o escopo da ADR-01, nada mais, nada menos:

- ✅ Colunas de vigência em `professionals`.
- ✅ Coluna de passo-base em `professionals`.
- ✅ CHECKs de coerência (vigência + range de passo).
- ✅ Idempotência.
- ✅ Sem policy nova (já coberta).
- ✅ Sem tabela nova (isto é ADR-02).
- ✅ Sem gerador de slots (isto é ADR-05).

**Não deixa pendências suspensas** na ADR-01 que deveriam ter sido resolvidas.

### 6. Testes Realizados (Verificação Local)

Todos os AC foram validados localmente em `supabase start` + `psql`:

```
✅ AC-08a: UPDATE com schedule_start_date > schedule_end_date é bloqueado
✅ AC-08b: UPDATE com slot_step_minutes = 3 é bloqueado (< 5)
✅ AC-08b: UPDATE com slot_step_minutes = 300 é bloqueado (> 240)
✅ AC-08c: Datas nulas aceitas (vigência sem limite)
✅ AC-08c: Datas válidas (2025-01-01..2025-12-31) aceitas
✅ AC-08b: INSERT novo professional assume slot_step_minutes = 30 (default)
✅ Re-apply: Migration rodada novamente sem erro (idempotente)
✅ RLS: Tabela está sob isolamento tenant_id já existente
```

Nenhum teste falhou. **Todos os AC passam.**

### 7. Build e CI

- ✅ `npm run typecheck` — sem erro (TypeScript strict).
- ✅ `npm run build` — sucesso (bundle gerado).
- Não há código TypeScript novo na ADR-01 (é migration SQL pura).

---

## Observações e Boas Práticas

1. **Documentação de SQL excepcional**: o bloco de comentários inicial explica contexto, RFC, decisão e conformidade de forma que um reviewer ou operador pode entender a intenção sem ler a ADR inteira.

2. **Idempotência bem-feita**: o bloco `do $$` é a prática Postgres correta para guarda de constraint em re-apply. Não usa `if not exists` de forma inadequada (que não cobre constraint).

3. **Semântica de design clara**: a escolha de `date` (não `timestamptz`) para vigência é explícita e justificada — reduz confusão sobre fuso/instante.

4. **Conformidade regulatória**: nenhuma coluna de `tenant_id` nova e nenhuma policy nova reduzem superfície de configuração (menos margem para erro de RLS).

---

## Questões Abertas (Não-Bloqueantes, para Backlog)

1. **RBAC de own-update (professional edita vigência/passo de si mesmo)**: a ADR deixa explícito que é "admin-only no MVP", com backlog registrado. Isto é correto — não bloqueia esta entrega e mantém a superfície de escrita em `professionals` mínima (evita ampliar acesso na tabela que carrega `profile_id`, `active`). Quando implementado (ADR futura), exigirá policy `professionals_update_own` com `WITH CHECK (...)` restrita a estas colunas — desenho futuro claro.

2. **Feriado de tenant inteiro**: fora de escopo (ADR-02 cobre exceções por profissional/data). Correto — não inventar tabela de `tenant_holidays` agora.

---

## Veredito

**✅ APROVADO** — sem questões bloqueantes.

A migration está correta, bem-documentada, segura (RLS + RBAC preservados), idempotente e todos os critérios de aceite passam em teste local. Está pronta para o merge.

### Checklist Final

- ✅ Escopo alinhado com ADR e PRD.
- ✅ Segurança multi-tenant e RBAC cumpridos.
- ✅ Migrations novas, nunca editadas; idempotentes.
- ✅ Sem segredos; sem cliente comprometido.
- ✅ Todos os AC testados e passando.
- ✅ Build/typecheck limpos.
- ✅ Documentação SQL clara e tracável.

**Recomendação:** Mover ADR-01 para `approved` e proceder com ADR-02 (schedule_overrides).

