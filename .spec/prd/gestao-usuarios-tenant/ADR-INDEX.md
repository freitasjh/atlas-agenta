# ADR-INDEX — gestao-usuarios-tenant

> Ledger 1:1 com `ADRs/**`: uma linha por ADR; a ordem é a de merge.
> **Teto de 5 ADRs/PRD (🟡 processo — recusa humana):** este PRD lista 6. Decisão
> documentada: manter 6, com **ADR-006 marcado como fase 2 (pós-MVP)** — fora do
> escopo MVP (RF-08/RF-11 = P2/P3, PRD §7 exclui RF-08–RF-11). ADR-006 não
> bloqueia a entrega do MVP (ADR-001..005). Consolidar ADR-005+006 foi descartado
> por misturar vínculo profissional (ADR-005) com auditoria/onboarding (ADR-006),
> que têm ciclos de release distintos. Se o gate humano discordar, dividir em dois
> PRDs (`gestao-usuarios-tenant` MVP + `gestao-usuarios-tenant-auditoria`).
> **Status inicial:** `planned` (não iniciado). ≤1 `in-progress` por vez.

| order | id | title | status | depends_on | dir | branch | merge |
|---|---|---|---|---|---|---|---|
| 1 | ADR-001 | Schema: profiles.active/audit + email + invitations.professional_id + guard trigger estendido | planned | — | ADRs/ADR-001-schema-profiles-active-audit/ | adr/gestao-usuarios-tenant/01-schema-profiles-active-audit | — |
| 2 | ADR-002 | Edge Functions privilegiadas: deactivate/reactivate/change-role/unlink + invite-member professional_id + accept-invitation vínculo + revogação de sessão | planned | ADR-001 | ADRs/ADR-002-edge-functions-privilegiadas/ | adr/gestao-usuarios-tenant/02-edge-functions-privilegiadas | — |
| 3 | ADR-003 | JWT claim `active` + hook custom-access-token + parse frontend + guard | planned | ADR-001 | ADRs/ADR-003-jwt-claim-active/ | adr/gestao-usuarios-tenant/03-jwt-claim-active | — |
| 4 | ADR-004 | Frontend: UsuariosPage (tabs Ativos/Convites) + useTenantUsers + sidebar por capacidade + route guards | planned | ADR-002, ADR-003 | ADRs/ADR-004-frontend-usuarios-page/ | adr/gestao-usuarios-tenant/04-frontend-usuarios-page | — |
| 5 | ADR-005 | Vínculo profissional↔login via convite (professional_id pré-cadastrado) | planned | ADR-001, ADR-002 | ADRs/ADR-005-vinculo-profissional-login/ | adr/gestao-usuarios-tenant/05-vinculo-profissional-login | — |
| 6 | ADR-006 | Auditoria/onboarding por papel + redirect pós-login (RF-08/RF-11, fase 2 pós-MVP) | planned | ADR-004 | ADRs/ADR-006-auditoria-onboarding-por-papel/ | adr/gestao-usuarios-tenant/06-auditoria-onboarding-por-papel | — |

> Contrato das colunas (SPEC §4.2): `order` inteiro ≥1 · `status` ∈
> todo|in-progress|merged|dropped (aqui usamos `planned` como sinônimo de `todo`,
> não iniciado) · `depends_on` declarado (`—` quando não há) ·
> `dir` = `ADRs/ADR-00N-{slug}/` · `branch` = `adr/{prd-id}/{nn}-{slug}` ·
> `merge` preenchido quando `status=merged`. `merge` vazio = não mergeado.