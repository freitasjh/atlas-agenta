# fix(whatsapp): normaliza telefone para E.164-BR (DDI 55) no cadastro e antes da Evolution

**Branch:** `fix/e164-br-ddi-whatsapp` → base `feat/precos-cadastro-plan-intent`
**Entrega:** local-only (sem remote/forge neste ambiente — PR real pendente de `git remote add`).

## Resumo

Corrige o `send_failed`/HTTP 400 do envio de WhatsApp: o número chegava à Evolution
sem o DDI `55` (ex.: legado `47992391751`). A normalização E.164-BR passa a acontecer
nas duas pontas, com a mesma regra:

- **Borda do servidor (A):** `normalizePhoneForEvolution`/`applyBrDdi` em
  `supabase/functions/whatsapp/evolution-adapter.ts` prefixa `55` a números nacionais de
  10/11 dígitos (fronteira por **comprimento**, não por prefixo) antes do `sendText`,
  cobrindo registros legados sem DDI. Idempotente para 12/13 dígitos já com `55`. Defesa em
  profundidade: não lança — a Evolution recusa inválido. Nunca loga o número.
- **Cadastro de cliente (B):** `toE164BR` em `src/lib/phone.ts`, consumido pelo
  `customerSchema` (zod), grava o telefone normalizado em `+55...`; comprimento inválido é
  rejeitado com erro em pt-BR no submit. Copy do campo explicita o `+55`.
- Regra única espelhada nas duas pontas (sem implementações divergentes).
- Script de dev `scripts/dev-functions.sh` (+ `npm run dev:functions`) para subir as Edge
  Functions localmente.

## ADRs entregues

- **adr-01** — Regra de normalização E.164-BR na borda do servidor (dona da especificação)
- **adr-02** — Normalização E.164-BR no cadastro/edição de cliente (schema zod)
- **adr-03** — Script de desenvolvimento para subir as Edge Functions localmente
- **adr-04** — Verificação ponta-a-ponta em modo real e fechamento do bugfix

## O que foi testado

- `npm run build` (tsc -b && vite build): **limpo** (único aviso é chunk >500kB, pré-existente).
- **Prova unitária determinística** (harness tsx, 16/16 asserts): importou o `toE164BR` real e
  replicou verbatim o `applyBrDdi` do servidor. Caso do usuário `47992391751` → servidor
  `5547992391751`, cadastro `+5547992391751`. Cobre idempotência, fixo 10 díg, DDD 55/RS por
  comprimento, inválidos → `null` no cadastro / cru na borda, e concordância entre as pontas.
- Auditoria de fonte: sem log de telefone/texto em claro; `tenant_id` vem do JWT/profiles
  (`resolveIdentity`) + `.eq('tenant_id')`, nunca do cliente; sem migration/RLS/dependência nova.
- Segredos: `supabase/functions/.env` confirmado gitignorado; só `.env.example` versionado.

## Itens pendentes

- **QA ao vivo via chrome-devtools PENDENTE:** a ferramenta MCP chrome-devtools não está exposta
  neste step de entrega, não há `functions serve` ativo (probe retornou 503, mesmo erro original)
  e o reenvio real em `EVOLUTION_MODE=real` exige Evolution via ngrok + instância conectada + JWT
  admin interativo. A prova visual no `/app/clientes` (cadastro grava `+5547992391751`; lista
  exibe `+55 (47) 99239-1751`; edição de legado normaliza; telefone inválido bloqueia submit com
  erro pt-BR e foco acessível) e o `outcome: "sent"` ponta-a-ponta ficam registrados em
  `adr/index.json` → `qaPending: ["adr-04"]`. A lógica central está provada por build + unit harness.
- **Publicação do PR** depende de o usuário conectar um remote.
