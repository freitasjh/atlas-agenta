# PRD — Evolução do módulo de Agenda: slots sob demanda, exceções/vigência e visão de calendário

- **Projeto:** atlas-agenda (`/home/joao/fusionlf/wsProjeto/atlas-agenda`)
- **Pipeline:** dev-pipeline · **Artefato:** contrato da demanda (O QUE existe + COMO se prova). Solução técnica detalhada vem nas ADRs, após a aprovação humana deste PRD.
- **Tipo de rota:** Feature (pesada) · **Área:** `/app` (tenant). Nenhuma rota de `/admin`, marketing ou auth é tocada.
- **Entrada:** `analysis-data.md` (dados/segurança) + `analysis-frontend.md` (frontend) + steerings (`produto`, `dominio`, `stack`, `seguranca-multitenant`, `convencoes-codigo`).

As duas análises convergem nas mesmas decisões de design; este PRD consolida sem reabrir o que ambas já fixaram, e registra em §7 e §9 os pontos que o gate humano deve confirmar.

---

## 1. Problema e valor de negócio

Hoje a `AgendaPage` (`src/app/agenda/AgendaPage.tsx`) é uma **lista vertical por profissional/dia** que **não gera slots** (comentário explícito no arquivo): o operador digita data+hora livre no `AppointmentFormDialog`. A grade semanal recorrente (`working_hours`) já existe e é configurável em `/app/config/profissionais/:id/horarios`, mas **não alimenta** a oferta de horários. Não há como registrar folga/feriado/horário atípico, nem o período em que o profissional atende.

**O que muda quando pronto:**

- A recepção e o profissional passam a **marcar a partir de horários livres gerados** (grade − exceções − vigência − ocupados), reduzindo erros de marcação (fora do expediente, em folga, sobre outro atendimento) e acelerando o fluxo — alinhado ao objetivo de produto de **reduzir no-show** e dar previsibilidade à agenda.
- Clínicas passam a representar a realidade da operação: **folgas/feriados/horários atípicos por data** e o **período de vigência** em que cada profissional atende.
- A agenda ganha uma **visão de calendário (dia/semana)** que o usuário alterna com a lista atual, mantendo a lista como opção (ótima no mobile).

**Valor direto:** menos marcações inválidas, menos retrabalho/remarcação, leitura da agenda mais rápida. Nenhuma estrutura de planos/limites é alterada (o limite de 150 agendamentos/mês do plano Individual não é reaberto aqui).

---

## 2. Escopo

### 2.1 Dados / Supabase (migrations versionadas em `supabase/migrations`)

- **Exceções por data** — nova tabela de domínio `schedule_overrides` (multi-tenant): sobrescreve a grade de um profissional num dia específico. Dois casos: **bloqueio total** (folga/feriado, nenhum slot) ou **janela atípica** (horário diferente do recorrente, com intervalo opcional). Unicidade por `(tenant_id, professional_id, override_date)`. Com `tenant_id`, índice, CHECKs de coerência de janela/break, RLS habilitado e RBAC espelhando `working_hours`.
- **Vigência da grade + passo-base** — colunas novas em `professionals`: `schedule_start_date`, `schedule_end_date` (ambas opcionais; null = sem limite) e `slot_step_minutes` (int, default 30, CHECK 5..240), com CHECK de coerência (início ≤ fim quando ambos presentes).
- **Sem materialização de slots** (restrição dura): nenhuma tabela/coluna de "slots" é criada. A disponibilidade é derivada sob demanda.

### 2.2 Frontend (`/app`, React + Vite + TS + Tailwind + shadcn/ui)

- **AgendaPage** (`src/app/agenda/`): toggle **Lista · Dia · Semana** controlado pelo usuário (preferência por usuário em `localStorage`, não config de tenant); visões de calendário dia/semana com blocos proporcionais à duração e cor por status; criação a partir de clique em faixa/slot vazio.
- **Fluxo de criação** (`AppointmentFormDialog`, reusado e estendido): troca do `<input type="time">` cru por um **seletor de slots livres** (chips) gerados sob demanda a partir de profissional + serviço + dia; término e valor continuam derivados do serviço como hoje.
- **Tela de horários** (`/app/config/profissionais/:id/horarios`, reusa `WeekScheduleForm`/`HorariosPage`): duas seções novas abaixo da grade semanal — **vigência** (início/fim) e **exceções por data** (criar/editar/remover folga ou horário atípico).
- **Geração de slots**: função determinística (grade semanal + exceções + vigência + agendamentos ocupados + duração do serviço, no fuso do tenant), consumida via TanStack Query. Recomendação: **função pura no cliente** sobre dados já lidos por RLS (ver §9, ponto D3); contrato estável se virar RPC.

### 2.3 Fora de escopo

- Link público de **autoagendamento**, **taxa de reserva** antecipada e **painel de métricas** consolidadas — são **Fase 3** (produto.md). Não implementar.
- **Feriado do tenant inteiro** (uma exceção que vale para todos os profissionais / tabela `tenant_holidays`): fora do MVP; exceção é por profissional/data.
- **Webhooks, PIX, WhatsApp** e demais módulos: não tocados. Esta demanda não envolve service role, Edge Functions nem integrações externas.
- **Reescrita** da grade semanal, do fluxo de criação de agendamento, da máquina de estados ou da constraint de não-sobreposição: tudo é reuso/extensão, sem mudança de contrato observável.

---

## 3. Requisitos e critérios de aceite testáveis

Cada requisito tem entrada → saída observável. Numeração alinhada às análises (RF-AG / AC).

### 3.1 Exceções, vigência e passo-base (dados)

- **RF-AG-01 — Vigência da grade.** Entrada: profissional com `schedule_start_date`/`schedule_end_date`. Saída: fora de `[início, fim]` **nenhum** slot é ofertado, mesmo com grade semanal no dia; dentro, há slots quando grade/exceção permitem. *(AC-12)*
- **RF-AG-02 — Exceções por data.** Entrada: exceção para `(profissional, data)`. Saída: `is_closed=true` → nenhum slot nesse dia; `is_closed=false` → slots seguem a **janela da exceção**, não a da grade. *(AC-10, AC-11)*
- **Coerência e unicidade (banco).**
  - AC-06: exceção `is_closed=true` com janela preenchida é rejeitada pelo CHECK; `is_closed=false` sem janela ou com break fora da janela é rejeitada.
  - AC-07: dois inserts para o mesmo `(professional_id, override_date)` falham no `unique`.
  - AC-08: `schedule_start_date > schedule_end_date` é rejeitado; `slot_step_minutes` fora de 5..240 é rejeitado.

### 3.2 Geração de slots (app)

- **RF-AG-03 — Slots sob demanda.** Entrada: `(profissional, serviço, dia)`. Saída: lista de horários de início livres = janela do dia (exceção se houver, senão grade do `weekday`) − break − vigência − ocupados − passado (no fuso do tenant). *(AC-09, AC-13, AC-17)*
  - AC-09: slots dentro da janela da grade e fora do break.
  - AC-13: início cujo bloco `[início, início+duração)` sobrepõe agendamento **ativo** não é ofertado; `cancelado`/`nao_compareceu` não bloqueiam.
  - AC-17: horários anteriores a "agora" (fuso do tenant) não são ofertados no dia corrente.
- **RF-AG-04 — Encaixe pela duração.** Entrada: serviço de 1h vs 2h. Saída: o bloco ofertado tem `services.duration_minutes`; um início só é ofertado se o bloco inteiro **cabe** (não cruza fim de janela/break/próximo ocupado). Serviço de 2h oferta menos opções que o de 1h a partir da mesma grade. *(AC-14)*
- **Passo-base.** AC-15: os inícios andam de `slot_step_minutes` em `slot_step_minutes` a partir do começo da janela (default 30).
- **RF-AG-07 — Fuso do tenant.** AC-16: slots e exibição usam `tenants.timezone` (default `America/Sao_Paulo`); um agendamento às 09:00 local aparece às 09:00 e o slot correspondente some, independente do fuso do servidor. Instantes persistidos continuam `timestamptz` UTC.
- **Sem materialização.** AC-21: nenhuma tabela/coluna de slots é criada; disponibilidade derivada sob demanda.

**Cascata de precedência (a documentar no design para o gerador não divergir):** vigência (fora → sem slots) → exceção (fechado → sem slots; janela → usa janela da exceção) → grade semanal do `weekday` (sem exceção e dentro da vigência). Casos de borda: DST (fatiar no fuso do tenant, persistir UTC, reusar `src/lib/datetime.ts`); duração > janela → vazio honesto; múltiplas faixas por `weekday` (`working_hours` é permissivo) → união das janelas; profissional sem grade → sem slots.

### 3.3 Criar agendamento a partir de slot (app)

- **RF-AG-05 — Criar a partir de slot.** Entrada: seleção de um slot (chip ou faixa vazia do calendário). Saída: pré-preenche profissional/serviço/início no `AppointmentFormDialog`; submit continua sujeito à checagem local (`hasLocalConflict`) **e** à constraint `appointments_no_overlap` do banco. Em edição, o slot ocupado pelo próprio agendamento permanece ofertável (exclui o próprio ocupante do desconto). *(AC-18)*
  - AC-18: em corrida, a constraint (23P01) barra a sobreposição com a **mesma** mensagem pt-BR já existente (`mapSchedulingError`).

### 3.4 Visão de calendário alternável (app)

- **RF-AG-06 — Toggle por usuário.** Entrada: usuário escolhe Lista/Dia/Semana. Saída: a `AgendaPage` troca a renderização na própria tela sem recarregar; a preferência persiste **por usuário** (`localStorage`), nunca vira config de tenant; a lista atual permanece disponível (default no mobile). *(AC-19)*

### 3.5 Não-regressão

- **RF-AG-08 — Reuso, sem regressão.** `WeekScheduleForm`/`HorariosPage` e o fluxo atual de criar/editar agendamento continuam funcionando sem mudança de contrato observável; máquina de estados e não-sobreposição intactas. *(AC-20)* **build/typecheck limpos.**

---

## 4. Regras de fronteira que a demanda arrisca

| Fronteira | Regra | Como a demanda respeita |
| --- | --- | --- |
| **Isolamento multi-tenant (RLS)** | `tenant_id` sempre do JWT (`current_tenant_id()`), nunca do cliente; RLS habilitado em toda tabela de domínio. | `schedule_overrides` nasce com `tenant_id not null default current_tenant_id()`, índice, RLS habilitado, policies USING + WITH CHECK ancoradas em `current_tenant_id()`. A geração de slots lê `working_hours`/`appointments`/`schedule_overrides`/`services` **pelo cliente sob RLS** — o filtro é do banco, não de parâmetro. **Nunca** enviar `tenant_id` do cliente. *(AC-01, AC-02)* |
| **RBAC** | `admin` tudo no tenant; `professional` só a própria agenda; `receptionist` agenda de todos, sem financeiro. | `schedule_overrides`: SELECT para qualquer papel do tenant (recepção precisa ver disponibilidade); WRITE admin para qualquer profissional; WRITE professional só do profissional com `profile_id = auth.uid()` (espelha `working_hours_write_own_professional`); receptionist **sem** policy de escrita (só leitura). Vigência/passo em `professionals`: **admin-only no MVP** (recomendação — ver §9). Nenhum acesso a `charges` é aberto. *(AC-03, AC-04, AC-05)* |
| **Status de assinatura** | `bloqueado` → tela de quitação; `cancelado` → suspenso. | Herdado do guard de `/app`/`AppLayout`; a UI nova vive dentro do `/app` já protegido. Nenhuma mudança nesse guard. |
| **Idempotência/autenticidade de webhook** | — | **Não se aplica**: esta demanda não envolve webhook, pagamento nem disparo. |
| **Segredos fora do cliente** | Só `anon key` no bundle; service role só em Edge. | Nenhum segredo em SQL ou no cliente. Se a geração virar RPC, roda **sob a sessão do usuário** (RLS), nunca service role. |
| **LGPD / PII** | `whatsapp_opt_in` antes de disparo; PII mínima em log. | Sem disparo e sem novo campo de PII; `schedule_overrides.reason` é rótulo opcional (ex.: "Feriado"), não PII. |
| **Não-sobreposição** | Constraint de exclusão `tstzrange` por profissional é a fonte da verdade. | **Não é alterada.** Slots apenas refletem ocupados; criar a partir de slot ainda passa pela constraint (defesa contra corrida). *(RNF-SEG-04)* |
| **Tempo** | `timestamptz` UTC no banco; exibição no fuso do tenant; grade/exceção em `HH:MM`. | Datas de vigência/exceção em `date` (dia de calendário no fuso do tenant); conversão para instantes UTC só na geração de slots, reusando `src/lib/datetime.ts`. *(RNF-SEG-05)* |
| **Dados não confiáveis** | Validar entrada com zod espelhando CHECKs do banco. | Formulários de vigência/exceção e a query de slots validados por zod (pt-BR); a trava final é CHECK/RLS no Postgres. |

---

## 5. Perfis de acesso (quem executa cada ação)

| Ação | super_admin | admin | professional | receptionist |
| --- | --- | --- | --- | --- |
| Ver agenda/calendário (lista/dia/semana) | — (sem caminho cross-tenant pelo cliente) | todos os profissionais | **só a própria** | todos os profissionais |
| Ver disponibilidade/slots para marcar | — | sim | só a própria | sim |
| Criar agendamento a partir de slot | — | para qualquer profissional | só o próprio | para qualquer profissional |
| Ler grade/exceções/vigência | — | sim | sim | sim (leitura, vê disponibilidade) |
| Escrever vigência + passo-base (`professionals`) | — | **sim (MVP: admin-only)** | leitura (ver §9) | leitura |
| Escrever exceções (`schedule_overrides`) | — | qualquer profissional do tenant | **só as próprias** | **leitura** (sem policy de escrita) |
| Dados financeiros (`charges`) na agenda | — | — | — | — (não há `charges` nesta tela; inalterado) |

A UI esconde/desabilita o que o papel não pode (defesa em profundidade); **o RLS é a trava real**.

---

## 6. Enquadramento no roadmap e dependências

- **Fase 1 / MVP (produto.md):** o core é agenda + régua de cobrança. Esta entrega amadurece o módulo de agenda (geração de slots, exceções, vigência, visão de calendário) — reforço direto do core, sem antecipar Fase 3.
- **Respeita o fora-de-escopo do MVP:** autoagendamento público, taxa de reserva antecipada e métricas consolidadas permanecem **Fase 3**; não entram aqui.
- **Dependências anteriores já existentes (reuso, não recriar):**
  - `working_hours` — grade semanal por profissional (weekday 0-6, start/end `HH:MM`, break ambos-ou-nenhum). Tipos em `src/types/domain.ts`; validação em `src/lib/validations/catalog.ts`; hook `src/hooks/useWorkingHours.ts`; telas `HorariosPage` + `WeekScheduleForm`/`DayRow`.
  - `services.duration_minutes` e `price_cents`; `appointments` deriva `ends_at`/`price_cents` do serviço no submit (ADR-02/08).
  - `AgendaPage` + `AppointmentFormDialog`; `src/lib/datetime.ts` (conversão de fuso via `Intl`, trata DST); constraint `appointments_no_overlap` (`tstzrange` + `btree_gist`, partial `where status not in ('cancelado','nao_compareceu')`).
  - Guards: `RequireAuth`, guard de status de assinatura do `AppLayout`, RBAC via `usePermissions`.
- **Última migration aplicada:** `20250220091000_messages.sql` — migrations novas usam timestamps posteriores.

---

## 7. Pontos levantados pelo usuário (nenhum descartado)

Mensagens 10–12 do usuário, cada uma como decisão tomada ou pergunta em aberto:

1. **"a agenda de cada profissional deve ser feita em todos os meses, cadastrando os dias trabalhados na semana e os horários, e o intervalo de dias que vai ser trabalhado."**
   → **Decisão tomada:** dias da semana + horários = grade recorrente `working_hours` (reuso); "intervalo de dias que vai ser trabalhado" = **vigência** (`schedule_start_date`/`schedule_end_date`). Coberto por RF-AG-01, RF-AG-08.
2. **"Busque sistemas de agendamento do mercado e avalia a sugestão que dei"** → **Decisão tomada:** modelo híbrido (passo-base + bloco = duração do serviço), padrão de agendas de clínica, documentado em §3.2 e justificado nas análises (§5 dados / §1 frontend).
3. **(msg 11.1) "os dois"** [exceções por data E vigência] → **Decisão tomada:** ambos entram — exceções (`schedule_overrides`) **e** vigência. §2.1, RF-AG-01/02.
4. **(msg 11.2) "sim"** [gerar/mostrar slots livres] → **Decisão tomada:** geração de slots sob demanda. RF-AG-03/04.
5. **(msg 11.3) "trocar por uma visão de calendario, mas ter uma mais simples como a atual, e deve ser configurável"** → **Decisão tomada:** toggle calendário (dia/semana) ↔ lista atual, configurável. RF-AG-06.
6. **(msg 12.1) "o usuário pode alterar a própria tela"** → **Decisão tomada:** a alternância é **preferência por usuário** (`localStorage`), não config de tenant. RF-AG-06, AC-19.
7. **(msg 12.2) "Cada profissional vai ter o seu tempo de consulta... serviço que pode demorar uma hora ou duas, aí vai pegar os horários dos slots do profissional."** → **Decisão tomada:** a duração do **bloco** vem sempre do serviço (1h/2h consomem os slots); o "tempo de consulta do profissional" é modelado como o **passo-base** (`slot_step_minutes`, default 30, por profissional). Não se cria uma "duração padrão do profissional" concorrente à duração do serviço. RF-AG-04, AC-14/15. **Confirmar no gate** (§9, ponto 1).

---

## 8. Critério de aceite visual (verificável via Chrome DevTools)

QA ao vivo em `/app/agenda` e `/app/config/profissionais/:id/horarios` (tenant autenticado; `supabase start`; `npm run dev`):

1. **Toggle por usuário:** alternar Lista → Dia → Semana muda a renderização sem recarregar; recarregar a página mantém a última visão (localStorage), sem flash para a lista.
2. **Calendário desenha a grade:** visão Dia com calha de horas (tabular-nums), faixa de expediente distinta da faixa sem expediente, **linha do agora** em jade quando o dia é hoje; agendamentos como blocos com altura proporcional à duração e borda-lateral da cor do status (mesma do `StatusBadge`).
3. **Slots refletem grade + exceções + vigência + ocupados:** profissional + serviço de **1h** + dia na vigência → chips de 30 em 30 que caibam 1h e não sobreponham ocupados; trocar para **2h** reduz as opções; dia em **folga** → "O profissional não atende nesta data." e nenhum chip; dia **fora da vigência** → "Fora do período de atendimento do profissional." e nenhum chip.
4. **Fuso do tenant:** horários de chips/blocos no fuso do tenant (`America/Sao_Paulo` por padrão); agendamento às 09:00 local aparece às 09:00, não deslocado por UTC.
5. **Criar a partir de slot mantém não-sobreposição:** selecionar chip → agendamento criado e visível; tentar sobrepor o mesmo profissional/horário → bloqueado com a mesma mensagem pt-BR de conflito; clicar em faixa vazia abre o diálogo com profissional+início preenchidos.
6. **Vigência e exceções (tela de horários):** grade semanal continua salvando igual; seção de vigência salva início/fim; seção de exceções adiciona/edita/remove data (folga ou horário atípico) com badge de tipo; em papel sem permissão (recepção; professional na grade de outro) as seções aparecem em **leitura**.
7. **Responsivo/mobile (360px):** default Lista; visão Dia usável; visão Semana degrada para dia navegável por setas; sem overflow horizontal quebrado.
8. **Acessibilidade observável:** foco visível ao tabular pelos chips e controles de visão; grupo de slots anunciado como `radiogroup`; nenhuma informação de status/folga só por cor. (Conformidade WCAG plena exige teste manual com tecnologia assistiva + revisão especializada — recomendado ao QA por ADR.)
9. **RBAC/guard:** `professional` vê só a própria agenda e edita só a própria vigência/exceções; `receptionist` vê a agenda de todos mas vigência/exceção em leitura; nenhum dado financeiro na agenda.
10. **Build/typecheck limpos** e carregamento da agenda na visão default dentro do alvo (< 1,5s, RNF01).

---

## 9. Decisões de design a confirmar no gate humano

As análises **recomendam** (não chutam); o planejamento registra a escolha final nas ADRs. A recomendação é a leitura mais fiel ao pedido do usuário:

1. **Modelo de slots:** passo-base por profissional (`slot_step_minutes`, default **30**) + bloco = **duração do serviço**. *(recomendado; §3.2, §7 ponto 7)*
2. **Onde moram vigência + passo-base:** colunas em **`professionals`** (`schedule_start_date`, `schedule_end_date`, `slot_step_minutes`), não em `working_hours` nem tabela de settings dedicada. *(recomendado — atributos do profissional, evita inconsistência entre dias)*
3. **RBAC de escrita de vigência/passo-base:** **admin-only no MVP** (não ampliar a superfície de escrita em `professionals`, que carrega `profile_id`/`active`), com backlog para own-update granular do `professional`. *(recomendado)*
4. **"Feriado do tenant inteiro":** **fora do MVP** — exceção é por profissional/data (`schedule_overrides`). *(recomendado)*
5. **Onde roda a geração de slots:** **função pura no cliente** (`src/lib/scheduling-slots.ts`) sobre dados já lidos por RLS, reusando `src/lib/datetime.ts`; migrar para RPC `stable security invoker` só se a performance exigir. Contrato do front (`useAvailableSlots` → lista de inícios/`{startUtc,endUtc}`) é estável nos dois casos. *(recomendado)*

Se o gate aprovar com ressalvas em qualquer ponto, o planejamento ajusta antes de abrir as ADRs. **Nenhum ponto do usuário foi descartado** (ver §7).

---

## 10. Observações de verificação (para o planejamento/QA)

- **Unit (app):** o gerador de slots é função pura — cobrir a cascata de precedência (vigência → exceção → grade), DST, duração > janela, break, passado, múltiplas faixas por weekday.
- **Integração (banco):** RLS cross-tenant (AC-01/02), RBAC (AC-03..05), CHECKs e `unique` (AC-06..08) via `supabase start` com sessões de papéis distintos.
- **E2E / QA ao vivo (`/app/agenda`, chrome-devtools):** AC-09..19 conforme §8.
- **Entrega local-only:** branch nova + commit, **sem push/PR** (ambiente sem remote). `supabase start`; `supabase functions serve whatsapp --env-file supabase/functions/.env` se necessário; `npm run dev` (porta pode variar a partir de 5173).
- **Migrations propostas (nomes de referência):** `<ts>_professionals_schedule_vigencia.sql` (ALTER `professionals`) e `<ts>_schedule_overrides.sql` (nova tabela + índices + CHECKs + RLS/RBAC). Opcional, só se o design optar por RPC: `<ts>_available_slots_fn.sql` (recomendação: **não** criar no MVP).
