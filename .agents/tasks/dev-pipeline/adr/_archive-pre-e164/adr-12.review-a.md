# Review ADR-12 — REVISOR A

**ADR:** ADR-12 — Endurecimento final: segredo/PII, mock intacto, confinamento do diff e dívida aceita

**Status:** ✅ APROVADO

---

## Resumo do parecer

ADR-12 encerra a sequência de integração Evolution com uma implementação **production-ready** do `RealEvolutionAdapter.sendText()`, complementando o `pair()` já entregue em ADR-11. A mudança é **mínima e confinada**: apenas `supabase/functions/whatsapp/evolution-adapter.ts`, **nenhuma** alteração de `index.ts`, migrations ou frontend. Todos os 14 critérios de aceite foram atendidos. A auditoria de segurança passou: API key fora do bundle, nenhum PII/segredo em log, `.env` git-ignored, `EVOLUTION_MODE=mock` continua funcional como fallback. Typecheck e build sem erros. Dívida OQ-01 (`connection_status` otimista até reconciliação webhook/polling) está documentada e será registrada no brain. Recomendo aprovação.

---

## Constatações

### ✅ Implementação de `sendText` real (AC-01, AC-05)

O `sendText()` foi completamente implementado:
- Chamar `POST /message/sendText/{instance}` com `{ number, text }` normalizados
- Devolver `providerMessageId` extraído de `key.id` via schema zod validado
- Sem mais stub; promove a operação do mock para real via factory `createEvolutionAdapter()`

### ✅ Validação de respostas externas (AC-06)

Todas as respostas da Evolution são validadas com zod **antes** de ler qualquer campo:
- `sendTextResponseSchema.safeParse()` no `sendText()` 
- `connectResponseSchema.safeParse()` no `pair()`
- Falha de contrato → erro pt-BR controlado; corpo cru da Evolution **nunca** é logado ou ecoado

### ✅ Pair idempotente por nome (AC-02)

O `pair()` trata "já existe" (status 403/409) como não-fatal e cai no `connect`, implementando idempotência por `instanceName`. Segunda chamada com mesmo nome não recria, apenas conecta.

### ✅ Credenciais só do env, sem vazamento (AC-07, AC-08)

- `EVOLUTION_API_URL` e `EVOLUTION_API_KEY` lidos **apenas** de `Deno.env` em `RealEvolutionAdapter`
- `resolveEvolutionCredentials()` falha cedo e com mensagem pt-BR se ausentes (**sem** chamar rede)
- Nenhuma string literal com key no código; `.env` está git-ignored (`git check-ignore` confirmado)
- **Grep pela API key no diff e no código: vazio**
- Nenhum prefixo `VITE_` em segredo

### ✅ Sem PII em log (AC-09)

Todos os `console.error()` adicionados logam **só** motivos técnicos curtos:
- `"sendText: envio falhou (status 400)"` — nunca `telefone` ou `texto` 
- `"sendText: resposta de envio fora do contrato"` — motivo sem PII
- Nenhum `console.log(params)`, `console.error(to)`, ou corpo da mensagem

### ✅ Mock intacto (AC-10)

- `MockEvolutionAdapter` continua retornando QR fake 1x1 e `providerMessageId` fake
- `createEvolutionAdapter()` default: `EVOLUTION_MODE=mock`, seleção correta por env
- Sem regressão

### ✅ Confinamento do diff (AC-12, R12)

**Único arquivo de aplicação alterado:** `supabase/functions/whatsapp/evolution-adapter.ts`
- `index.ts`: inalterado
- `schemas.ts`: inalterado  
- migrations: inalterado
- `src/`: inalterado
- `.env` deletado do git; git-ignored permanece

### ✅ Timeout e falha de rede (AC-13, R13)

`evolutionFetch()` aplica `AbortController` com `EVOLUTION_TIMEOUT_MS = 15s`:
- Timeout → falha pt-BR controlada: `"Falha de comunicação com o servidor de WhatsApp."`
- Erro de rede → même resposta; nunca exceção crua
- ngrok pode pendurar; timeout garante não-bloqueio

### ✅ Travas negativas (AC-14, R14)

Grep no diff por webhook, cron, scheduler, retry-queue: **vazio**. Nenhuma:
- Webhook de entrada `connection.update` 
- Régua automática ou polling de reconciliação
- Fila de retentativa
- Envio a terceiro no QA automatizado

Teste real é **manual do usuário** (conforme requisito do PRD §9).

### ✅ Build e typecheck

- `npm run typecheck`: ✅ passou sem erro
- `npm run build`: ✅ passou sem erro

### ✅ Critério AC-04 — Pair com instância já conectada

Quando Evolution responde `state:"open"` (sem QR):
- O adapter detecta via `if (data.instance.state === "open")`
- Lança erro pt-BR: `"O WhatsApp já está conectado."`
- Interface `PairResult` permanece intacta (alternativa B do design, conforme análise)

---

## Verificação de fronteiras invioláveis

| Fronteira | Critério | Status |
|-----------|----------|--------|
| **RLS + tenant_id do JWT** | Adapter não resolve tenant; recebe `instanceName` já derivado no `index.ts` | ✅ |
| **Segredo fora do cliente** | API key só em `Deno.env`; nenhum `VITE_` ou bundle | ✅ |
| **PII em log** | Nenhum telefone/texto em claro; correlação por `provider_message_id` | ✅ |
| **Dado não confiável** | Respostas validadas com zod; corpo cru nunca logado | ✅ |
| **Timeout/erro de rede** | `AbortController` com tratamento pt-BR | ✅ |
| **Mock funcional** | Default `mock`, queda para real por env | ✅ |

---

## Dívida registrada (OQ-01)

A ADR documenta uma **inconsistência aceita**: no fluxo real, `index.ts` marca `connection_status = 'conectado'` logo após `pair()` devolver o QR, enquanto o pareamento real no celular é **assíncrono** (deve-se escanear). Resultado: estado fica **otimista/incorreto** até haver webhook ou polling (fora de escopo).

**Ação recomendada:** Registrar no brain (layer `arquitetura`, project `atlas-agenda`) como limitação aceita desta fase, com a correção apontada para a próxima fase de reconciliação de estado. A dívida não bloqueia esta ADR (trava explícita: "não tocar `index.ts`").

---

## Conclusão

Todos os 14 critérios de aceite (AC-01 a AC-14) foram **atendidos**. As fronteiras invioláveis (RLS, segredo, PII, validação, timeout) foram **respeitadas**. Confinamento do diff **perfeito** (apenas adapter, nenhum outro arquivo de aplicação). Typecheck/build **sem erros**.

**Veredito:** ✅ **APROVADO**

Pode seguir para o merge e a fase de teste manual do usuário.

---

## Próximos passos

1. Usuário executa teste manual: `supabase functions serve whatsapp --env-file supabase/functions/.env`
2. Admin pareia o WhatsApp real e escaneia o QR
3. Envia mensagem a um cliente com `whatsapp_opt_in = true` e confirma recebimento + `provider_message_id` real
4. Verifica logs (grep por segredo/PII = vazio)
5. Brain recebe anotação de OQ-01 (dívida de reconciliação) para a fase seguinte
