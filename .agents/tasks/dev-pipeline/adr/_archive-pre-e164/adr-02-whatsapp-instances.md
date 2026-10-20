# ADR-02 — Tabela `whatsapp_instances` (uma instância por tenant, RLS + RBAC)

- **Status:** proposto
- **Escopo:** dados
- **Depende de:** ADR-01 não é pré-requisito direto (esta tabela só depende de `tenants`), mas é ordenada **depois** de ADR-01 por timestamp para manter a sequência de migrations da fase coerente.

## Contexto

O módulo WhatsApp precisa materializar a entidade `whatsapp_instances` de `dominio.md`: uma conexão de número por tenant, com estado de conexão observável (`desconectado → aguardando_qr → conectado`). É tabela de domínio nova e sensível — exige RLS, `tenant_id` do JWT e RBAC (só admin pareia/escreve pelo cliente). O recorte da fase é **uma instância por tenant** (sem múltiplos números). QR e token/segredo **não** são persistidos: QR é efêmero (devolvido pela Edge Function, exibido, não guardado); credencial da Evolution vive só em env do servidor.

## Decisão

Criar `supabase/migrations/20250220090000_whatsapp_instances.sql` seguindo o padrão das migrations de domínio existentes (`customers`, `appointments`): `create table if not exists`, `tenant_id uuid not null default current_tenant_id() references tenants(id) on delete cascade`, índice por `tenant_id`, RLS com policies USING + WITH CHECK ancoradas em `current_tenant_id()`/`current_role_name()` (helpers security definer da Fase 2 — reutilizados, nunca recriados), `drop policy if exists` antes de cada `create policy` (idempotência).

Colunas:

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | `uuid` | PK `default gen_random_uuid()` |
| `tenant_id` | `uuid` | `not null default current_tenant_id()` → `tenants(id) on delete cascade` |
| `evolution_instance_name` | `text` | `not null check (char_length between 1 and 120)` — nome lógico derivado do tenant, **sem segredo** |
| `connection_status` | `text` | `not null default 'desconectado' check (in ('desconectado','aguardando_qr','conectado'))` |
| `last_connected_at` | `timestamptz` | nulo até o 1º pareamento |
| `created_at` | `timestamptz` | `not null default now()` |

Constraints/índices:
- `constraint whatsapp_instances_tenant_unique unique (tenant_id)` — barra a 2ª instância do mesmo tenant no banco (recorte "sem múltiplos números").
- `create index if not exists whatsapp_instances_tenant_id_idx on (tenant_id)` — mantém o padrão explícito das demais tabelas.
- **Nenhuma coluna de QR nem de token/segredo.**

RLS/RBAC:
- `enable row level security`.
- **SELECT:** `tenant_id = current_tenant_id() and current_role_name() in ('admin','receptionist','professional')` — qualquer papel operacional vê o estado da conexão (não é dado financeiro).
- **WRITE (for all):** só `admin` — `using (tenant_id = current_tenant_id() and current_role_name() = 'admin')` + WITH CHECK espelhado. Parear é ato de configuração do dono do tenant. Na prática a transição de estado roda pela Edge Function (service role, bypassa RLS); esta policy existe para ajustes do admin e para manter o padrão.
- **Sem policy `super_admin`** pelo cliente (cross-tenant é fase futura via service role/Edge Function auditada — não antecipar).

## Consequências

- Primeira das duas tabelas sensíveis do módulo; fundação da tela de conexão (ADR-07) e da operação `pair` da Edge Function (ADR-04).
- O unique por tenant trava o escopo no banco, não só na UI.
- QR/segredo fora do schema evita vazamento acidental de credencial em coluna.
- Decisão durável de modelagem multi-tenant — candidata a promoção futura para `docs/` (não copiar agora).

## Arquivos afetados

- `supabase/migrations/20250220090000_whatsapp_instances.sql` (novo)

## Critérios de aceite testáveis (desta ADR)

- **A1.** `supabase db reset` aplica a migration limpo e idempotente (CA-01).
- **A2.** `whatsapp_instances` tem `rowsecurity = true` (`pg_tables`), índice em `tenant_id`, e `tenant_id` com `default current_tenant_id()` (CA-02).
- **A3.** Inserir uma 2ª `whatsapp_instances` para o mesmo tenant viola `whatsapp_instances_tenant_unique` (CA-03).
- **A4.** Sob `authenticated` + JWT de dois tenants na mesma transação: usuário do tenant A lê 0 linhas de B (CA-05); INSERT/UPDATE com `tenant_id` de B por usuário de A é barrado por WITH CHECK (CA-06).
- **A5.** `receptionist`/`professional` não conseguem escrever; `admin` escreve dentro do tenant (CA-08). Validar com dois tenants + papéis distintos (padrão de teste RLS com signup trigger ativo registrado no brain).
