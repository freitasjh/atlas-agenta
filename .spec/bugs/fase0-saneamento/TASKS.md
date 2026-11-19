# TASKS — Fase 0 (Saneamento e Fundação) — Batch 0.1: correções P0 de lógica

**Roadmap:** `roadmap-oficial-v1.md` v1.3 — Fase 0.
**Baseline (gate de pré-delegação):** unit 942/942 · integração 312/312 · build ok · functions 449/449 · plugins 9/9 — **0 falhas**.
**Tipo:** bugfix (fast-track). **Severidade:** P0 (dinheiro/agenda).

---

## G1 — Comissão não é snapshot do preço do agendamento

- **Causa raiz:** o trigger `supabase/migrations/20250226092000_commission_on_conclude.sql` apura a comissão com `new.price_cents` **no momento da conclusão**. Se o preço mudar entre agendar e concluir, a comissão usa o preço novo. O comentário diz "snapshot do preço no ato do agendamento", mas o código não é um snapshot.
- **Solução (duas opções — o desenvolvedor propõe, o review decide):**
  - (a) gravar um snapshot imutável do preço no agendamento (ex.: `commission_base_cents` no INSERT) e o trigger usar essa coluna; ou
  - (b) bloquear alteração de `price_cents` após o agendamento (regra explícita + validação).
- **Teste de regressão obrigatório:** alterar o preço entre agendar e concluir → a comissão deve usar o preço do agendamento.

## G2 — Estorno de pagamento NÃO reverte comissão (RECLASSIFICADO)

- **Decisão do fundador (10/11/2026):** o comportamento atual é o correto (RF-24 do PRD aprovado + ADR-001/002/005). Estorno de pagamento é **caixa**; comissão é **competência** (serviço prestado). **Não implementar reversão.**
- **Ação:** correção documental apenas (roadmap G2 + §9.2 + este TASKS + regra de domínio).

## G3 — Atendimento concluído continua ocupando slot

- **Causa raiz:** a constraint `appointments_no_overlap` (`supabase/migrations/20261112090000_appointments_no_overlap_origin.sql`) libera `cancelado`, `nao_compareceu` e **só** `walk_in` concluído. Agendado concluído antes do fim do intervalo continua indexado.
- **Evidência:** follow-up `agendado-concluido-ocupa-slot` em `workflow-state.json`.
- **Solução:** `concluido` é status final/histórico → **sai do índice de conflito para toda origem**.
- **Teste de regressão obrigatório:** encaixe/walk-in sobre agendado já concluído não deve violar a exclusão (23P01).

---

## Riscos

- G1 mexe em trigger de máquina de estados + apuração de dinheiro.
- G3 mexe em constraint de exclusão (alto risco de regressão em agendamento).
- G2 reclassificado — não muda contrato; documento alinhado à RF-24.

## Fora deste batch (Fase 0, batches seguintes)

- **T1.0** — catálogo SSoT de planos + paridade + TOCTOU (G29) + rename (Starter/Premium/Enterprise + Free).
- **6 tech-debits** — `adr-005`, `asaas-cpf-cnpj`, `convite-email-smtp`, `migration-timestamps-duplicados`, `vitest-agendapage-payments`, `whatsapp-check-404`.
- **DoD + testes de invariante + publicar `HARNESS_SEAL_JSON`**.
