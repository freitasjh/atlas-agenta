# RESEARCH — Formas de pagamento no fechamento do atendimento

> **prd-id**: `cobranca-formas-pagamento`
> **Data**: 2026-11-06
> **Escopo**: salão de beleza e barbearia (clínica/convênio fora — PRD §7)
> **Status**: insumo para ADR-001..ADR-005 (nenhuma decisão de implementação aqui)
> **Método**: pesquisa em documentação primária (Stripe, PostgreSQL, Supabase, Asaas, PCI SSC)
> com data de acesso registrada. Nenhuma fonte foi inventada; cada afirmação abaixo aponta a URL
> e o trecho usado.

## 1. Pergunta de arquitetura

Como registrar **recebimentos multi-forma** (dinheiro, crédito, débito, PIX do sistema, PIX da
maquininha), com **split**, **parcial**, **gorjeta**, **estorno lógico** e **idempotência**, sem
transformar `charges` (cobrança PIX do Asaas) na fonte de verdade da receita e sem violar
isolamento multi-tenant, RLS, centavos inteiros ou PCI?

Restrições já fechadas (não reabertas):

- `charges` hoje é PIX-only, unique por atendimento, RLS admin-only
  (`supabase/migrations/20250306100000_asaas_charges.sql:16-32,53,74-77`).
- A receita do painel lê `charges` com `status='pago'`; a comissão usa `appointments.price_cents`
  no gancho de `concluido` (`20250226092000_commission_on_conclude.sql:98-108`).
- Escrita privilegiada só em Edge Function com service role; `tenant_id` vem do vínculo
  autenticado, nunca do corpo do cliente.
- Dinheiro em centavos inteiros; tempo em UTC (`timestamptz`).
- Gorjeta fora da receita de serviço e da comissão; comissão inalterada no v1.
- PIX do sistema só por escolha, no valor da parcela, no máximo 1 por atendimento.
- Estorno do v1 é lógico (ledger), não financeiro no gateway.

## 2. Fontes consultadas

| # | Fonte | URL | Acesso | O que foi usado |
|---|---|---|---|---|
| F1 | Stripe — Idempotent requests | https://docs.stripe.com/api/idempotent_requests | 2026-11-06 | Chave de idempotência gerada pelo cliente (sugestão V4 UUID); retries com a mesma chave devolvem a resposta salva; a camada compara parâmetros e **erra se forem diferentes**; retenção de 24 h na API v1; não usar dado sensível como chave. |
| F2 | Stripe — Payment Intents lifecycle | https://docs.stripe.com/payments/paymentintents/lifecycle | 2026-11-06 | Separação entre **intenção de cobrança** e **pagamento confirmado** (`requires_* → processing → succeeded/canceled`); cancelamento invalida tentativas futuras. Usado como analogia para `charges` (gateway) ≠ `appointment_payments` (recebido). |
| F3 | PostgreSQL — Partial Indexes | https://www.postgresql.org/docs/current/indexes-partial.html | 2026-11-06 | Índice único **parcial** impõe unicidade apenas entre as linhas que satisfazem o predicado (`Example 11.3`), sem restringir as demais. Base para “no máximo uma cobrança pendente”. |
| F4 | PostgreSQL — Explicit Locking | https://www.postgresql.org/docs/current/explicit-locking.html | 2026-11-06 | `SELECT ... FOR UPDATE` bloqueia escrita/concorrência na mesma linha até o fim da transação; locks de linha não afetam leitura; deadlocks são resolvidos por aborto e devem ser evitados com ordem consistente de aquisição. Base para a trava do atendimento no fechamento. |
| F5 | Supabase — Row Level Security | https://supabase.com/docs/guides/database/postgres/row-level-security | 2026-11-06 | Grants e policies são **duas checagens**: grants decidem se o role pode operar na tabela; policies recortam linhas. Nova tabela em `public` pode nascer com privilégios para `anon`/`authenticated`; é preciso `revoke` explícito. `service_role` bypassa RLS e nunca vai ao browser. Policies por operação e índice nas colunas filtradas. |
| F6 | Supabase — Custom Claims & RBAC | https://supabase.com/docs/guides/api/custom-claims-and-role-based-access-control-rbac | 2026-11-06 | Claims customizadas via Auth Hook e `auth.jwt()` em policies; o JWT pode estar **desatualizado** até o refresh. Usado para justificar por que dinheiro continua lendo `current_role_name()`/`current_tenant_id()` (estado atual do banco), não a claim do token. |
| F7 | Asaas — Introdução a Webhooks | https://docs.asaas.com/docs/about-webhooks | 2026-11-06 | Entrega **at least once** (o mesmo evento pode chegar mais de uma vez); `id` do evento deve ser persistido para dedupe; token no header `asaas-access-token`; 15 falhas consecutivas podem pausar a fila; eventos ficam 14 dias. |
| F8 | Asaas — Eventos de pagamento | https://docs.asaas.com/docs/payment-events | 2026-11-06 | `PAYMENT_CONFIRMED` (pago, saldo ainda não disponível), `PAYMENT_RECEIVED` (recebido), `PAYMENT_OVERDUE` (vencido); payload pode ganhar campos novos e o receptor não deve quebrar. |
| F9 | PCI SSC — PCI DSS | https://www.pcisecuritystandards.org/standards/pci-dss/ | 2026-11-06 | PCI DSS se aplica a quem **armazena, processa ou transmite** dados de portador de cartão; o escopo cresce com o contato com o PAN. |
| F10 | Stripe — Integration security guide | https://docs.stripe.com/security/guide | 2026-11-06 | Integrações de baixo risco não deixam dados de cartão passar pelos servidores da aplicação; bandeira, últimos 4 e validade ficam fora do escopo PCI; TLS obrigatório. |

## 3. Padrões extraídos das fontes

### 3.1 Idempotência de fechamento (F1)

- A chave é gerada no **cliente** e reutilizada em retries da **mesma** operação; retry não é
  novo lançamento.
- A mesma chave com **parâmetros diferentes** é erro, não “última escrita vence” (F1).
- Retenção finita (24 h na API v1 da Stripe) significa que a chave não substitui a unicidade
  persistida no banco: o ledger precisa de uma restrição durável
  (`(tenant_id, idempotency_key, line_index)`), não só de memória do gateway.
- Não usar e-mail/telefone/documento como chave (F1) — alinhado a RNF-08/LGPD.

**Tradução para o Atlas:** `idempotency_key uuid` por lote de fechamento + `line_index` por linha;
unique parcial persistido; replay devolve as linhas existentes; payload divergente na mesma chave
→ `409 IDEMPOTENCY_CONFLICT`.

### 3.2 Cobrança ≠ recebimento (F2)

Payment Intent é uma **intenção** que passa por estados até `succeeded`; cancelar invalida a
intenção. Isso é exatamente a diferença que falta hoje no Atlas: `charges` é a intenção/cobrança
PIX no Asaas; o **recebimento** só existe quando o dinheiro entra (webhook ou baixa manual).

**Tradução:** `charges` permanece gateway-only; `appointment_payments` é o ledger do recebido.
Uma cobrança pendente **reserva** valor, mas não é receita. Um `pix_sistema` só vira linha de
recebimento após `settle_charge_payment` (webhook/baixa manual), com unique por `charge_id`.

### 3.3 Unicidade condicional no Postgres (F3)

Índice único parcial resolve “no máximo um X entre as linhas que importam” sem proibir o
histórico. Exemplo canônico: `create unique index ... where success` (F3).

**Tradução:** unique parcial em `charges` para o cap de cobrança do atendimento e unique parcial
em `appointment_payments (tenant_id, idempotency_key, line_index)` para idempotência. O predicado
`where idempotency_key is not null` deixa webhook/backfill (sem chave) fora da restrição.

### 3.4 Concorrência no fechamento (F4)

`SELECT ... FOR UPDATE` serializa duas recepções no mesmo atendimento; a segunda espera a
transação da primeira e relê o saldo já atualizado. A ordem de aquisição deve ser consistente para
evitar deadlock (F4).

**Tradução:** o RPC de registro trava **uma** linha (`appointments`) por `(tenant_id, id)` antes
de calcular `pago + reservado + novo`; a criação da cobrança PIX revalida o saldo e usa unique
parcial para a corrida “duas cobranças pendentes”.

### 3.5 RLS: grants + policies, e a fonte do tenant (F5, F6)

- RLS sem `revoke` não protege: grants automáticos podem dar INSERT a `authenticated` mesmo sem
  policy de escrita (F5). A migration precisa `revoke all` e devolver só `select`.
- `service_role` bypassa RLS e só pode existir no servidor (Edge Function) (F5).
- Claim de JWT pode estar velha até o refresh (F6). Para autorização financeira, ler o estado
  atual (`profiles.tenant_id`/`role`) via funções `security definer` já existentes
  (`current_tenant_id()`, `current_role_name()`) é mais seguro que confiar em claim customizada.

**Tradução:** `appointment_payments` com RLS admin-only para `select`; **nenhuma** policy de
insert/update/delete; `revoke all from anon, authenticated` + `grant select to authenticated`;
escrita só por RPC/Edge com service role. Recepção/profissional leem **um** atendimento por Edge,
nunca a tabela para varredura.

### 3.6 Webhook: at-least-once, dedupe e não regressão (F7, F8)

- O `id` do evento é a chave de dedupe; a entrega pode repetir (F7).
- `PAYMENT_CONFIRMED` e `PAYMENT_RECEIVED` são momentos distintos; `PAYMENT_OVERDUE` não pode
  rebaixar uma cobrança já paga (F8).
- O payload pode ganhar campos; validação deve ser tolerante a campos extras (F8).

**Tradução:** manter `webhook_events (event_id, payment_id)`; o webhook chama
`settle_charge_payment`, que faz insert idempotente do recebimento e só marca `pago` se ainda não
estiver `pago`; `PAYMENT_OVERDUE` só altera `pendente → expirado`; cobrança cancelada que recebe
pagamento gera **anomalia**, não receita.

### 3.7 PCI: por que não guardar cartão (F9, F10)

O Atlas **não processa cartão**: crédito/débito e PIX da maquininha são declarados pelo operador;
a captura acontece na maquininha física, fora do sistema. Guardar PAN/CVV/bandeira ampliaria o
escopo PCI (F9) e criaria um passivo desnecessário; a integração de baixo risco mantém esses
dados fora dos servidores da aplicação (F10).

**Tradução:** o ledger guarda apenas `method ∈ {cartao_credito, cartao_debito, ...}` e valores.
Nenhum campo de cartão, bandeira, NSU, autorização ou adquirente no v1. O comprovante não imprime
dados de cartão.

## 4. Alternativas de modelo de dados

### Alternativa A — Estender `charges` com forma de pagamento, gorjeta e split

**Desenho:** adicionar `method`, `tip_cents`, `parent_charge_id`, permitir N linhas por
atendimento e usar `charges` como receita e cobrança ao mesmo tempo.

**Prós**

- Menos objetos de banco; reusa hooks/telas de cobranças.
- Backfill “zero” (as linhas já existem).

**Contras**

- Mistura **cobrança de gateway** com **recebimento**; o status `pago` passa a significar duas
  coisas e a receita fica acoplada ao Asaas.
- `charges` tem `asaas_payment_id unique`, QR/copia-e-cola e ciclo de webhook — colunas que não
  fazem sentido para dinheiro/cartão/maquininha (ficariam nulas e o modelo viraria “tabela suja”).
- O unique atual por atendimento teria de ser removido; a idempotência passaria a depender de
  combinações de colunas nulas, e o histórico de uma cobrança PIX não paga se confundiria com
  recebimento manual.
- RLS admin-only de `charges` não pode ser afrouxada sem expor QR/gateway; recepção continuaria
  sem caminho de leitura escopada.
- Comissão e relatórios passariam a ler uma tabela com dois significados; risco alto de receita
  dupla (PRD §8).

**Veredito:** descartada. Viola a separação “receita ≠ a receber” (RF-25) e aumenta o risco de
dupla contagem.

### Alternativa B — Ledger `appointment_payments` (1:N) + `charges` gateway-only

**Desenho:** nova tabela imutável de recebimentos por atendimento; `charges` continua só a
cobrança PIX do Asaas; vínculo opcional `charge_id`; escrita por RPC/Edge com service role; RLS
admin-only na tabela e leitura escopada por atendimento via Edge; backfill dos `charges` pagos.

**Prós**

- Fonte única de receita, separada de “a receber” (RF-25). O painel soma **só** o ledger; cobrança
  pendente é reserva, não receita.
- Split, parcial, gorjeta e estorno lógico cabem no modelo sem colunas de gateway.
- Imutabilidade: correção = estorno (`voided_at`) + novo lançamento; auditoria preservada (RF-13).
- Idempotência durável: `(tenant_id, idempotency_key, line_index)` + unique por `charge_id`.
- RLS simples: `select` admin; escrita só service role; recepção/profissional leem um atendimento
  por Edge, sem varredura (RF-20/RF-21).
- Backfill idempotente por `not exists`; `charges` pagos sem atendimento ficam de fora e são
  contados para relatório.
- Comissão intocada: continua no trigger de `concluido` sobre `price_cents`.

**Contras**

- Um objeto novo + backfill + dois caminhos de leitura (admin direto; operação via Edge).
- Exige disciplina de escrita: nenhum `insert` direto no cliente; toda mutação em RPC.
- Duplica “valor” entre `charges.amount_cents` (reserva) e `appointment_payments.amount_cents`
  (recebido) — mitigado por `charge_id` unique e pela regra “nunca somar os dois”.

**Veredito:** **recomendada**.

### Alternativa C — Ledger + caixa/turno (sangria, fechamento de caixa)

**Desenho:** B + entidades de caixa (`cash_sessions`, `cash_movements`), abertura/fechamento por
operador, conferência de dinheiro e relatório de turno.

**Prós**

- Controle de gaveta e conciliação de dinheiro físico mais forte.
- Base para relatórios por turno no futuro.

**Contras**

- **Fora do escopo declarado** (PRD §7: “caixa/turno/sangria e fechamento de caixa”).
- Adiciona estados, permissões e telas que o MVP não pede; aumenta o risco de atrasar a entrega
  e de conflitar com a definição de receita por `received_at`.
- Sem requisito de conferência de gaveta no PRD; o valor recebido em dinheiro (troco) já foi
  aceito como **não persistido** no v1 (ambiguidade #5).

**Veredito:** descartada **para o v1**; permanece como evolução possível em PRD próprio.

## 5. Comparação objetiva

| Critério | A — estender `charges` | B — ledger + gateway-only | C — ledger + caixa |
|---|---|---|---|
| Fonte única de receita (RF-25) | ❌ confusa | ✅ clara | ✅ clara |
| Split/parcial/gorjeta | ⚠️ colunas nulas e semântica dupla | ✅ 1:N natural | ✅ 1:N natural |
| Idempotência durável | ⚠️ depende de combinação de nulos | ✅ unique por chave + `charge_id` | ✅ igual B |
| RLS admin × leitura escopada | ❌ `charges` não pode abrir | ✅ tabela admin + Edge escopada | ✅ igual B |
| Backfill | ✅ não precisa | ✅ idempotente e auditável | ✅ igual B |
| Escopo do PRD | ⚠️ muda contrato de `charges` | ✅ dentro | ❌ fora (§7) |
| Custo de entrega | baixo no início, alto em correção | médio | alto |
| Risco de receita dupla | alto | baixo | baixo |

## 6. Decisões de arquitetura que o RESEARCH fundamenta

1. **B**: `appointment_payments` é o ledger; `charges` é gateway-only. Base: F2, F5, RF-25.
2. **Unique parcial** em `charges` para o cap de cobrança e em `appointment_payments` para
   idempotência. Base: F3.
3. **`SELECT ... FOR UPDATE`** no atendimento durante o registro. Base: F4.
4. **RLS admin-only + `revoke` explícito + Edge service role** para escrita e leitura escopada.
   Base: F5, F6.
5. **Webhook chama RPC idempotente**, não faz `update` direto; `pago` nunca é rebaixado. Base:
   F7, F8.
6. **Nenhum dado de cartão** no ledger ou no comprovante. Base: F9, F10.
7. **Gorjeta fora da receita/comissão** e **comissão inalterada** são regras do PRD (D6/D8),
   não consequência de fonte externa.

## 7. O que este RESEARCH não decide

- DDL final, nomes de índice e assinatura de RPC → ADR-001/ADR-002.
- Janela exata do QR, retry e contrato de erro → ADR-002/ADR-003/ADR-004.
- Copy pt-BR, estados visuais e acessibilidade → ADR-004 (com revisão do `ux-designer`).
- KPIs, capabilidades e atualização das regras → ADR-005.

## 8. Recomendação

**Adotar a Alternativa B**: ledger `appointment_payments` (1:N) como fonte única de receita,
`charges` restrita a cobrança PIX do gateway, escrita exclusivamente por RPC/Edge com service
role, RLS admin-only na tabela e leitura por atendimento via Edge, backfill idempotente dos
`charges` pagos e estorno lógico no próprio ledger.

A recomendação é coerente com o PRD aprovado (RF-01..RF-29, RNF-01..RNF-12) e com as decisões
D1–D9; não introduz adquirente, caixa/turno, desconto, parcelamento, estorno financeiro real nem
leitura cross-tenant. As alternativas A e C ficam registradas com o motivo objetivo de descarte.
