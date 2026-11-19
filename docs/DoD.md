# Definition of Done — Atlas Agenda (Fase 0, Batch 0.4)

Publicado em: 2026-11-10. Dono: orquestrador (fonte: roadmap §9.1).
Nenhuma fase se declara completa sem todos os itens ✅.

## Checklist

- [ ] **Build** — `npm run build` (tsc + vite) zero erros.
- [ ] **Testes** — `npm test` (unit, meta ≥ 983), `npm run test:integration`
      (326) e `npm run test:functions` (452, deno) verdes, zero falhas
      (H2: pré-existente também bloqueia).
- [ ] **Review** — `code-reviewer` após a última mudança; zero 🔴.
- [ ] **Regressão** — suíte completa antes e depois do dev; débito P1 no
      domínio agenda/pagamentos zera a suíte antes do próximo dev.
- [ ] **H3** — harness E2E greenfield nos pontos de virada (wipe + re-cadastro
      via UI, Network/Console limpos, screenshots).
- [ ] **Harness** — evidência em `harness/<demanda>.json` + `brain_store`.
- [ ] **Docs** — SPEC/PLAN/TASKS da fase + Delta Specs mesclados; follow-ups
      registrados em `docs/F0.4-followups.md`.
- [ ] **a11y** — labels/foco/contraste/teclado; mobile-first 375px.
- [ ] **Entitlement** — RBAC por papel + `tenant_id` do JWT (nunca do cliente);
      `bloqueado`/`cancelado` trava escrita e disparos.

## Matriz de invariantes (§9.2) — onde cada um é coberto

| Invariante | Coberto em | Tipo |
|---|---|---|
| Dinheiro em `*_cents` inteiros (nunca float) | `src/lib/invariants.test.ts` + `src/lib/money.ts` | unit |
| Catálogo v1 de métodos/estados de pagamento | `src/lib/invariants.test.ts` (`PAYMENT_METHODS`, `PAYMENT_STATUSES`) | unit |
| `plans` sem `tenant_id`, leitura pública sem escrita | `src/lib/invariants.test.ts` (estático) + `tests/integration/security/plans-catalog.test.ts` | unit + IT |
| Comissão sobre snapshot imutável (`commission_base_cents`, travado por trigger) | `tests/integration/security/fase0-p0.test.ts` (G1) | IT |
| Estorno NÃO altera comissão (RF-24; G2 reclassificado, sem reversão) | `.spec/bugs/fase0-saneamento/TASKS.md` (decisão do fundador 10/11/2026) | decisão |
| Slot libera em status final (`concluido` fora do overlap) | `tests/integration/security/fase0-p0.test.ts` (G3) | IT |
| Ledger append-only (estorno lógico, sem UPDATE/DELETE) | `tests/integration/security/appointment-payments-schema.test.ts` (I1–I3, RF-04) | IT |
| RLS/isolamento por tenant + `tenant_id` do JWT | `tests/integration/security/rls-isolation.test.ts`, `client-writes.test.ts`, `appointment-payments-rls.test.ts` | IT |
| Idempotência (dedupe + claim com fence) | `tests/integration/security/payments-claim-fencing.test.ts`, `payments-webhook.test.ts` | IT |
| Auth (JWT → profiles, sem tenant do cliente) | `tests/integration/security/profiles-active-rls.test.ts`, `payments-edges-auth.test.ts` | IT |
| Quota com advisory lock (`pg_advisory_xact_lock`) | `tests/integration/security/plans-catalog.test.ts` + migration `20261114000000_plan_catalog_ssot.sql` | IT + estático |
| Check-404 reconcilia para `desconectado` | `supabase/functions/whatsapp/reconcile.test.ts` + `evolution-adapter.test.ts` | deno |
| Migrations aplicadas intactas (D-11) | `tests/integration/security/migrations.test.ts` (allowlist dos 3 renames P1) | IT |
