# PLAN — ADR-003 UI Cadastro + ViaCEP (scoped)

## 1. Contexto
- **SPEC:** `.spec/frontend/cadastro-empresa-rico-adr-003/SPEC.md`
- **ADR:** `.spec/prd/cadastro-empresa-rico/ADRs/ADR-003-ui-cadastro-viacep/ADR.md`
- **Depende de:** ADR-002 (branch base). **ux-designer:** parecer vinculante (SPEC §1).

## 2. Estratégia
React 18 + shadcn/ui + react-hook-form + zod; máscaras em `src/lib/mask.ts`; ViaCEP em `useCepLookup` (fetch + Abort, sem lib); catálogo `cadastro-messages.ts`; testes vitest + happy-dom (fetch mockado).

## 3. Tarefas
- **[FE-01]** `mask.ts` + testes (dinâmica 11↔14, caret/delete, colar, strip).
- **[FE-02]** `signupSchema` estendido + `cadastro-messages.ts` + testes (vetores espelhados do servidor).
- **[FE-03]** `useCepLookup` + testes (debounce, abort, estados, nunca-sobrescreve-tocado).
- **[FE-04]** `CadastroPage` 4 fieldsets + summary + ViaCEP UI + testes de página.
- **[FE-05]** `useSignUp` body completo + `mapSignUpError` 409 + testes.
- **[IT-01]** Harness DevTools (página real + backend local: console zero erros, network 201, screenshots, processos finalizados + brain_store).

## 4. Riscos
- **HIGH: divergência cliente↔servidor** — mesmos vetores DV/regex/mensagens; teste espelhado.
- **MEDIUM: máscara dinâmica frágil** (caret/delete, Gboard/iOS) — testes + harness manual.
- **MEDIUM: race ViaCEP** — Abort obrigatório + teste.
- **LOW: segment migrado de bloco** — zod + payload atualizados juntos.

## 5. Caminho crítico
FE-01 → FE-02 → FE-03 → FE-04 → FE-05 → IT-01 → review → PR (base: branch ADR-002 até merge).
