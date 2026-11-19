# ADR-06 — Split-timing (processamento) backend

- Status: proposto

## Contexto

G15 exige `processamento_minutos` separado de `duracao_minutos`; bloco exibe faixa sólida (atendimento) + listrada (processamento); processamento não bloqueia outros agendamentos mas bloqueia recurso vinculado (ADR-07). Base: `appointments` (duration via service; `ends_at` = starts_at + duration). Precisa persistir processamento e manter anti-sobreposição do profissional baseada no atendimento (duration), não no processamento.

## Decisão

Migration aditiva:

- `appointments`: add `processing_minutes int not null default 0 check >=0`. `ends_at` continua = starts_at + service.duration (atendimento). Processamento ocorre após `ends_at` (ou durante, sem bloquear agenda do profissional).
- `services`: add `processing_minutes int not null default 0 check >=0` (default por serviço); appointment herda no INSERT (trigger `appointments_set_processing` = new.processing_minutes coalesce service.processing_minutes, 0). Cliente não fornece (server-side).
- Anti-sobreposição profissional: constraint de exclusão existente usa `[starts_at, ends_at)` (atendimento) — inalterada. Processamento não entra no intervalo do profissional.
- Anti-sobreposição de recurso (ADR-07): recurso considera intervalo completo `[starts_at, starts_at + duration + processing)` para conflito (processamento bloqueia recurso vinculado).
- Split-timing não cria novo status; machine de estados inalterada.

## Consequências

- Positivas: mudança mínima; agenda do profissional não bloqueada por processamento; recurso bloqueado (ADR-07).
- Negativas/risco: se serviço duracao mudar, processamento herdado no ato; snapshot preservado.
- A11y: aria-label inclui as duas durações (frontend ADR-11).

## Escopo

Entra: migration colunas + trigger herança + testes. Não entra: UI, recursos, anti-sobreposição recurso (ADR-07).

## Arquivos afetados

- `supabase/migrations/{ts}_split_timing.sql`
- Testes integração: herança do service, default 0, constraint profissional usa duration, processamento não bloqueia slot do profissional.

## Critérios de aceite (testáveis)

1. `db reset` 2x sem erro.
2. Appointment herda `processing_minutes` do service quando não informado.
3. `processing_minutes` pode ser 0 (default) e >=0.
4. Dois appointments do mesmo profissional com atendimento não sobreposto mas processamento sobreposto são permitidos.
5. Machine de estados inalterada (transições iguais).

## Dependência

Nenhuma backend (reusa appointments/services). ADR-01 para gating de UI (ADR-11).