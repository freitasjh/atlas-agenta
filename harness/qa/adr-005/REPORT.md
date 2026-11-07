# QA E2E — ADR-005 (painel financeiro + aba Recebimentos)

- Data: 2026-11-07 ~02:00 UTC. Agente: qa-engineer. Fase: Testing.
- Branch stack ADR-001..005, gitSha `83633c7`, worktree dirty pre-existente (QA só adicionou `harness/**`, sem tocar src/supabase/testes, sem commit).
- JSON canônico: `harness/cobranca-formas-pagamento-adr-005.json` (schema válido). Seed: `harness/qa/adr-005/seed-adr005.mjs`.

## H1 — suite completa

- `npm test`: 89 arquivos, **738 passed, 0 failed** (sha256 `7f2fd7f9…`).
- `npm run typecheck`: exit 0 (sha256 `1f6b841a…`).
- H2: zero falhas pré-existentes (suite verde antes e depois do E2E).

## H3 — harness E2E (Chrome DevTools real, 1280 + 375)

Stack: `npx supabase start` (estava down) + `functions serve` + `vite --port 5174` (5173 é atlas-financeiro, intocada). Probes: REST 200, Auth 200, signup `{}`→400, front 200. Massa sintética `[QA-ADR005]` no tenant demo barbearia: A1 quitado dinheiro 5000+gorjeta 500; A2 parcial cartão 4000/12000; A3 estornado pix_maquininha 5000; A4 sem pagamento + charge pendente 8000; usuários recepção e profissional.

| # | Cenário | Status | Evidência |
|---|---|---|---|
| 1 | Login admin → hub → card Financeiro | pass | 01 |
| 2 | Painel este mês: 90,00 / 5,00 / 95,00 / 80,00 / 130,00 + 5 linhas + nota + link comissões | pass | 02 + body RPC req 4719 |
| 3 | Mês passado: zeros, a receber snapshot 80,00 | pass | 03 |
| 4 | Skeleton (aria-busy) em range novo, sem número antigo | pass | — (observado via snapshot) |
| 5 | fim<início sem RPC; >366d rejeitada; ambos painel de erro + retry | pass | 04, 05 |
| 6 | Recebimentos: Todos(3)/Ativos(2)/Estornados(1), método Dinheiro(1), presets, URL como estado, pag 1/1 | pass | 08–12 |
| 7 | Recepção: sem Cobranças/Relatórios no nav, 403 direto, zero requests financeiros | pass | 14 |
| 8 | Profissional: 403 no hub e no financeiro, zero requests | pass | 15 |
| 9 | 375 e 1280 sem overflow (scroll==client, 0 estouros) | pass | 07, 13 |
| 10 | Console zero erro app; network sem 4xx/5xx inesperado | pass | — |

Console: 0 `[ERROR]` / 0 `[WARN]` (só debug vite + info React DevTools). Network: 1 `POST /rpc/financial_summary` [200] por carga (`p_from` 2026-11-01T03:00Z = 00:00 SP — fuso tenant ok); recepção/profissional zero `financial_summary`/`appointment_payments` no xhr.

## H4 — avaliação

- Telas: sem overflow 375/1280, empty/error/loading presentes, filtros rotulados. Ressalvas P2/P3 abaixo.
- Negócio: receita só ledger, gorjeta separada, estorno fora das somas e no histórico, a receber não infla receita, em aberto por `starts_at`. RBAC confere.
- Lógica: nenhum `charges.pago` como receita; inválido não dispara RPC; >366d rejeitada no banco; sem N+1 (embed + count exact).
- Perf: 1 RPC/query por carga, sem refetch por tecla; sem medição formal de Web Vitals.

## H5 — brain + encerramento

- `brain_store`: `sessoes/atlas-agenda/2026-11-07-adr-005-e2e-qa` (+ append em `regras/projetos/atlas-agenda/pagamentos-e2e-armadilhas`).
- Encerramento: Vite 5174 + functions serve mortos por PID (dono por cwd/porta), 5174 free, signup→503; stack parada (`supabase stop`, estado inicial); sem `pkill -f`.

## Bugs

- **QA-ADR005-01 (P2)**: preset já pressionado não refaz fetch — com start/end custom + erro, clicar no preset ativo não muda `preset`, `useEffect` não roda, painel fica preso no erro até clicar outro preset. Repro: personalizado com fim<início → erro → clicar "Este mês" (já ativo). Esperado: refetch do preset.
- **QA-ADR005-02 (P3)**: `relatorio-inicio`/`relatorio-fim` duplicados entre Financeiro/Recebimentos/Comissões (mesmo componente `PeriodFilter` com ids fixos). Sem impacto (um por página), mas `getElementById` é ambíguo no app.

## Não coberto

Paginação além da página 1 (3 linhas < 25); estorno/baixa/cancelamento pela UI (ADR-004); tenant clínica/legado `payments=false` (só teste unitário); exportação (fora do escopo ADR-005).
