# Débito P2 — check 404 deixa linha eterna em aguardando_qr

**Origem:** bugfix whatsapp evolution-pair-404 (2026-11-02). Code review/dev propôs; usuário não priorizou ainda.

## Bug
`handleCheck` (supabase/functions/whatsapp/index.ts) + `getConnectionState` (evolution-adapter.ts): quando Evolution retorna 404 (instância não existe), check falha best-effort e a linha local fica eterna em `aguardando_qr` → polling infinito na UI.

## Correção proposta
Reconciliar `getConnectionState` 404 → estado `desconectado`/deletar linha. Exige mudança de contrato da interface do adapter (ADR-17 + consumers + mock). Candidata a ADR própria.

## Tarefas
- [ ] Definir contrato: ConnectionStateResultiona incluir `not_found`?
- [ ] Atualizar mock/real adapter + tests
- [ ] Atualizar handleCheck para reconciliar (desconetar linha)
- [ ] Testes: check com instância deletada no Evolution → linha vira desconectado
