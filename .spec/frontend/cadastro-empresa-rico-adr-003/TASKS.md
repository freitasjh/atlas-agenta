# TASKS — ADR-003 UI Cadastro + ViaCEP (scoped)

## 1. Origem
- SPEC: `.spec/frontend/cadastro-empresa-rico-adr-003/SPEC.md`
- PLAN: `.spec/frontend/cadastro-empresa-rico-adr-003/PLAN.md`

## 2. Backlog
| Task | Tipo | Prioridade | Risco | Status |
|------|------|------------|-------|--------|
| FE-01 | Frontend | P0 | Medium | Todo |
| FE-02 | Frontend | P0 | High | Todo |
| FE-03 | Frontend | P0 | Medium | Todo |
| FE-04 | Frontend | P0 | Medium | Todo |
| FE-05 | Frontend | P1 | Low | Todo |
| IT-01 | Harness | P0 | Medium | Todo |

### FE-01: mask.ts
- **Aceite:** dinâmica CPF/CNPJ, phone 10/11, CEP; colar/apagar OK; strip puro.
- **Done:** testes verdes.

### FE-02: signupSchema + catálogo
- **Aceite:** 14 campos, DV/regex/UF iguais ao servidor; mensagens do catálogo; zero literal solto.
- **Done:** testes com vetores espelhados verdes.

### FE-03: useCepLookup
- **Aceite:** debounce 400ms, timeout/abort 5s, estados, nunca sobrescreve tocado, retry.
- **Done:** testes com fetch mockado verdes.

### FE-04: CadastroPage 4 fieldsets
- **Aceite:** ordem/blocos do parecer; summary ≥2 erros + foco; corpo snake_case exato; autocompletes; toggle senha.
- **Done:** testes de página + a11y verdes.

### FE-05: useSignUp + 409
- **Aceite:** body completo; 201; 409 → mensagem exata; login automático mantido.
- **Done:** testes verdes.

### IT-01: Harness DevTools
- **Aceite:** backend+frontend UP, fluxo real de cadastro (massa sintética), console zero [ERROR]/[WARN], network 201, screenshot, processos finalizados + brain_store.
- **Done:** relatório Anexo B.

## 3. Validação
- [ ] Parecer ux incluído como vinculante (FE-04).
- [ ] Corpo == schema ADR-002.
- [ ] Sem dependência circular; sem órfã.
