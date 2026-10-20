# Revisão REVISOR A — ADR-10

**Status:** ✅ **APROVADA SEM RESSALVAS**

---

## Sumário Executivo

A ADR-10 implementa o `pair` real da Evolution API, substituindo o stub por chamadas HTTP reais a criar/conectar instâncias e devolver QR base64. A implementação respeita todas as fronteiras de segurança (credenciais no servidor, nunca no cliente), idempotência por nome de instância, validação de dados externos, e mensagens de erro em pt-BR. O mock permanece intacto.

**Resultado da contraprova:**
- ✓ `npm run build` — sucesso (0 erros)
- ✓ `npm run typecheck` — sucesso (TypeScript estrito)
- ✓ Arquivo único modificado: `supabase/functions/whatsapp/evolution-adapter.ts`
- ✓ Todos os 9 critérios de aceite verificados

---

## Detalhes da Revisão

### Funcionamento da Implementação

O `RealEvolutionAdapter.pair(instanceName)` segue o fluxo especificado:

1. **Resolver credenciais** → lidas de `Deno.env` pelo `createEvolutionAdapter`, falha pt-BR cedo se ausentes (R7).
2. **POST /instance/create** com `{ instanceName, integration: "WHATSAPP-BAILEYS", qrcode: true }` → "já existe" (403/409) não-fatal, cai no conectar (idempotência).
3. **GET /instance/connect/{instance}** → resposta validada com zod:
   - `base64` presente → devolver QR como data URL (renderizável em `<img>`)
   - `state:"open"` → erro pt-BR "já conectado" (D-05 opção b, interface intacta)
   - `state:"connecting"|"close"` → erro genérico pt-BR
4. **Erros de rede/timeout** → convertidos em erro pt-BR "Falha de comunicação..." (nunca exceção crua)

O `sendText` permanece stub até ADR-11, conforme intenção.

### Segurança & Multi-Tenancy

- ✓ `instanceName = tenant-${tenantId}` derivado do JWT no servidor; adapter não resolve tenant nem toca banco
- ✓ `encodeURIComponent(instanceName)` protege o path contra injeção de caminho
- ✓ Credenciais (`EVOLUTION_API_URL`, `EVOLUTION_API_KEY`) não têm prefixo `VITE_` — vivem só no servidor
- ✓ Nenhum `VITE_*` referência a Evolution em todo o codebase
- ✓ API key nunca logada; corpo cru da Evolution nunca ecoado em logs/respostas
- ✓ QR não é persistido no banco — devolvido só na resposta HTTP

### Idempotência & Validação

- ✓ "Já existe" detectado por `isAlreadyExistsStatus(403 | 409)` e tratado como não-fatal
- ✓ `connectResponseSchema.safeParse()` valida a resposta antes de usar (dados não confiáveis)
- ✓ Parse falha → erro pt-BR "Resposta inválida..." (nunca vaza corpo)
- ✓ Union schema discrimina por `"base64" in data` vs `data.instance.state` — funciona

### Tratamento de Erro

- ✓ Timeout/erro de rede capturados em `evolutionFetch`, convertidos em `Error("Falha de comunicação...")` pt-BR
- ✓ `AbortController` com timeout (15s) aplicado a todas as chamadas HTTP
- ✓ `index.ts` captura exceção de `pair()` com try/catch, retorna 502 com mensagem pt-BR
- ✓ Nenhuma exceção crua exposta ao cliente

### Interface & Contrato

- ✓ `PairResult` interface **não alterada** — só `qrCodeBase64: string`
- ✓ Quando já conectada (`state:"open"`), lança erro pt-BR em vez de estender interface (D-05 opção b)
- ✓ Contrato estável para ADR-11 (sendText) e frontend

### Integridade & Escopo

- ✓ `MockEvolutionAdapter` — intacto (comentários updated, implementação inalterada)
- ✓ Apenas `evolution-adapter.ts` modificado (git diff —name-only = 1 arquivo)
- ✓ Schemas zod (ADR-09) reutilizados sem alteração
- ✓ Helpers puros (`isAlreadyExistsStatus`, `toQrDataUrl`) são funções exportadas testáveis isoladamente

---

## Critérios de Aceite (Checklist)

| AC# | Critério | Status | Nota |
|-----|----------|--------|------|
| AC-01 | `pair` executa HTTP real, não lança "não implementada" | ✓ | Implementação completa |
| AC-02 | Idempotência por nome; "já existe" (403/409) não-fatal | ✓ | `isAlreadyExistsStatus` detecta, fluxo cai no conectar |
| AC-03 | QR retorna como data URL; nunca persistido | ✓ | `toQrDataUrl` garante; só na resposta HTTP |
| AC-04 | `state:"open"` → erro pt-BR, interface intacta | ✓ | Lança `Error("O WhatsApp já está conectado.")` |
| AC-05/R13 | Timeout/rede → erro pt-BR, nunca crua | ✓ | `evolutionFetch` trata AbortError e fetch errors |
| AC-06 | Validação zod de resposta (conectState/QR) | ✓ | `connectResponseSchema.safeParse()` |
| AC-07/R8/R9 | API key não no código, corpo não logado | ✓ | Grep vazio; logs só status + nome genérico |
| AC-11 | Build/typecheck sem erro | ✓ | `npm run build` sucesso, `npm run typecheck` OK |
| AC-12 | Apenas adapter modificado | ✓ | git diff —name-only = 1 arquivo |

---

## Riscos Considerados & Aceitáveis

1. **Dívida OQ-01:** State otimista em `index.ts` — `connection_status = "conectado"` logo após `pair()`, quando na realidade pareamento é assíncrono. **Aceito:** não tocar `index.ts` (fora de escopo ADR-10), consolidado em ADR-12. ✓

2. **Timeout estático 15s:** `EVOLUTION_TIMEOUT_MS = 15_000` fixo. Para ngrok pode pendurar. **Aceito:** razoável para a fase; configurabilidade futura se infra mudar. ✓

3. **Estados transitórios (`connecting`/`close`):** Se sem QR, erro genérico. **Aceito:** comportamento intencional, mensagem pt-BR clara o suficiente. ✓

---

## Não Encontrado (Escopo Confirmado Fora)

- Webhook de pagamento (ADR-14)
- Retry/queue de mensagens falhas (ADR-11+)
- Polling/reconciliação de estado (ADR-12)
- Frontend (UI já renderiza `data:image/...`)
- Changes em `index.ts`, `schemas.ts`, banco ou migrations

---

## Conclusão

**Parecer: APROVADA**

A implementação de ADR-10 está bem executada, segura, idempotente e pronta para fusão. Todos os critérios de aceite foram verificados. Nenhuma ressalva bloqueante.

Próximo passo: ADR-11 (sendText real).
