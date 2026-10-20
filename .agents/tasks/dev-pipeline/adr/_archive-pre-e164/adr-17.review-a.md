# Parecer de Review — ADR-17

**Revisor:** A (independente)  
**ADR:** adr-17-evolution-port-check-contract.md  
**Commit:** 8616ebf (`feat: add getConnectionState port and check action contract`)  
**Data:** 2026-10-20

## Resumo

ADR-17 estende a porta `EvolutionAdapter` com o método `getConnectionState` e adiciona o contrato da action `check` em `schemas.ts`. Ambas são peças de infra pura (sem mudança de comportamento observável até ADR-18/19). O código implementa corretamente:

1. Interface `EvolutionAdapter.getConnectionState` com ambos adapters (Mock e Real) implementando-a.
2. Contrato de requisição `checkInputSchema = { action: "check" }` integrado à `requestSchema`.
3. Contrato de resposta `checkResponseSchema` exportado com tipo `CheckResponse`.
4. Validação de dado externo com zod, falha controlada pt-BR, sem vazar corpo ou API key.
5. Mock retorna `{ state: "open" }` mantendo fallback de demo sem rede.

**Build:** ✅ Passou (tsc + vite)  
**TypeCheck:** ✅ Sem erros  
**Lint:** N/A (sem deno CLI no env local; análise manual validou padrões)

---

## Validação de Critérios de Aceite (CA-17.x)

### CA-17.1 — Boot sem erro
✅ **Confirmado:** Edge Function compila (build passou, module graph sem problemas de assinatura de método).

### CA-17.2 — Interface implementada em ambos adapters
✅ **Confirmado:** 
- `EvolutionAdapter` declara `getConnectionState(instanceName: string): Promise<ConnectionStateResult>` (linha 57).
- `MockEvolutionAdapter.getConnectionState` (linha 301-306): retorna `{ state: "open" }`.
- `RealEvolutionAdapter.getConnectionState` (linha 430-461): implementado com `evolutionFetch` + validação.

### CA-17.3 — Contrato correto
✅ **Confirmado:**
- `checkInputSchema` (linha 24-28): `{ action: z.literal("check") }` apenas.
- Inclusão em `requestSchema` (linha 52-56): union discriminada por `action`.
- `checkResponseSchema` (linha 83-88): `{ connection_status: connectionStatusSchema, last_connected_at?: string | null }`.
- Tipo `CheckResponse` exportado (linha 89).

### CA-17.4 — Segredos e mock
✅ **Confirmado:**
- Sem `VITE_EVOLUTION` em `supabase/functions/whatsapp/**` (grep negativo).
- `MockEvolutionAdapter.getConnectionState` retorna `{ state: "open" }`.

---

## Validação de Regras de Fronteira (RNF)

### RNF-WA-05 — Dado externo não confiável
✅ **Implementado:**
- `getConnectionState` (linha 448-450): `connectionStateSchema.safeParse(stateRes.body)` antes de ler `instance.state`.
- Falha fora do contrato → `Error("Resposta inválida do servidor de WhatsApp.")` pt-BR, sem vazar corpo cru.
- Log controlado: `console.error("getConnectionState: resposta de estado fora do contrato")` — informativo, sem dados.

### RNF-RE-02 — Segredos em env, nunca no cliente
✅ **Implementado:**
- `EVOLUTION_API_URL`/`EVOLUTION_API_KEY` resolvidas via `Deno.env` (linha 431).
- Sem prefixo `VITE_` (confirmado).
- `credentials()` chamado no ponto de uso, validado com `resolveEvolutionCredentials`.
- Mensagens de erro controladas, nunca ecoam a chave.

### RNF03 — Isolamento multi-tenant por JWT
✅ **Implementado:**
- `checkInputSchema` não aceita `tenant_id` no corpo.
- Comentário explícito: "tenant_id derivado do JWT, nunca do cliente" (linha 27).
- A porta é pura: não resolve tenant, não toca banco (consumidor ADR-18 faz a reconciliação).

### RNF-RE-04 — Porta pura (sem banco, sem tenant)
✅ **Implementado:**
- `getConnectionState` não lê/escreve `whatsapp_instances`.
- Comentário jsdoc confirma (linha 428): "não toca o banco, não resolve tenant".

---

## Validação de Padrões de Código

### TypeScript estrito (convencoes-codigo)
✅ **Implementado:**
- `ConnectionStateResult` interface bem-tipada (linha 40-44).
- `EvolutionState = z.infer<typeof evolutionStateSchema>` (linha 227).
- `CheckResponse = z.infer<typeof checkResponseSchema>` (linha 89).
- Sem `any` implícito.

### Reutilização de infra existente
✅ **Implementado:**
- `getConnectionState` reusa `evolutionFetch` (ADR-09) — não recria cliente HTTP, timeout já tratado.
- `getConnectionState` reusa `connectionStateSchema` (já existente).
- Padrão: `const credentials = this.credentials()` alinha com `pair`/`sendText`.

### Comentários e documentação
✅ **Bem-feito:**
- jsdoc na interface (linha 53-57): claro, referencia ADR, explica validação.
- jsdoc na impl Real (linha 420-428): fluxo v2.3.7, referencia R6/AC-06, R8/R9, timeout da ADR-09.
- Comentários em pt-BR para conceito de domínio, inglês para técnico.

### Mock mantém contrato de demo
✅ **Implementado:**
- `MockEvolutionAdapter.getConnectionState` retorna `{ state: "open" }` (linha 305).
- Simulada latência (linha 304).
- Permite fallback de demo concluir fluxo sem rede/celular (RF-QR-05).

---

## Validação de Contrato de Fio

### CheckInput
✅ Correto: `{ action: "check" }` apenas, alinhado com `PairInput` (só `{ action: "pair" }`).

### CheckResponse
✅ Correto: reusa `connectionStatusSchema` (não cria novo enum), adiciona `last_connected_at` opcional.
✅ Alinhado com `PairResponse` (mesmo padrão: status + timestamp).

### Tipos exportados
✅ `CheckInput` (linha 64), `CheckResponse` (linha 89) — prontos para consumidor (ADR-19).

---

## Observações Técnicas

1. **Ordem de variantes em union:** `pairInputSchema`, `sendInputSchema`, `checkInputSchema` (linha 52-56). Ordem não importa em `discriminatedUnion` (discrimina por `action`). ✅

2. **Estado normalizado:** A impl extrai corretamente `parsed.data.instance.state` (linha 450), não retorna corpo bruto. ✅

3. **Erro de comunicação:** Timeout/rede já tratados por `evolutionFetch` (fallback pt-BR). ✅

4. **Logging:** Controlado — status numérico e categoria, sem corpo, sem PII, sem API key. ✅

5. **Sem regressão:** Nenhuma migration modificada, nenhum arquivo existente alterado além dos dois descritos. ✅

---

## Conclusão

✅ **APROVADO**

A ADR-17 implementa corretamente a porta `getConnectionState` e o contrato da action `check`. Todos os critérios de aceite foram atendidos, regras de fronteira (segurança, isolamento multi-tenant, sigilo de credenciais) estão em lugar, e o padrão de código segue as convenções do projeto. O código é seguro para revisar isoladamente e fornece uma base estável para ADR-18 (handlers) e ADR-19 (frontend) dependerem.

Nenhuma questão bloqueante. Pronto para merge.
