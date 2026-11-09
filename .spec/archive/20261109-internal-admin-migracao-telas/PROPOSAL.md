# PROPOSAL — internal-admin-migracao-telas (todas de uma vez, legado removido)

- Tipo: Feature (segurança, P0)
- Origem: Rota B 6/6 + triagem architect/PM

## Problema
Operação roda em `/admin` legado (auth por `profiles.role=super_admin`, sem MFA). `/internal-admin` (operador + AAL2) existe com home mínima. Risco BOLA/takeover persiste enquanto legado existir.

## Solução (architect + PM)
Mover Empresas (+dialogs, TenantPlanoPage), Assinaturas, Métricas (+telemetria) para `/internal-admin` sob `RequireInternalOperator` + shell interno novo; deletar bloco `/admin`, `AdminLayout/Sidebar`, links e testes órfãos. `git mv` (preserva histórico), dual-mount breve p/ QA comparativo, legado read-only → 410/redirect → delete.

## Achado crítico (condiciona SPEC)
Todos RPCs/RLS exigem JWT `super_admin`; sessão operador (sem `user_role`) NÃO passa hoje. "Mesmas fontes sem reescrever queries" exige ADR-02 backend: Edges/RPCs aceitam prova operador+AAL2 server-side sem afrouxar RLS de tenant. Sem isso, telas migradas voltam vazias/403. Frontend não resolve sozinho.

## Escopo
- Entra: 5 telas + shell interno + back-link + redirect `/admin/*` → `/internal-admin/*` (1 release) + testes atualizados + ADR-02 backend.
- Fora: feature nova, redesign, WebAuthn, IP allowlist, kill switches (fases seguintes).
- Aberto p/ decisão no portão: `dashboard` (placeholder), `convites`, `auditoria` — migrar junto ou deletar com justificativa (hoje em `/admin`, fora da lista fechada).

## Riscos
- BOLA por afrouxamento errado (mitiga: guard server-side por request, teste BOLA ambos sentidos).
- Órfãos (Sidebar, pages.tsx, testes, parity test).
- Deep-links `/admin/*` (mitiga: redirect 1 release).
- Layout `max-w-md` inadequado p/ tabelas (mitiga: shell novo pré-requisito).

## Delta
- ADDED: `InternalShell`, rotas internas, ADR-01..05 (02 backend bloqueante).
- MODIFIED: router, guards/gates (negar sem operador+AAL2), testes, parity.
- REMOVED: bloco `/admin`, `AdminLayout/Sidebar`, policies legadas (F1-drop datado).
