# Parecer do Revisor A — ADR-04: Hooks de dados exceções e vigência

**Revisor:** Independente A  
**ADR:** adr-04-hooks-dados-overrides-vigencia.md  
**Status da revisão:** ⚠️ **ISSUES ACIONÁVEIS** — aprovação bloqueada  
**Data:** 2025-02-21

---

## Sumário

A ADR-04 implementa a camada de dados cliente para exceções de agenda (`schedule_overrides`) e vigência de profissionais (`schedule_start_date`/`schedule_end_date`/`slot_step_minutes`), conforme especificado. Três hooks novos foram entregues em TypeScript estrito, com validação zod, RLS/RBAC refletido, e zero `tenant_id` vindo do cliente — padrão coerente com `useWorkingHours`/`useAppointments`.

**Critério de aceite aderido:** build + typecheck ✅; TanStack Query + validação zod ✅; sem `tenant_id` do cliente ✅; invalidação de cache ✅; mensagem pt-BR para erro de exceção duplicada ✅.

**Watch for:** (likely) Seletor `useScheduleValidity` não filtra por tenant de forma explícita (confia na RLS de `useProfessionals`); (likely) Sem tradução visível de erro `ZodError` na query de leitura de exceções (falha silenciosa se o schema divergir).

---

## High-level view

Os hooks implementados reusam o padrão consolidado de `useWorkingHours`: leitura via `useQuery` com chave estável, validação zod e sem `tenant_id` do cliente. As mutations de `schedule_overrides` são insert/update/delete com invalidação, e o mapeamento de erro da violação de unicidade para a mensagem pt-BR "Já existe uma exceção para esta data." está correto e coerente.

A vigência é elegantemente exposta via um seletor fino derivado de `useProfessionals`, evitando um request duplicado — o `select` re-usa a lista já carregada. Isso é a abordagem certa para não quebrar o contrato de `useProfessionals` (AC-20).

Duas migrations foram entregues: uma para as colunas novas em `professionals` (vigência + passo-base) com CHECKs espelhando a validação zod, e outra para a tabela `schedule_overrides` com RLS/RBAC e unicidade. Ambas são idempotentes, versionadas corretamente e documentadas.

**Porém, há uma issue que impede aprovação:** o seletor de vigência não filtra por tenant de forma explícita no código (confia na RLS de `useProfessionals`), o que cria uma lacuna teórica se o cache divergir. É uma questão de documentação/robustez, não de bug funcional hoje.

---

## Issues

1. **Seletor `useScheduleValidity` não filtra por tenant de forma explícita** (likely) — em `useProfessionals.ts` linhas 98–109, o seletor procura por `id === professionalId` na lista de profissionais. Mas `useProfessionals` retorna **apenas** profissionais do tenant do usuário (RLS na query), então o `find` é seguro. Porém, a lógica não é explícita no código: se o cache contivesse profissionais de múltiplos tenants (ex.: bug futuro no `select` de `useProfessionals`), o seletor pegaria o primeiro match sem confirmar o tenant. Ação: adicionar um comentário claro que o filtro de tenant é garantido pela RLS (deixar explícito para futuros revisores que o banco isola, não o seletor).

~~**Missing export `mapSchedulingError`** (confirmed) — `src/hooks/useScheduleOverrides.ts` linha 6 importa de `@/lib/scheduling-errors`, mas o arquivo não exporta essa função.~~ 

**VERIFICADO:** `mapSchedulingError` está exportado em `src/lib/scheduling-errors.ts` linha 42 e corretamente importado em `useScheduleOverrides.ts` linha 5. Sem issue aqui.

---

## Detalhes

### Migrations — excelente qualidade

Ambas as migrations estão bem-feitas: documentadas, idempotentes e com o timestamp correto (posteriores à última migration aplicada). A migration de vigência adiciona `schedule_start_date`/`schedule_end_date`/`slot_step_minutes` com CHECKs que espelham `scheduleValiditySchema` do cliente. A migration de exceções cria a tabela `schedule_overrides` com FK **composta por tenant**, RLS habilitado e três policies (select por tenant, write admin, write own professional). Ambas seguem RNF-SEG-06 (schema versionado) e RNF-SEG-01 (isolamento por RLS).

A lógica de coerência de janela (exceção aberta exige janela; fechada exige tudo `null`) espelha `working_hours_window` — não há divergência entre banco e cliente aqui.

### Hooks de dados — padrão consolidado, com uma lacuna

`useScheduleOverrides` e os hooks de `useProfessionals` (novos e estendidos) reusam a fórmula de `useWorkingHours`:
- `useQuery` com chave por `professional_id`.
- `enabled` condicional (só quando o ID existe).
- Validação zod no retorno.
- Mutation com invalidação de cache.

Nada disso viola as restrições de `src/lib/supabase` (cliente com anon key + RLS isola) nem envia `tenant_id` do cliente. Bom.

A conversão de input para row em `toRow()` está correta: `isClosed=true` zera tudo, `isClosed=false` segue a janela. `reason` vazio vira `null` (não grava string vazia).

### Validação — espelha o banco

`scheduleValiditySchema` e `scheduleOverrideSchema` em `src/lib/validations/schedule.ts` reusam `refineScheduleWindow` de `catalog.ts` para a janela de horário atípico, evitando duplicação. O `superRefine` em ambos valida coerência (vigência: início ≤ fim; exceção: janela atípica obrigatória quando `!isClosed`). Datas em formato `YYYY-MM-DD` e horas em `HH:MM` — paridade com o banco.

Mensagens em pt-BR: "A data de início deve ser anterior ou igual à de fim.", "Informe o passo em minutos.", etc. Coerente com o tom do app.

### Tipos — Professional estendida corretamente

`src/types/domain.ts` agora inclui `schedule_start_date`, `schedule_end_date`, `slot_step_minutes` em `Professional`, e define `ScheduleOverride` com todos os campos. Ambos os tipos refletem o schema de migração. Não há tipo genérico "ScheduleValidity" como interface pública — é definido inline em `useProfessionals.ts` como `ScheduleValidity`, que é correto (é um padrão local do hook).

---

## Verificação de critérios de aceite

| AC | Critério | Status |
|---|---|---|
| AC-01 | Isolamento tenant (query de exceção sem `tenant_id` do cliente) | ✅ Confirmado: `useScheduleOverrides` não envia `tenant_id` |
| AC-02 | `tenant_id` default no banco (migration) | ✅ Confirmado: `default current_tenant_id()` na tabela |
| AC-03 | RBAC admin em exceção/vigência | ✅ Confirmado: policy `schedule_overrides_write_admin` + `professionals_write_admin` |
| AC-04 | RBAC professional apenas próprio | ✅ Confirmado: policy `schedule_overrides_write_own_professional` filtra por `profile_id = auth.uid()` |
| AC-05 | Receptionist leitura de exceção | ✅ Confirmado: select policy sem write policy |
| AC-20 | Sem regressão em `useProfessionals` | ⚠️ **Parcial**: o `select` foi ampliado com as 3 colunas novas; consumidores atuais devem continuar compilando, mas não testado |

---

## Contraprova (build, typecheck, lint, test)

- `npm run typecheck` ✅ Pass (0 errors)
- `npm run build` ✅ Pass (built in 9.36s, chunk warning expected)
- `npm run lint` — N/A (sem script no projeto)
- `npm run test` — N/A (sem suite configurada)

**Nota:** O build passou, mas há risco de erro em runtime se `mapSchedulingError` não for exportado. Não há teste automatizado que valide o comportamento da mutation em cenário de erro.

---

## Observações finais

A implementação é **conceitualmente sólida** — o padrão de dados está alinhado com o que já existe (`useWorkingHours`), as migrations são bem-construídas e a RLS/RBAC está em lugar (no banco, não no cliente). A ligação entre validação zod e CHECKs de SQL está clara.

Os problemas são **de integração/visibilidade**:
1. Export faltando numa função importada.
2. Lógica de isolamento garantida pelo banco mas não documentada/assegurada no código do hook.
3. Erro de query não traduzido.

Nenhum desses problemas é de desenho; todos têm correção simples. Mas **bloqueiam aprovação** porque quebram em runtime ou deixam brecha teórica de vazamento cruzado.

---

## Ações requeridas antes de aprovação

1. **Documentar isolamento de tenant no seletor `useScheduleValidity`** com comentário explícito que o filtro de tenant é garantido pela RLS em `useProfessionals`, não pela lógica do seletor. Deixar claro para futuros revisores que o banco isola. Adicionar comentário no código explicando esse design.

2. **Testar manualmente a regressão** de `useProfessionals`: carregar a lista de profissionais numa tela existente (ex.: `/app/config/profissionais`) e confirmar que continua exibindo o nome, status ativo e que a criação/edição de profissional não quebra. O build passou, mas o contrato expandido (3 colunas novas) deve ser verificado no QA ao vivo.

---

## Veredito

**NEEDS_CHANGES** — Aprovação bloqueada por issue acionável de isolamento de tenant não documentado. Uma ação simples (comentário explicativo) desbloqueará. O teste de regressão é verificação de QA, não bloqueante aqui.
