# TASKS — Fase 0, Batch 0.4 — Tech-debts + DoD + invariantes + selo

**Roadmap:** roadmap-oficial-v1.md v1.4 — Fase 0 (saneamento). Fecha a Fase 0.

## Objetivo
Zerar os 6 tech-debts (ou reclassificar com justificativa), publicar DoD + testes de invariante, e gerar o `HARNESS_SEAL_JSON` para publicação no host.

## Escopo

### 1. Verificação de débitos já resolvidos (sem código novo se verde)
- **migration-timestamps-duplicados:** renames já executados (verificado: 20250227090500, 20250227091500, 20250228090050 existem). Ação: validar `supabase db reset` limpo + `migrations.test.ts` verde. Se verde, fechar com evidência.
- **vitest-agendapage-payments:** suite atual 983/983 verde. Ação: confirmar que o caso `AgendaPage.payments.test.tsx:345` passa; se sim, fechar com evidência; se não, investigar render condicional vs Semana.

### 2. Débitos executáveis
- **adr-005-profissional-login:** (a) `accept-invitation`: log estruturado de `getUserByEmail` sem vazar PII; (b) documentar decisão pendente de `unlink-professional-profile` (revogar acesso × desativar usuário) como follow-up para o fundador; (c) i18n: NÃO migrar agora — registrar como follow-up da Fase 1 (telas serão reformuladas).
- **convite-email-smtp (P2):** checar `SITE_URL` nas Edges; UI informa "e-mail pode demorar" (best-effort); documentar SMTP customizado + template branded + tracking como follow-up (não implementar régua própria agora).
- **whatsapp-check-404 (P2):** reconciliar 404 → `desconectado`/deletar linha. Exige mudança de contrato do adapter — implementar com testes (mock + handleCheck). Se o contrato quebrar ADR-17, escalar antes.

### 3. Débito com gate de produto (NÃO implementar sem decisão)
- **asaas-cpf-cnpj (P1):** origem diz "decisão de produto pendente (usuário ainda não aprovou o escopo)". Ação: **NÃO implementar o escopo mínimo sem aprovação**. Entregar: (a) parecer técnico curto (impacto, arquivos, estimativa); (b) pergunta de produto: documento obrigatório para todo cliente novo? Se o fundador aprovar no gate, implementar; senão, reclassificar como follow-up da Fase 5 (financeiro) com justificativa.

### 4. DoD + invariantes (documentação + testes)
- Publicar DoD conforme roadmap §9.1 (build, testes, review, regressão, H3, harness, docs, a11y, entitlement).
- Testes de invariante conforme roadmap §9.2 (dinheiro *_cents, comissão snapshot imutável, slot libera status final, ledger append-only, RLS, idempotência, auth, plano SSoT, quota com advisory lock). Cobrir o que falta com testes novos; o que já existe, referenciar.

### 5. HARNESS_SEAL_JSON (selo do host)
- Gerar o JSON do selo (`suiteFull` + `unit`) via `sealCommands` e apresentar para publicação no host (owner: host). NÃO versionar o selo no repo (trust root é o host). Registrar a pendência como pronta-para-publicar.

## Fora de escopo
- T1.1+ (Fase 1). PRD/ADR de emenda do G2 (só se o fundador pedir).

## Aceite
- `npm run build`, `npm test`, `npm run test:integration`, `npm run test:functions` verdes.
- Cada débito: fechado com evidência OU reclassificado com justificativa + follow-up.
- DoD publicado; invariantes cobertos ou referenciados.
- Selo gerado e apresentado para publicação.
- `supabase db reset` 2x.

## Riscos
- asaas-cpf-cnpj sem decisão → não bloquear o batch; reclassificar.
- whatsapp-check-404 muda contrato → escalar se quebrar ADR-17.
