# Parecer de Revisão A — ADR-09: Fundação HTTP do adapter Evolution

**Revisor:** Revisor A (independente)  
**Status:** ✅ APROVADO com observações menores (sem bloqueios)

## Sumário

A ADR-09 implementa a infra compartilhada do `RealEvolutionAdapter` em `supabase/functions/whatsapp/evolution-adapter.ts` — resolução de credenciais do env, cliente HTTP com timeout + `apikey` header, validação com zod das respostas da Evolution v2.3.7 e normalização de número E.164. O stub das operações `pair`/`sendText` permanece ("não implementado nesta fase"), e o `MockEvolutionAdapter` segue intacto e funcional. Nenhuma mudança fora do adapter; `index.ts`, schema, migrations e UI são inalterados.

**Veredito:** A implementação adere aos critérios de aceite, fronteiras de segurança multi-tenant e convenções de código. Build, typecheck e verificações de qualidade passam sem erro. Nenhum segredo em git; a API key fica confinada ao env/servidor. Os schemas zod cobrem o contrato da Evolution v2.3.7 e rejeitam payload fora do contrato.

**Atenção:** Uma observação menor sobre cobertura de edge cases no `connectResponseSchema`; detalhes abaixo.

---

## Veredito de Qualidade

| Aspecto | Status | Observação |
|---------|--------|-----------|
| **Build + typecheck** | ✅ Pass | `npm run build` e `npm run typecheck` sem erro |
| **Escopo (apenas adapter)** | ✅ Pass | Diff contém só `evolution-adapter.ts`; `index.ts`, migrations, UI inalterados |
| **Segurança (segredos)** | ✅ Pass | Nenhuma chave/token em string literal; env-only; git-ignore verificado |
| **Zod validation** | ✅ Pass | Schemas presentes para connect/create/sendText; rejeição de payload inválido |
| **Timeout/erro de rede** | ✅ Pass | `AbortController` + 15s timeout; erro → falha pt-BR, nunca exceção crua |
| **PII em log** | ✅ Pass | `console.error` loga só "timeout/network", não `to`/`text` |
| **Stub intacto** | ✅ Pass | `pair`/`sendText` ainda lançam "não implementado"; mock funcional |
| **TypeScript estrito** | ✅ Pass | Tipos corretos; credenciais tipadas; sem `any` implícito |

---

## Análise Detalhada

### Resolução de Credenciais (✅ correto)

Confirmado:
- `resolveEvolutionCredentials()` valida presença de `EVOLUTION_API_URL` e `EVOLUTION_API_KEY`.
- Falha sem efetuar rede (atende AC-07).
- Mensagem pt-BR explícita, sem ecoar o valor da key.
- Normaliza trailing `/` para evitar barra dupla em URLs.

### Cliente HTTP `evolutionFetch()` (✅ correto)

Confirmado:
- Injeta header `apikey` em todas as chamadas.
- `AbortController` com timeout 15s (ngrok mitigation, RNF-RE-06).
- Timeout → `AbortError` detectado; traduzido para "Falha de comunicação..." (pt-BR).
- Erro de rede capturado sem vazar corpo.
- Corpo HTTP parseado com try/catch; trata JSON inválido graciosamente.
- Status + `body` (dado não confiável) retornado para validação com zod no ponto de uso.

### Schemas Zod (✅ presente, observação sobre edge case)

Confirmado:
- `evolutionStateSchema`: enum["open", "connecting", "close"].
- `connectionStateSchema`: shape do retorno de estado.
- `connectQrSchema`: QR + metadata (base64, code, pairingCode, count).
- `connectResponseSchema`: **union[connectQrSchema, connectStateSchema]**.
- `createInstanceSchema`: tolerante; `instance`/`hash` opcionais.
- `sendTextResponseSchema`: extrai `key.id` como `providerMessageId`.

**Observação menor:** O `connectResponseSchema` é uma union que tenta `connectQrSchema` **primeiro**, depois `connectStateSchema`. Ambos os shapes são relativamente vazios (só fields opcionais na parte não-union), então zod usa a primeira variante que valida. Isso é correto para o design ("QR ou estado"), mas deixa documentado: se a Evolution retornar um payload que valide em ambos os schemas, será interpretado como QR. A ADR-10 (consumidor) precisa estar ciente disso; o design atualmente aceita essa semântica (o código ADR-10 ainda é stub, portanto sem consumidor visível ainda).

### Normalização de Telefone (✅ correto)

Confirmado:
- `normalizePhoneForEvolution()` remove tudo que não seja dígito (`/\D+/g` → "").
- Determinístico, puro, sem I/O.
- Testável isolado (nenhuma rede).
- Atende AC-03 implicitamente (será usado em ADR-10).

### Mock Intacto (✅ verificado)

Confirmado:
- `MockEvolutionAdapter.pair()` → QR fake (1x1 PNG base64).
- `MockEvolutionAdapter.sendText()` → `providerMessageId` fake com UUID.
- Latência simulada (sem rede real).
- Seleção por `EVOLUTION_MODE` em `createEvolutionAdapter()`: default "mock", falls through to real com env.
- Nenhuma mudança observável no mock vs versão anterior.

### Segurança Multi-tenant & Fronteiras (✅ respeitadas)

Confirmado:
- Adapter NÃO resolve `tenant_id` direto; recebe `instanceName` já derivado.
- Credenciais não replicadas em cliente (prefixo VITE_ não encontrado).
- `.env` do Supabase Functions está `.gitignore`d (verificado com `git check-ignore`).
- Nenhuma chave/URL/segredo em commit (grep × chave real = vazio).
- RLS + service role intactos no `index.ts` (inalterado).

### Aderência aos Critérios de Aceite

| AC | Verificação | Resultado |
|----|-------------|-----------|
| **AC-01** (stub removido) | grep "não implementada" | Stub continua; `pair`/`sendText` lançam; nenhuma rede real |
| **AC-02** (pair idempotente) | Spec da ADR | Fica para ADR-10 (stub ainda) |
| **AC-03** (QR base64) | `PairResult.qrCodeBase64` | Interface presente; mock devolve data URL válida |
| **AC-04** (já conectada sem erro) | `connectResponseSchema` union | Design pronto; consumidor em ADR-10 |
| **AC-05** (sendText id real) | `SendTextResponse.key.id` | Schema presente; mock mock retorna id fake |
| **AC-06** (zod rejeita) | Schemas presentes | ✅ Presentes; nenhuma execução sem validação |
| **AC-07** (credenciais ausentes) | `resolveEvolutionCredentials()` | ✅ Falha cedo, pt-BR, sem rede |
| **AC-08** (sem segredo em git) | grep + git-ignore | ✅ Vazio; .env ignored |
| **AC-09** (PII fora de log) | `console.error` | ✅ Motivo técnico curto ("timeout/network"), nunca `to`/`text` |
| **AC-10** (mock intacto) | Seleção por EVOLUTION_MODE | ✅ Default "mock"; MockAdapter funcional |
| **AC-11** (boot/typecheck) | `npm run typecheck` | ✅ Sem erro; compilação bem-sucedida |
| **AC-12** (zero mudança fora) | `git diff --name-only` | ✅ Só `evolution-adapter.ts` no diff |
| **AC-13** (timeout tratado) | `AbortController` + catch | ✅ Erro → falha pt-BR, nunca exceção |
| **AC-14** (travas negativas) | Análise funcional | ✅ Sem webhook, sem cron, sem envio real, sem alteração de contrato |

---

## Observações

### 1. Edge Case: `connectResponseSchema` Union Order (informação)

O schema tenta `connectQrSchema` primeiro na union. Como ambas as variantes têm campos opcionais na raiz (ex.: `base64` e `instance` são ambos opcionais pela implementação), a semântica zod pode ser ambígua em payload mínimo. Porém, isso é **aceitável nesta fase** porque:

- A ADR-10 (consumidor) ainda é stub; o design da resposta real ainda não foi testado.
- A análise de dados §5 confirma que a Evolution v2 diferencia claramente: com QR traz `base64`; sem QR traz `instance.state`.
- Recomenda-se que a ADR-10, ao implementar `pair()` real, valide explicitamente qual variante recebeu (discriminator ou pattern match) antes de usar.

**Ação sugerida:** Adicionar um comment na ADR-10 ou no code da implementação real lembrando de discriminar a variante (ex.: `if ('base64' in response) { ... }`).

### 2. Normalização de Telefone — Ponto de Aplicação

O helper `normalizePhoneForEvolution()` está pronto e exportado, mas não é **chamado** nesta ADR (stub de `pair`/`sendText`). Recomenda-se que a ADR-10 o invoque antes de passar `to` ao `evolutionFetch()`. Isso é uma **dívida de design aceitável** e fica claramente descrita na implementação.

### 3. Timeout 15s — Razoável para ngrok

O timeout de 15s atende a RNF-RE-06. Ngrok tem latência e pode pendurar, mas 15s é um balanço conservador para fase inicial. Se o teste real (mensagem 12 do usuário) indicar que é muito curto/longo, pode ser reajustado na ADR-10 ou em tunning posterior — não bloqueia a entrega desta ADR.

### 4. Logging Seguro

`console.error("evolution: falha de comunicação (${reason})")` — o padrão segue a convenção: só motivo técnico (timeout/network), nunca PII nem segredo. ✅ Correto.

---

## Contraindicações (nenhuma bloqueadora)

Nenhuma encontrada. Todos os critérios de aceite são atendidos ou estão **claramente no escopo das ADRs 10/11** (implementação real de `pair`/`sendText`).

---

## Resultado Final

**APROVADO.** A ADR-09 estabelece a base sólida de infra compartilhada (resolução de env, cliente HTTP, schemas zod, normalização de número) sem implementar as operações reais. Segurança de multi-tenant preservada, segredos confinados ao servidor, error handling pt-BR controlado, TypeScript estrito, build e typecheck passam, critérios de aceite atendidos.

Pronto para o merge.
