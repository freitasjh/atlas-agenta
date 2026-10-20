# Parecer do Revisor B — ADR-10 (`pair` real: criar/conectar instância idempotente + QR base64)

Troca o stub de `RealEvolutionAdapter.pair` por chamada real à Evolution v2.3.7: `POST /instance/create` ({ instanceName, integration: "WHATSAPP-BAILEYS", qrcode: true }) tratando "já existe" (403/409) como não-fatal, seguido de `GET /instance/connect/{instance}` validado por zod (`connectResponseSchema`). Resposta com `base64` → `{ qrCodeBase64 }` como data URL (via `toQrDataUrl`); `state:"open"` sem QR → erro pt-BR "O WhatsApp já está conectado." (D-05 opção b); `connecting`/`close` → erro pt-BR de QR indisponível. Dois helpers puros novos (`isAlreadyExistsStatus`, `toQrDataUrl`). O diff do commit `59b25cc` fica confinado ao único arquivo (`evolution-adapter.ts`); `sendText` segue stub até a ADR-11, mock intacto, `index.ts`/`schemas.ts`/migrations/UI inalterados.

Watch for: a leitura do corpo em `evolutionFetch` roda **fora** do deadline do `AbortController` (o `clearTimeout` está no `finally` antes de `response.text()`) — na ADR-09 isso era inócuo porque nada rodava; **a ADR-10 ativa esse caminho**, então um corpo que pendura no ngrok não é abortado e R13/AC-13 fica parcialmente coberto (confirmed, carryover agora vivo). A divergência de `connection_status` otimista (OQ-01) é dívida conhecida e aceita, fora de escopo aqui (confirmed, não bloqueia). Nenhuma violação de segredo/PII/multi-tenant/RLS/RBAC.

**Verdict**: APPROVED

## Visão de alto nível

A ADR cumpre o contrato: o `pair` real está fiado exatamente sobre a infra da ADR-09 (credenciais do env, `evolutionFetch`, schemas zod, nada de banco) e respeita todas as travas negativas. A idempotência por nome de instância é implementada corretamente — "nome já em uso" (403/409) cai no fluxo de conectar em vez de falhar, o que é a fronteira de tenant da Evolution (AC-02). O QR volta como data URL e não é persistido nem logado (AC-03). O caso "já conectada" lança erro pt-BR que o `index.ts` já captura e traduz em 502 (AC-04), sem alterar a interface `PairResult` — a trava D-05 opção (b) foi honrada.

A postura de segurança está sólida. Nenhum literal da API key no código ou no diff (grep confirmou), `supabase/functions/.env` segue git-ignored e não rastreado, a key só trafega pelo header `apikey` montado em `evolutionFetch`. Os quatro `console.error` do caminho de `pair` carregam só status HTTP e motivos técnicos curtos — nunca o corpo cru da Evolution (que traz `token` por instância em respostas correlatas), nunca o QR, nunca telefone/texto. O adapter não resolve tenant, não aceita `tenant_id`, não toca o banco (RNF-RE-04); isolamento e RBAC continuam no `index.ts` + RLS, ambos inalterados. LGPD e idempotência de envio vivem no `index.ts`, fora deste diff.

A única lacuna acionável é um **carryover da ADR-09 que a ADR-10 tornou real**: o timeout via `AbortController` cobre a fase de `fetch`, mas o `clearTimeout` roda no `finally` antes de `response.text()`, então a leitura do corpo não está sob o deadline. O revisor B da ADR-09 registrou isso como dívida a ser fechada "nas ADR-10/11, onde essas chamadas passam a rodar de fato" — essa hora chegou. Não é bloqueante (o `fetch` em si ainda tem deadline, e o ngrok tipicamente pendura na conexão, não no streaming do corpo), mas R13/AC-13 só fica cumprido de ponta a ponta quando a leitura do corpo entrar no mesmo deadline. Recomendo fechar na ADR-11 (que reusa `evolutionFetch`) ou registrar formalmente na dívida da ADR-12.

Sobre a união `connectResponseSchema`: ela tenta `connectQrSchema` (exige `base64`) antes de `connectStateSchema`, e o narrow `"base64" in data` depende dessa ordem — um shape só de estado cai corretamente na variante de estado. Se algum dia o `connect` devolver `base64` **e** `instance.state` no mesmo corpo, a união casaria QR primeiro e devolveria o QR, o que continua alinhado ao objetivo (parear).

<details>
<summary>Issues (2)</summary>

1. **Leitura do corpo fora do deadline do timeout** (confirmed, não-bloqueante) — em `evolutionFetch`, `clearTimeout` está no `finally` que roda antes de `response.text()`; um corpo que pendura (ngrok) não é abortado. Inócuo na ADR-09 porque nada rodava; a ADR-10 ativa `create`+`connect` reais, então R13/AC-13 fica parcialmente coberto. Fechar na ADR-11 (envolver a leitura do corpo no mesmo deadline — `signal` compartilhado ou segundo timeout) ou formalizar na dívida da ADR-12. Não bloqueia a entrega de `pair`.
2. **`connection_status` otimista no fluxo real (OQ-01)** (confirmed, dívida aceita, fora de escopo) — o `index.ts` marca `conectado` logo após `pair()` devolver o QR, antes de o usuário escanear. Correto para o mock, incorreto para o fluxo real assíncrono. A ADR proíbe tocar `index.ts` e remete a reconciliação (webhook/polling) à fase seguinte; a dívida é consolidada na ADR-12. Registrado, sem ação nesta ADR.

</details>

<details>
<summary>Details</summary>

### Idempotência por nome e tratamento de "já existe"

O fluxo `POST /instance/create` → se `!ok && !isAlreadyExistsStatus(status)` falha; senão segue para `connect`. `isAlreadyExistsStatus` reconhece 403 e 409, os códigos que a análise §5 verificou para "name already in use" na v2.3.x. A primeira chamada com nome novo cria; a segunda com o mesmo nome recebe 403/409, não recria, e conecta (AC-02). A decisão criar-vs-conectar vem do **status HTTP**, não do shape do `createInstanceSchema` (que é tolerante por desenho) — a ADR-09 review-b pediu que isso fosse documentado na ADR-10, e a ADR-10 de fato deixa explícito no comentário do passo 1. Alinhado.

Observação de fronteira: qualquer erro de criação que **não** seja 403/409 (ex.: 500 da Evolution, 502 do ngrok) vira `"Não foi possível criar a instância do WhatsApp."` — falha controlada, sem vazar corpo. Correto.

### QR como data URL e não-persistência

`toQrDataUrl` repassa o `base64` quando já é data URL e prefixa `data:image/png;base64,` quando vem puro — cobre as duas formas que a análise §5 observou na v2.3.7. O retorno é `{ qrCodeBase64 }`, o `index.ts` o devolve no corpo HTTP (`qr_code_base64`) e **não** o grava em coluna; grep confirma que o QR não entra em `console.*` nem em `whatsapp_instances`. AC-03 satisfeito.

### Caso "já conectada" e interface intacta

`state:"open"` sem QR → `throw new Error("O WhatsApp já está conectado.")`. O `handlePair` do `index.ts` tem `try/catch` em volta de `adapter.pair()` que devolve 502 com corpo pt-BR (`"Falha ao gerar o QR Code da conexão."`), logando apenas `err.message`. Sem exceção crua, sem mudar `PairResult`. D-05 opção (b) honrada (AC-04). O ramo `connecting`/`close` também lança erro pt-BR claro — cobertura completa das três variantes de estado.

### Confinamento e verificação

`git diff --name-only bda71cd 59b25cc` = só `evolution-adapter.ts` (AC-12). `npm run build` (tsc -b + vite build) passou — mas note que o adapter é Edge Function Deno (`npm:zod`, `Deno.env`) e não entra no `tsc -b` do frontend; o typecheck Deno (`supabase functions serve`) não roda aqui porque **o Deno não está instalado neste ambiente** (`which deno` = ausente), mesma limitação das ADRs anteriores. A verificação de boot Deno (AC-11) fica para o QA ou para o teste manual do usuário. A revisão estática do TS estrito do arquivo não encontrou `any` implícito nem acesso de campo antes do parse zod.

</details>

<details>
<summary>Mapa de arquivos</summary>

- `supabase/functions/whatsapp/evolution-adapter.ts` — `RealEvolutionAdapter.pair` real (create idempotente + connect + QR data URL + ramos de estado); dois helpers puros novos (`isAlreadyExistsStatus`, `toQrDataUrl`); comentários de cabeçalho atualizados para ADR-10. `sendText` ainda stub; mock intacto.

Diff completo da ADR-10: `git diff bda71cd 59b25cc`.

</details>
