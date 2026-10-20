# ADR-04 — Hooks de dados: exceções e vigência/passo

**Status:** proposto

## Contexto

As telas de ADR-05/06/07/08 consomem dados de servidor **sempre** via TanStack Query (nunca `fetch`/
`supabase` solto em `useEffect`) — regra de convencoes-codigo e padrão já consolidado em
`useWorkingHours.ts`, `useAppointments.ts`, `useProfessionals.ts`. As leituras validam o shape com
zod; as escritas **nunca** enviam `tenant_id` (o RLS o deriva do JWT). Esta ADR isola a camada de
acesso a dados nova (ler/escrever `schedule_overrides` e as colunas de vigência/passo de
`professionals`), antes de qualquer UI, para que as telas recebam hooks prontos.

Padrões a espelhar:

- `useWorkingHours`/`useSaveWorkingHours`: query por `professional_id`, mutation sem `tenant_id`,
  invalidação por `queryKey` (`onSettled` quando a escrita não é atômica).
- Shape de linha validado por um `z.object` local no hook (como `workingHourRowSchema`).
- `useProfessionals.ts` para o padrão de leitura/escrita de `professionals` (reusar/estender para a
  vigência/passo, já que ADR-03 estende o tipo `Professional`).

A escrita da vigência/passo é **admin-only** no MVP (ADR-01 / PRD §9 ponto 3): o RLS recusa a escrita
de professional/receptionist; o hook não precisa replicar a regra, mas a UI (ADR-07) esconde o botão
(defesa em profundidade).

## Decisão

Criar os hooks (arquivos novos em `src/hooks/`), cada um um `useQuery`/`useMutation` com shape
validado por zod e sem `tenant_id` no corpo:

1. `src/hooks/useScheduleOverrides.ts`
   - `useScheduleOverrides(professionalId)`: lê `schedule_overrides` do profissional
     (`.eq("professional_id", ...)`, order por `override_date`), valida com um
     `scheduleOverrideRowSchema` local (espelha a linha de ADR-02), retorna `ScheduleOverride[]`.
   - `useUpsertScheduleOverride(professionalId)` e `useDeleteScheduleOverride(professionalId)`:
     mutations de criar/editar (insert/update) e remover, sem `tenant_id`, invalidando a chave
     `["schedule-overrides", professionalId]`. Erro de `unique` (`23505`) é traduzido para a mensagem
     pt-BR "Já existe uma exceção para esta data." (reusar/estender `mapSchedulingError` de
     `src/lib/scheduling-errors.ts` ou mapear no hook; manter o padrão de erro pt-BR).

2. `src/hooks/useScheduleValidity.ts` (ou estender `useProfessionals.ts`)
   - `useScheduleValidity(professionalId)`: expõe `schedule_start_date`/`schedule_end_date`/
     `slot_step_minutes` do profissional. Pode derivar do `useProfessionals` já existente (os campos
     passam a vir no select) em vez de nova query — **decisão:** estender o `select`/shape de
     `useProfessionals` para incluir as colunas novas e expor um seletor/hook fino, evitando request
     duplicado; se `useProfessionals` não trouxer os campos hoje, adicioná-los ao select.
   - `useUpdateScheduleValidity(professionalId)`: mutation que atualiza **apenas** as três colunas de
     schedule em `professionals` (não toca `name`/`active`/`profile_id`), sem `tenant_id`, invalidando
     as chaves de profissionais. O RLS garante admin-only.

Todos reusam `supabase` de `src/lib/supabase`. Chaves de query estáveis e documentadas no hook.

## Consequências

- **Positivas:** a UI (ADR-06/07/08) e o gerador (ADR-05) recebem dados por hooks testáveis e
  isolados por RLS; o padrão de `useWorkingHours` é mantido.
- **Custos/limitações:** estender `useProfessionals` exige revisar os consumidores atuais para não
  quebrar o shape (AC-20); mitigar mantendo os campos novos opcionais/aditivos.
- **Risco controlado:** nenhum `tenant_id` enviado; o isolamento é do banco.

### Escopo

Frontend (camada de dados-cliente; consome o schema de ADR-01/02 sob RLS). Sem SQL novo, sem UI.

### Arquivos / pastas afetados

- `src/hooks/useScheduleOverrides.ts` (novo).
- `src/hooks/useScheduleValidity.ts` (novo) **ou** `src/hooks/useProfessionals.ts` (editar) —
  preferir estender `useProfessionals` para evitar request duplicado e expor um seletor fino.
- `src/lib/scheduling-errors.ts` (editar, se o mapeamento do `23505`/"exceção duplicada" viver lá).

### Critérios de aceite testáveis (desta ADR)

- **Build/typecheck:** `npm run typecheck` e `npm run build` limpos.
- **QA ao vivo (preparação para ADR-07), via `supabase start` + `npm run dev`:** autenticado como
  `admin`, criar/editar/remover uma exceção reflete na lista (invalidação) e um insert duplicado para
  a mesma data mostra "Já existe uma exceção para esta data."; a vigência/passo salvam e recarregam.
- **Isolamento (herdado de ADR-02, reconfirmado pela camada):** nenhum `tenant_id` é enviado em
  nenhuma mutation (revisão do payload); a leitura só traz linhas do tenant do usuário.
- **Não-regressão:** os consumidores atuais de `useProfessionals` continuam compilando e funcionando
  (AC-20).

### Dependência

Depende de **ADR-01**, **ADR-02** (schema no banco) e **ADR-03** (tipos/shape). As migrations devem
estar aplicadas (`supabase start` com o db resetado) para o QA ao vivo.
