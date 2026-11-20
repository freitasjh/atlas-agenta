---
esperado: rota-b
---

# i18n da tela de login

Colocar todos os textos visíveis da tela de login em português e inglês, trocando o locale pelo seletor do topo. Escopo: apenas `src/pages/Login.vue`, `src/i18n/messages/pt-BR.ts` e `en-US.ts`; não mexer no fluxo de autenticação nem nas outras telas. Manter `pt-BR` como fallback e nenhum literal fora dos arquivos de locale. Feature. Pronto quando `npm run test:run` e `npm run build` passarem e o teste de troca de locale em browser real mostrar as duas versões sem `[WARN]` no console.

## Veredito esperado (contrato — não é o prompt)

E1 ✅ · E2 ✅ · E3 ✅ · E4 ✅ · E5 ✅ · E6 ✅ → Rota B.
