# ADR-005 — Vínculo profissional↔login via convite (professional_id pré-cadastrado)

- **Status**: planned
- **Data**: 2026-11-04
- **PRD**: gestao-usuarios-tenant (MVP — RF-03; RNF-07)
- **Decisões cobertas**: D3 (vínculo via convite pré-cadastrado)
- **depends-on**: ADR-001, ADR-002

## Decisão

Camino principal (RF-03, P1): **convite com `professional_id` pré-cadastrado**. Admin cadastra o profissional (operacional) → clica "Convidar para acesso" → `invite-member` com `role=professional` + `professional_id` → aceite cria profile e seta `professionals.profile_id`. Vinculação explícita, consentida, auditável. Alinhado com padrão de salões (staff com login opcional) e modelo de duas populações (Atlas vs empresa).

### Fluxo

```
Admin cadastra Profissional (operacional)
  → clica "Convidar para acesso" (ProfessionalFormDialog, quando profile_id is null)
  → dialog de convite pré-preenchido (role=professional, professional_id)
  → invite-member (valida professional do tenant, sem profile vinculado)
  → e-mail enviado
  → profissional aceita (accept-invitation cria profile + vincula professional.profile_id)
  → redirect para /app/agenda (só própria)
```

### Regras de ownership

- Um professional tem 0 ou 1 `profile_id`; um profile professional tem 0 ou 1 professional do mesmo tenant (unique index `professionals_tenant_profile_unique`, já existente).
- FK composta (ADR-001) garante mesmo tenant.
- Admin pode desvincular (`unlink-professional-profile`, ADR-002) sem apagar o registro operacional/histórico (RF-09).
- Profissionais existentes com `profile_id=null` permanecem (vinculação futura — RNF-09).

### Validações (servidor)

- `invite-member`: se `professional_id` presente, validar professional do tenant do ator e `profile_id is null`. Se `role !== 'professional'` e `professional_id` presente ⇒ `invalid_body`.
- `accept-invitation`: ao criar profile com role professional, se `invitation.professional_id` presente, setar `professionals.profile_id = userId` em transação, validar tenant. Idempotente.
- Guarda: não vincular professional a profile de outro tenant (FK composta + validação service role).

### UI

- `ProfessionalFormDialog`: botão "Convidar para acesso" (admin) quando `profile_id` is null.
- UI do profissional: exibir "Acesso vinculado a: {email}" quando `profile_id` presente; botão "Revogar acesso" (desvincula, não deleta professional).
- `ProfissionaisPage` (admin): coluna/indicador de "Acesso" (vinculado/não).

## Interface congelada

### Contratos

- `invite-member` body (zod): `{ email: string, role: Role, professional_id?: uuid }` (ADR-002).
- `accept-invitation`: sem mudança de input; efeito de vínculo quando `invitation.professional_id` presente.
- RPC `link_professional_on_accept(p_professional uuid, p_user uuid, p_tenant uuid)` (opcional, se transação via RPC).

### Auditoria

- `professional.linked` (metadata: `{ professional_id, profile_id, tenant_id }`) no aceite.
- `professional.unlinked` (metadata: `{ professional_id, profile_id }`) na desvinculação.

### Índices/constraints (ADR-001)

- `professionals_tenant_profile_unique` (já existente, parcial where profile_id is not null).
- `professionals_profile_tenant_fk` (FK composta, ADR-001).

## Alternativas consideradas

- **Auto-cadastro de professional no aceite (B)**: adiado para RF-10 (P3) — onboarding rápido opcional; risco de duplicata e dados operacionais incompletos.
- **Cadastro direto com senha temporária (C)**: descartado (anti-padrão de segurança — senha em claro, sem consentimento, sem trilha de aceite; viola LGPD/RNF-06).

## Consequências

- Admin precisa pré-cadastrar o profissional antes de convidar (mais passos, mas governança).
- Convites sem `professional_id` (admin/receptionist) seguem funcionando (compatibilidade).
- Vínculo é auditável e revogável.
- FK composta mitiga drift cross-tenant.

## Fora desta decisão

- Auto-cadastro (RF-10, P3) → futuro.
- UI completa de gestão (tabs, ações) → ADR-004.
- Auditoria UI (RF-11) → ADR-006 (fase 2).