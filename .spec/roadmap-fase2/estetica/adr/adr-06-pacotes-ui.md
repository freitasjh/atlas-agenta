# ADR-06 — G6 Pacotes UI: config + venda + saldo/baixa

- Status: proposto

## Contexto

Backend ADR-02 pronto (RPCs venda/baixa/saldo). UX-SPEC T3 exige Config Pacotes admin, Dialog venda, card saldo, baixa automática ao concluir, vencido renova, recepção sem preço, zero bloqueia + avulso. Gating `pacotes` (ADR-01). Ajuste 7 (table caption/scope). Defaults §8 #1/#2/#3/#6/#7.

## Decisão

UI fina sobre RPCs, sem lógica de saldo no cliente (servidor é SSoT):

- Config → Pacotes (admin-only, padrão CombosPage): `<table>` real com `<caption>` + `scope` nos th + Dialog novo pacote (labels visíveis, nunca placeholder-only).
- Venda no Drawer Pagamento ou Clientes: Dialog (select pacote + início + resumo + Confirmar) → chama `sell_package`; recepção vende (sem ver preço de custo — só resumo da venda).
- Card saldo "X/Y restantes, expira D" + progress `role=progressbar` com `aria-valuenow/min/max` + texto % (nunca só cor); baixa automática ao concluir (toast undo 5s — undo = correção lógica, não DELETE); vencido → badge + "Renovar" (venda nova); zero → bloqueia + oferece avulso; receptionist vê só "N restantes".
- Gating: sem `pacotes` → empty + upsell, sem request de venda.

## Consequências

- Positivas: fluxo completo venda→baixa sem segundo financeiro; comissão intacta (preço cheio, default #8 — sem código aqui).
- Risco: duplo-clique na baixa — mitigado com idempotência (mesmo `appointment_id` não baixa 2x; teste).

## Escopo

Entra: config + venda + saldo + toast + gating. Não entra: desconto/override, checkout financeiro (ADR-07), mudança comissão.

## Arquivos afetados

- Novo `src/app/config/pacotes/*` (tabela + Dialog, espelho CombosPage)
- `src/app/agenda/pagamentos/*` ou Drawer (Dialog venda + card saldo)
- Testes: tabela com caption/scope, venda chama RPC, saldo progressbar com aria-values, recepção sem preço, zero bloqueia, idempotência baixa

## Critérios de aceite (testáveis)

1. Admin cria pacote via Dialog; tabela tem `<caption>` e `th scope`.
2. Venda com entitlement ok chama `sell_package` e mostra card "X/Y, expira D"; sem entitlement → upsell, sem chamada.
3. Concluir com saldo → toast undo 5s e saldo -1; duplo concluir não baixa 2x.
4. Vencido mostra badge + Renovar (nova venda); zerado bloqueia + sugere avulso.
5. Receptionist vê "N restantes" e não vê preço (assert na DOM).

## Dependência

ADR-01 (`pacotes`) + ADR-02 (RPCs). Independente de ADR-03/04/05.
