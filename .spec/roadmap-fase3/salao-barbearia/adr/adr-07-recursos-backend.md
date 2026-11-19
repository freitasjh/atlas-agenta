# ADR-07 — Recursos agendáveis (sala/equipamento/cadeira) backend

- Status: proposto

## Contexto

G15 exige CRUD de recursos (nome, tipo Sala/Equipamento/Cadeira, capacidade, ativo, cor), vinculação a serviço e agendamento, conflito de recurso no SlotPicker, view "Por recurso". Processamento bloqueia recurso vinculado (ADR-06). Base: `services`, `appointments`, `service_professionals`. Precisa multi-tenant, RLS, RBAC admin (escrita) / leitura tenant, capacidade >1 opcional (decisão #3), conflito por intervalo completo (duration+processing).

## Decisão

Migration aditiva:

- Tabela `resources`: `id, tenant_id, name, type text check in ('sala','equipamento','cadeira'), capacity int not null default 1 check >=1, color text, active bool default true, created_at`. `unique (tenant_id, id)`. Índice tenant. RLS: SELECT aberto ao tenant; escrita só admin.
- N:N `service_resources`: `tenant_id, service_id, resource_id, qty int not null default 1 check >=1`. FKs compostas por tenant. Unique `(tenant_id, service_id, resource_id)`. RLS: SELECT aberto; escrita admin.
- Agendamento de recurso: tabela `appointment_resources`: `tenant_id, appointment_id, resource_id, qty int not null default 1`. FKs compostas. Unique `(tenant_id, appointment_id, resource_id)`. RLS: SELECT por tenant com RBAC (admin/receptionist/professional próprio); INSERT/UPDATE via trigger ou RPC (não cliente direto) para garantir conflito.
- Vinculação automática: ao criar appointment de serviço, herdar `service_resources` → `appointment_resources` (trigger ou RPC). Admin pode ajustar manualmente no agendamento.
- Conflito: RPC `check_resource_conflict(p_resource_id, p_starts_at, p_ends_at, p_processing_minutes, p_exclude_appointment_id)` retorna boolean. Intervalo recurso = `[starts_at, starts_at + service.duration + processing)`. Conflito se soma de `qty` dos appointments sobrepostos (excluindo o atual) + novo qty > capacity. Usado pelo SlotPicker e pelo INSERT/UPDATE de appointment.
- Trigger `appointments_resource_conflict_guard` (BEFORE INSERT/UPDATE of starts_at,status): se recurso vinculado e conflito → raise `RESOURCE_CONFLICT`.
- View "Por recurso": RPC `list_appointments_by_resource(p_resource_id, p_day)` retorna appointments do recurso no dia.
- Cor nunca único sinal (a11y): tipo + nome sempre exibidos.

## Consequências

- Positivas: capacidade >1 suportada; conflito no banco (não só UI); processamento bloqueia recurso; RLS/RBAC.
- Negativas/risco: trigger de herança e conflito aumenta complexidade → testes db reset 2x + cenários de capacidade.
- LGPD: sem PII em log.

## Escopo

Entra: migration resources + service_resources + appointment_resources + RPCs + triggers + RLS/RBAC + testes. Não entra: UI (ADR-11), split-timing (ADR-06 já define processamento).

## Arquivos afetados

- `supabase/migrations/{ts}_resources.sql`
- Testes integração: CRUD, RLS cross-tenant, RBAC, herança, conflito capacidade 1, conflito com processamento, view por recurso.

## Critérios de aceite (testáveis)

1. `db reset` 2x sem erro.
2. Recurso com capacidade 1: dois appointments sobrepostos no mesmo recurso → segundo bloqueado com erro tipado.
3. Capacidade 2: dois appointments simultâneos permitidos; terceiro bloqueado.
4. Processamento sobreposto bloqueia recurso (intervalo completo).
5. Herança: appointment de serviço herda service_resources.
6. Tenant B não lê recurso do tenant A.
7. Receptionist lê recursos; não escreve (policy nega).

## Dependência

ADR-06 (processing_minutes). ADR-02 (services). ADR-01 (gating UI).