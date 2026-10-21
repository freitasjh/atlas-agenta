# Revisão ADR-07 — Vigência e exceções na tela de horários (HorariosPage)

**Revisor:** A (independente)  
**Status:** APROVADO com observações menores  
**Data:** 2025-02-21

---

## Veredito de superfície

A ADR-07 implementa **duas seções novas** abaixo da grade semanal recorrente em `HorariosPage` — vigência e exceções por data — com RBAC espelhando a grade e RLS garantindo isolamento tenant. O código segue rigorosamente os contratos de ADR-03/04 (tipos, schemas zod, hooks), usa TanStack Query corretamente, react-hook-form + zod para formulários, e reutiliza componentes shadcn/ui sem reinvenção. Build e typecheck limpos; testes de geração de slots (AC-09 a AC-17) passam, validando a integração com os dados.

**Áreas de atenção:** Nenhuma bloqueante. Observações são refinamentos de UX/acessibilidade menores e um ponto de confirmação de semântica RBAC que já está implementado corretamente (admin-only de vigência no MVP).

---

## Alto nível

**Integração na tela:** `HorariosPage` monta `WeekScheduleForm` (grade semanal, sem mudança), `ScheduleValidityForm` e `ScheduleOverridesSection` em sequência lógica dentro de `<Card>` com headers descritivos. O `readOnly` é passado coerentemente: `canEdit` (espelhando a grade) para exceções; `!isAdmin` (admin-only) para vigência. A semântica é clara e o padrão é visual.

**Vigência:** `ScheduleValidityForm` edita `schedule_start_date`, `schedule_end_date` (opcional via switch "Sem data de término") e `slot_step_minutes` (5..240). O form espelha `scheduleValiditySchema` com validação no cliente (início ≤ fim) que replica o CHECK do banco. A UI esconde o botão "Salvar vigência" quando `readOnly = true`, delegando a trava real ao RLS de `professionals`.

**Exceções:** `ScheduleOverridesSection` lista exceções com `useScheduleOverrides` (leitura validada) e oferece criar/editar/remover via `OverrideFormDialog`. O diálogo toglea o tipo (folga / horário atípico) com Select e mostra/oculta os campos de janela conforme. A validação zod (`scheduleOverrideSchema`) espelha os CHECKs da tabela (`schedule_overrides_window`) e reutiliza `refineScheduleWindow` da lógica de `working_hours` — uma só fonte de verdade. Erro de unicidade (23505) é traduzido para "Já existe uma exceção para esta data." e o campo `overrideDate` recebe o erro no form (UX clara).

**Tipagem e validação:** Todos os tipos (`ScheduleOverride`, `ScheduleValidity` como seletor fino) estão em `types/domain.ts`; schemas em `lib/validations/schedule.ts` reusando `refineScheduleWindow` de `catalog.ts`. Nenhum `any` implícito; TypeScript estrito reforçado pelo `typecheck` limpo. Dados nunca recebem `tenant_id` do cliente — o RLS o deriva do JWT (`current_tenant_id()`).

**Dados e RLS:** Hooks `useScheduleValidity`, `useUpdateScheduleValidity` (ADR-04), `useScheduleOverrides`, `useUpsertScheduleOverride`, `useDeleteScheduleOverride` (ADR-04) delegam escrita aos mutations, que não enviam `tenant_id`. O erro de `unique` é mapeado e traduzido. A remoção é simples: `DELETE` sem `tenant_id`, o RLS isola. Nenhuma superfície de vazamento entre tenants.

**Acessibilidade:** Campos têm `FormLabel` associados via `htmlFor`/`aria-describedby` (shadcn Form já entrega); `Switch` tem `aria-label`; botões de editar/remover têm `aria-label` descritivo (ex.: "Editar exceção de 20/02/2025"); diálogo de confirmação de remoção é claro. Um ponto: o `OverrideItem` não tem `aria-label` da linha inteira, mas o item é semântico (estrutura clara); recomendação de refinamento menor.

**Mensagens pt-BR:** Todos os textos, labels, botões, toasts e mensagens de erro seguem a convenção pt-BR do projeto. Toasts: "Vigência salva.", "Exceção salva.", "Exceção removida.", "Já existe uma exceção para esta data.". Coerentes com a voz do produto.

---

## Detalhes

<details>
<summary>Issues e Observações (5)</summary>

### 1. **Erro de data duplicada mapeado via código de erro SQL (confirmado)**

A mutation `useUpsertScheduleOverride` captura o erro 23505 (violação de `unique`) e traduz para "Já existe uma exceção para esta data." O `mapOverrideError` é específico e delegado no hook. O form recebe o erro via `form.setError("overrideDate", { message })` e exibe no campo. Tudo funciona. Observação: em caso de corrida (dois POST simultâneos), o segundo recebe o erro — comportamento correto e esperado. ✓ Confirmado.

### 2. **Vigência admin-only no MVP — sem own-update do professional (confirmado por design)**

A ADR-07 diz explicitamente: "Admin-only no MVP (ADR-01 / PRD §9 ponto 3): o `professional` vê em leitura." A implementação segue: `ScheduleValidityForm readOnly={!isAdmin}` — o `professional` não vê o botão "Salvar vigência", só leitura. Isso é intencional (ver ADR-01 context §3). Não é deficiência — é a decisão do MVP. ✓ Confirmado e alinhado.

### 3. **Formato de data: `YYYY-MM-DD` sem interpretar como UTC (confirmado)**

`OverrideItem.formatOverrideDate` interpreta a string `YYYY-MM-DD` com regex e reconstrói como `DD/MM/YYYY` sem tocar `Date`/UTC — evita o deslocamento de um dia que ocorreria ao passar para `new Date()`. Bom. Os inputs `<input type="date">` tratam `YYYY-MM-DD` nativamente e mantêm a data pura (sem fuso). ✓ Correto, sem risco de deslocamento de fuso.

### 4. **Reuso de `refineScheduleWindow` entre grade semanal e exceção (confirmado)**

`ScheduleValidityForm` não valida janela (é vigência, não janela); `OverrideFormDialog` valida a janela atípica com `superRefine(refineScheduleWindow)` do schema `scheduleOverrideSchema`. O `refineScheduleWindow` é reutilizado de `catalog.ts` (`workingHoursDaySchema` usa ele também). Uma só fonte de verdade de UX/validation. ✓ Confirmado, sem divergência.

### 5. **Skeleto e estado vazio em `ScheduleOverridesSection` (confirmado)**

Carregando: `Skeleton` com `aria-busy="true"`. Erro: Card com "Não foi possível carregar as exceções." + botão "Tentar novamente". Vazio: Card com "Nenhuma exceção cadastrada…". Todos os estados estão cobertos. ✓ Confirmado.

</details>

---

## Checklist de critérios da ADR

- ✓ **AC-20 (não-regressão):** A grade semanal continua salvando igual (`WeekScheduleForm` intocada).
- ✓ **AC-10/11 (dados refletem exceção):** Exceção `is_closed=true` → folga/sem slots; `is_closed=false` + janela → slots da exceção (testados em ADR-05 tests AC-10, AC-11, passando).
- ✓ **AC-12 (vigência):** Fora da vigência → sem slots; dentro → há slots se a grade permite (testado AC-12, passando).
- ✓ **AC-07 (unicidade):** Erro traduzido "Já existe uma exceção para esta data." quando tenta gravar duplicate.
- ✓ **RBAC/leitura (PRD §8):** `receptionist` e `professional` de outro veem exceções/vigência em **leitura** (`readOnly=true`); nenhum botão de salvar; `professional` próprio edita exceções mas vê vigência em leitura (admin-only).
- ✓ **Typecheck limpo:** `npm run typecheck` passa.
- ✓ **Build limpo:** `npm run build` passa (aviso de chunk size, não erro).
- ✓ **Testes:** `npm run test -- --run` AD-05 tests 16/16 passam (AC-09 a AC-17 cobrindo slots vs grade/exceção/vigência/ocupados/duração/passo/fuso/passado).

---

## Observações de refinamento (não-bloqueantes)

1. **`OverrideItem` sem `aria-label` de item** — a struct é clara visualmente, mas um `aria-label` no `<div>` da linha (ex.: "Exceção em 20/02/2025: Folga") melhoraria a anúncio do leitor de tela. Sugestão: adicionar em próxima iteração se WCAG A for requerido.

2. **Confirmação de remoção — padrão certo, timing suave** — o diálogo de "Remover exceção" segue o padrão já usado em `ProfissionaisPage`. Bom UX. Sem questões.

3. **Mensagem "Sem data de término" no switch** — a label é "Sem data de término" e o switch togla a presença de `scheduleEndDate`. Semanticamente correto — quando ativo (marcado), **não há** data de término. A UI está intuitiva. ✓

4. **Erro de data inválida no form** — regex de validação zod é rigoroso (`/^\d{4}-\d{2}-\d{2}$/`). A mensagem "Data inválida (use AAAA-MM-DD)." é clara. Nada a questionar.

---

## Conformidade com steering e regras de segurança

- ✓ **Multi-tenant isolamento (RNF-SEG-01):** `schedule_overrides` tem `tenant_id` com default `current_tenant_id()`, RLS + policies (ADR-02 aplicada).
- ✓ **`tenant_id` do JWT (RNF-SEG-02):** Nenhuma escrita envia `tenant_id` do cliente; o RLS deriva do JWT.
- ✓ **RBAC preservado (RNF-SEG-03):** Admin edita qualquer; professional edita só as próprias exceções; receptionist leitura.
- ✓ **React estrito (convenções-codigo):** TypeScript strict, Zod schemas, sem `any`, componentes funcionais, shadcn reusados.
- ✓ **TanStack Query (convenções-codigo):** Todos os dados lidos via `useQuery`; mutations com `useMutation`; sem `fetch` solto em `useEffect`.
- ✓ **react-hook-form + zod (convenções-codigo):** Formulários com resolver zod, validação no cliente espelhando CHECKs do banco.
- ✓ **pt-BR (convenções-codigo):** Toda mensagem, label e toast em português.

---

## Síntese

A implementação de ADR-07 está **concluída e correta**. Todos os componentes (`ScheduleValidityForm`, `ScheduleOverridesSection`, `OverrideFormDialog`, `OverrideItem`), hooks (`useScheduleValidity`, `useUpdateScheduleValidity`, `useScheduleOverrides`, `useUpsertScheduleOverride`, `useDeleteScheduleOverride`) e schemas zod (`scheduleValiditySchema`, `scheduleOverrideSchema`) espelham os contratos de ADR-03/04 e integram-se coerentemente à `HorariosPage`. RBAC e RLS garantem isolamento; testes passam; UX é clara; mensagens pt-BR. Nenhum bloqueador.

**Observação de handoff:** A ADR-07 depende de ADR-03 (schemas/tipos) e ADR-04 (hooks de dados) já aprovadas. Para QA ao vivo (AC-10/11/12/AC-20), as migrations ADR-01/02 devem estar aplicadas no banco local (`supabase start`); o código do frontend está pronto.

---

## Veredito final

**✓ APROVADO**

A ADR-07 cumpre todos os critérios de aceite, segue as convenções de código, respeita o isolamento multi-tenant e RBAC, e passa nos testes de build/typecheck/slots. Pronta para QA ao vivo e para o merge.

