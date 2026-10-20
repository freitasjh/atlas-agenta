# ADR-10 — `pair` real: criar/conectar instância idempotente e devolver QR base64

**Status:** proposto

## Contexto

Com a fundação da ADR-09 pronta (cliente HTTP com `apikey`+timeout, schemas zod de
connect/connectionState/create, resolução de credenciais do env), esta ADR troca o stub de
`RealEvolutionAdapter.pair` pela chamada **real** à Evolution. O `index.ts` chama
`adapter.pair(instanceName)` com `instanceName = tenant-<tenant_id>` (derivado do JWT no
servidor — o adapter **não** resolve tenant, **não** aceita `tenant_id` de parâmetro, **não**
toca o banco; RNF-RE-04). O `index.ts` persiste o estado e **não muda** (R12).

Contrato v2.3.7 (análise §5, verificado por probe read-only):
- **Criar:** `POST /instance/create` com `{ instanceName, integration: "WHATSAPP-BAILEYS",
  qrcode: true }`. "Já existe" → erro ~403/409 "name already in use" → **não-fatal**, cair no
  conectar (idempotência por nome = fronteira de tenant).
- **Conectar/QR:** `GET /instance/connect/{instance}` — conectada (`state:"open"`) vem **sem**
  QR; aguardando pareamento traz `{ base64, code, pairingCode, count }` (`base64` normalmente já
  é data URL; se vier puro, prefixar `data:image/png;base64,`).
- **Estado:** `GET /instance/connectionState/{instance}` → `{ instance: { instanceName, state } }`.

Decisão de design a confirmar (D-05 / análise §7 / R4): o `PairResult` só tem `qrCodeBase64`
(string). Quando a instância já está conectada (`state:"open"`, sem QR), **não** há QR a
devolver e estender a interface feriria a trava "não mudar a interface".

## Decisão

Implementar `RealEvolutionAdapter.pair(instanceName)` no mesmo módulo, usando os helpers da
ADR-09:

1. Resolver credenciais do env (helper ADR-09); ausentes → falha pt-BR sem rede (R7).
2. **Criar a instância** via `POST /instance/create` com o corpo v2.3.7. Tratar resposta de
   "já existe" (403/409 "name already in use") como **não-fatal** e seguir para conectar —
   idempotência por nome de instância (R2/AC-02). Qualquer outro erro de criação vira falha
   pt-BR controlada.
3. **Conectar / obter QR** via `GET /instance/connect/{instance}`, validando a resposta com o
   schema de união da ADR-09:
   - **Aguardando pareamento** (traz `base64`): devolver `PairResult { qrCodeBase64 }` como
     **data URL** renderizável em `<img>` — se o `base64` já vier como data URL, repassar; se
     vier puro, prefixar `data:image/png;base64,`. O QR **não** é persistido em banco nem logado
     (R3/AC-03).
   - **Já conectada** (`state:"open"`, sem QR) → **confirmar D-05 opção (b)**: lançar `Error`
     com mensagem pt-BR clara (ex.: `"O WhatsApp já está conectado."`). O `index.ts` já captura
     exceção de `pair()` no `catch` e devolve 502 com corpo pt-BR — comportamento definido, sem
     exceção crua, **sem** alterar a interface `PairResult` (R4/AC-04). Esta ADR **confirma**
     a opção (b) recomendada pela análise.
4. Timeout/erro de rede (ngrok) → falha pt-BR controlada (helper ADR-09), não exceção não
   tratada (R13/AC-13).
5. PII/segredo: nunca logar o corpo cru da Evolution (há `token` em respostas correlatas), nunca
   logar/ecoar a API key (R8/R9). O QR não entra em log.

**Dívida conhecida (OQ-01) a registrar, não corrigir aqui:** o `index.ts`, logo após
`pair()` devolver o QR, marca `connection_status = 'conectado'` + `last_connected_at`. No fluxo
real o pareamento é **assíncrono** (o QR ainda precisa ser escaneado), então o estado fica
otimista/incorreto até haver webhook/polling — **fora de escopo** (não tocar `index.ts`). O
registro formal dessa dívida é consolidado na ADR-12.

## Consequências

- **Escopo:** dados (backend). Sem frontend (a UI já renderiza `data:image/png;base64,...`).
- **Arquivos afetados:** `supabase/functions/whatsapp/evolution-adapter.ts` (único). `index.ts`,
  `schemas.ts`, migrations e UI inalterados.
- **Positivo:** o admin do tenant passa a receber um QR **real** legível em `/app/config/whatsapp`
  (AV-02), substituindo o PNG 1x1 fake do mock. Idempotência por nome evita recriar instância.
- **Negativo/risco:** divergência de `connection_status` (OQ-01) fica otimista no fluxo real até
  a fase de reconciliação; registrado como dívida aceita (ADR-12). Instância "já conectada"
  resulta em erro pt-BR (502) em vez de QR — comportamento intencional (D-05 opção b).
- **Dependência:** **ADR-09** (cliente HTTP, schemas de connect/create/connectionState,
  resolução de credenciais). Independente da ADR-11 (`sendText`), mas ordenada antes dela por
  coerência de fluxo (parear antes de enviar).

### Critérios de aceite testáveis (desta ADR)

1. `RealEvolutionAdapter.pair` **não** lança mais "Integração real da Evolution não implementada
   nesta fase."; executa chamada HTTP real (R1/AC-01; grep da string no `pair` = vazio).
2. 1ª chamada de `pair` com nome novo cria a instância (`POST /instance/create`); 2ª chamada com
   o mesmo nome **não** recria (trata "já existe") e conecta (R2/AC-02 — verificável pelo usuário
   via `GET /instance/fetchInstances`).
3. Para instância aguardando pareamento, `pair` retorna `{ qrCodeBase64 }` como data URL
   (`data:image/png;base64,...`); o QR não aparece em nenhuma coluna de banco nem em log
   (R3/AC-03).
4. Com `state:"open"` (sem QR), `pair` lança erro pt-BR claro capturado pelo `index.ts` (502),
   sem exceção crua e sem alterar `PairResult` (R4/AC-04).
5. Falha de rede/timeout da Evolution vira falha pt-BR controlada, a function não derruba o
   request (R13/AC-13).
6. `supabase functions serve whatsapp --env-file supabase/functions/.env` sobe sem erro de
   boot/typecheck (R11/AC-11); `git diff --name-only` = só o adapter (R12/AC-12).
7. `grep` pela API key no código/diff = vazio; nenhum corpo cru da Evolution logado (R8/R9).
