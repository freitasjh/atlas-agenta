# Architecture & Software Specification — ADR-005 (Vinculo Profissional <-> Login)

**Feature slug:** `gestao-usuarios-tenant-adr-005`
**ADR de origem:** `.spec/prd/gestao-usuarios-tenant/ADRs/ADR-005-vinculo-profissional-login/ADR.md`
**Depende de:** ADR-001 (schema: professionals.profile_id), ADR-002 (Edge Functions: invite-member professional_id, accept-invitation vinculo, unlink-professional-profile).
**Escopo:** Frontend (ProfissionaisPage + ProfessionalFormDialog) + UX. Backend ja implementado em ADR-002.

## 1. Decisão (RESEARCH D3)

Vínculo profissional↔login: convite com `professional_id` pré-cadastrado. Admin cadastra profissional (operacional) → clica "Convidar para acesso" → invite-member (role=professional, professional_id) → e-mail → profissional aceita (accept-invitation cria profile + vincula professional.profile_id) → redirect para /app/agenda (só própria).

## 2. Componentes

- `ProfissionaisPage`: botão "Convidar para acesso" (admin) em cada profissional sem login vinculado.
- `ProfessionalFormDialog`: exibir "Acesso vinculado a: email" quando profile_id presente; botão "Revogar acesso" (admin) que chama unlink-professional-profile.
- `ConviteProfissionalDialog`: dialog de convite pré-preenchido (email, role=professional, professional_id) reusando lógica de invite-member.

## 3. Fluxo

```
Admin cadastra Profissional (operacional)
  -> clica "Convidar para acesso"
  -> dialog de convite (email, papel=professional, professional_id)
  -> invite-member (valida tenant + nao vinculado)
  -> e-mail enviado
  -> profissional aceita (accept-invitation cria profile + vincula professional.profile_id + desnormaliza email)
  -> redirect para /app/agenda (so propria)
```

## 4. Invariantes

| Entidade | Invariante |
|----------|------------|
| professionals | profile_id, se not null, pertence ao mesmo tenant (FK composta ADR-001). |
| invitations | professional_id, se not null, pertence ao mesmo tenant e nao tem profile vinculado. |
| UI | "Convidar para acesso" so aparece para admin quando profile_id is null. |
| UI | "Revogar acesso" so aparece para admin quando profile_id is not null. |

## 5. Functional Requirements

- RF-03 (vínculo profissional↔login via convite).
- RF-09 (desvincular login de profissional).

## 6. Delta Specs

- frontend-coding-standards.md: N/A.
- dominio.md: N/A (backend ja documentado).

## 7. Critérios de Aceite

- Admin pode convidar profissional pré-cadastrado (botão + dialog).
- Convite vinculado ao professional (professional_id).
- Após aceite, professional.profile_id vinculado e email desnormalizado.
- Profissional logado vê "Acesso vinculado" e pode ter acesso revogado.
- Admin pode revogar acesso (unlink) sem apagar registro operacional.
- Testes de componente + a11y.
