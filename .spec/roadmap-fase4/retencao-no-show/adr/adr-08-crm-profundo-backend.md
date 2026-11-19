# ADR-08 — CRM profundo (E): backend (preferências, notas, filtros, opt-in/consentimento)

- Status: proposto

## Contexto

Capacidade E exige ficha 360° do cliente com abas, preferências, notas por papel, filtros e consentimento LGPD/opt-in (RF-24..RF-30). Base já tem `customers`, `appointments`, `messages`. Backend mínimo: preferências/notas (podem ser colunas/tabelas) e RPCs de resumo/filtros.

## Decisão

1. Estender `customers` com preferências operacionais:
   - `preferred_professional_id` (FK composta tenant), `preferred_time_window text`, `notes_summary text`, `segment text`, `tags text[]`, `whatsapp_opt_in boolean default false`, `whatsapp_opt_in_at timestamptz`, `lgpd_consent_at timestamptz`, `lgpd_consent_version text`.
   - Índices por tenant/tags/segment.
2. Tabela `customer_notes` (1:N):
   - `id`, `tenant_id`, `customer_id`, `author_profile_id`, `author_role`, `visibility text check (operational|admin|appointment)`, `appointment_id nullable`, `body text`, `created_at`.
   - RLS: admin lê/cria todas; receptionist lê/cria `operational`; professional lê apenas notas vinculadas ao próprio atendimento (visibility `appointment` e appointment.professional_id = seu).
3. RPCs:
   - `customer_summary(customer_id)` retorna no-show count, última visita, ticket médio (admin only; recepção recebe null/omitido), tags, segmento, opt-in e consentimento.
   - `customer_history(customer_id, page)` lista appointments paginados; valores financeiros apenas admin.
   - `customer_filter(tag, segment, no_show_min, ...)`.
   - `customer_consent_update(...)` registra `whatsapp_opt_in`, opt-in timestamp, consentimento LGPD com data/versão; bloqueia disparo sem opt-in.
4. RBAC:
   - Admin vê financeiro agregado; receptionist/professional não.
   - Notas: receptionist operacionais; admin todas; professional apenas próprias.
5. LGPD: minimizar PII em logs; consentimento obrigatório antes de disparo.

## Consequências

- Positivas: visão 360°; filtros; consentimento auditável.
- Negativas/risco: ticket médio exposto apenas admin (pergunta 8); notas podem virar PII (minimizar).
- Defaults PRD §7: RLS, UTC.

## Escopo

Entra: migration, RPCs, RLS, testes. Não entra: UI, campanhas, relatórios.

## Arquivos afetados

- `supabase/migrations/<timestamp>_crm_customer_extensions.sql`
- `supabase/migrations/<timestamp>_customer_notes.sql`
- `supabase/migrations/<timestamp>_crm_rpcs.sql`
- Testes de integração RLS/RBAC

## Critérios de aceite (testáveis)

1. Preferências persistem e são lidas por papel autorizado.
2. Notas respeitam visibilidade por papel.
3. Filtros retornam subconjunto correto.
4. Consentimento registra data/hora/versão; disparo bloqueado sem opt-in.
5. Ticket médio é null/omitido para receptionist/professional.
6. RLS impede cross-tenant.

## Dependência

- ADR-01 (gating não direto; CRM não tem chave própria, mas reusa entitlements? PRD não define chave CRM; pode ser base para campanhas)
- ADR-05 (campanhas consomem segmentação/opt-in)
