# Review B — ADR-05: Fundação de frontend do módulo WhatsApp

Revisor independente B (modelo distinto do A, sem acesso ao parecer do A). Escopo: commit `658634a`
(`feat: fundação frontend do módulo WhatsApp`), 6 arquivos, +350 linhas. Base de comparação:
árvore anterior ao commit no branch `feat/scaffold-inicial-atlas-agenda`.

A ADR-05 estabelece o vocabulário compartilhado do módulo WhatsApp antes dos hooks (ADR-06) e das
telas (ADR-07/08): enums/tipos de domínio, capacidades RBAC, rótulos pt-BR fonte-única, schema zod
do formulário de envio, mapa de erro defensivo e o `WhatsAppStatusBadge`. É código puro, não toca
banco nem rede. A implementação segue fielmente o que a ADR e o design doc (§3.4) especificaram:
componente-badge irmão (não incha o `StatusBadge`), tokens de status reusados por significado,
literais de domínio num só lugar, erro lido defensivamente sem vazar schema/PII.

Watch for:
- **Roteamento de erro é dependência de ADR-06/08 (confirmed, não-bloqueante):** `mapWhatsAppError`
  trata só o canal infra/auth (401/403); os outcomes de negócio (`send_failed`, `not_connected`,
  `opt_out`, `duplicate`, `sent`) vêm no corpo e passam por `mapSendOutcome`. A divisão está certa,
  mas obriga ADR-06/08 a validar o `{ outcome }` do corpo via zod e extrair o `{ error }` de
  `FunctionsHttpError.context` — não despachar tudo pelo canal de erro do `functions.invoke`.
- **403 de assinatura bloqueada cai no genérico (likely, não-bloqueante):** a function retorna
  `"Os disparos estão suspensos enquanto a assinatura não estiver regularizada."` (403) e o regex
  de `mapWhatsAppError` não casa essa frase, então vira a mensagem genérica. É seguro (PII-free),
  mas perde o motivo real. Decisão de produto para ADR-08, não defeito desta fundação.

**Verdict**: APPROVED

<details>
<summary>Issues (3)</summary>

1. **Mensagem de assinatura bloqueada vira genérica (likely)** — o 403 "disparos suspensos" da
   Edge Function não é reconhecido por `mapWhatsAppError` e cai em `GENERIC_MESSAGE`. Em ADR-08,
   tratar explicitamente esse caso (por outcome/status) para não esconder o motivo de bloqueio do
   usuário. Não-bloqueante nesta ADR.
2. **Extração do corpo de erro do invoke é dependência de ADR-06/08 (confirmed)** — `readErrorText`
   lê `.error`/`.message`, mas `FunctionsHttpError` do supabase-js expõe o corpo só via
   `error.context`. Garantir, nos hooks/ações, que o corpo `{ error, issues? }` chegue a
   `mapWhatsAppError` e que o `{ outcome }` seja validado por zod e roteado a `mapSendOutcome`.
   Fora do escopo de ADR-05; registrar como contrato a honrar.
3. **DTO `Message` omite `dedupe_key` e estreita opcionalidade de `provider_message_id` (possible)**
   — escolha deliberada e PII-safe (`dedupe_key` é chave interna; o cliente não precisa dela). Só
   verificar em ADR-06 que o `select` do histórico não peça `dedupe_key` e que o parser zod da
   linha de `messages` não quebre com `provider_message_id` ausente. Informativo.

</details>

<details>
<summary>Details</summary>

### Aderência ao escopo da ADR

Os 6 arquivos alterados são exatamente os listados em "Arquivos afetados": `src/types/domain.ts` e
`src/hooks/usePermissions.ts` estendidos (não reescritos), e `src/lib/whatsapp.ts`,
`src/lib/validations/whatsapp.ts`, `src/lib/whatsapp-errors.ts`, `src/components/WhatsAppStatusBadge.tsx`
novos. Nenhum arquivo fora de escopo tocado, nenhuma migration, nenhum hook/tela antecipado. Cada
decisão numerada da ADR (1–6) tem contrapartida no código.

### Fidelidade de enums ao contrato real (ADR-02/03/04)

Os três enums em `domain.ts` batem caractere a caractere com as fontes a montante:
`WHATSAPP_CONNECTION_STATUSES` = `connectionStatusSchema` da function e o `check` de
`whatsapp_instances`; `MESSAGE_STATUSES` = `messageStatusSchema` e o `check (status in …)` da
migration `messages`; `MESSAGE_TEMPLATES` = `templateSchema` e o `check (template in …)`. Os DTOs
`SendRequest`/`SendResponse`/`PairResponse` em `whatsapp.ts` espelham `schemas.ts` (camelCase no
payload de `send`, `snake_case` nas respostas). O `SendOutcome` cobre os cinco estados do
`sendOutcomeSchema`. Divergência mínima e benigna: `provider_message_id` é `.nullable().optional()`
no schema de fio e `string | null` (sem `optional`) no DTO — a function sempre inclui o campo, então
o DTO mais estreito não quebra; vale alinhar se um dia a function parar de emiti-lo.

### Fronteiras multi-tenant / RLS / segredos / PII / RBAC

Os DTOs de request não têm `tenant_id` (o servidor ignora qualquer `tenant_id` forjado — comentado
no código). Nenhum segredo aparece: `evolution_instance_name` é nome lógico derivado do tenant, sem
credencial; `WhatsAppInstance` não expõe QR/token. `Message` omite telefone/documento e `payload` é
`Record<string, unknown>` de metadados. `whatsapp-errors.ts` lê `error`/`message` com guardas de
tipo, fallback pt-BR e sem `console`/PII — espelho de `scheduling-errors.ts`. As capacidades RBAC
(`canManageWhatsAppConnection = isAdmin`; `canSendWhatsAppMessage` = os três papéis operacionais)
casam com a autorização da function (`handlePair` exige `admin`; `handleSend` aceita os três) e com
a policy de SELECT de `messages`; documentadas como esconder-botão, com a trava real no RLS/servidor.

### `WhatsAppStatusBadge` — segue o design doc §3.4

Componente irmão do `StatusBadge`, decisão explícita do design doc para não empilhar uma 3ª/4ª
união de type-narrowing num componente já consumido por Agenda/Clientes/assinatura. Mesma casca
(`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium`), mesmo discriminador
por presença de prop (`connectionStatus` vs `messageStatus`), rótulos vindos de `whatsapp.ts`
(fonte única), e o mapa de tokens bate com §3.4: conexão `conectado→confirmado`,
`aguardando_qr→pendente`, `desconectado→cancelado`; mensagem `enviado/entregue→confirmado`,
`fila→pendente`, `falha→cancelado`. Os tokens `status-*` existem em `index.css`/`tailwind.config.ts`
— nenhum token novo. Cor + texto presentes (cor não é o único sinal). A recálculo de contraste AA
em dark/light é, por §3.4, trabalho do QA.

### Critérios de aceite da ADR

- **A1** (build/typecheck limpos, sem `any`): `npm run typecheck` e `npm run build` rodaram limpos
  (0 erros). `grep` de `\bany\b` nos 6 arquivos: nenhum. O aviso de chunk > 500 kB do bundle é
  pré-existente (bundle monolítico do app) e não é introduzido por estes módulos puros.
- **A2** (capacidades expostas): confirmado por inspeção e typecheck.
- **A3** (badge com rótulo pt-BR por estado, tokens existentes): confirmado — ver §badge acima.
- **A4** (sem literal de template/status duplicado): `grep` de `"aguardando_qr"|"lembrete_d1"|
  "comprovante"` só retorna `domain.ts` (enum fonte) e `whatsapp.ts` (mapa de rótulo chaveado pelo
  tipo — não é literal solto). Nenhuma duplicata fora do par permitido.
- **A5** (mapa de erro sem schema/PII, fallback genérico): confirmado — `whatsapp-errors.ts`
  espelha `scheduling-errors.ts`, sem vazamento.

### Contraprova executada

`npm run typecheck` → ok. `npm run build` → `✓ built in ~7.7s`, 0 erros de tipo. Não existem
scripts de lint/test no `package.json` (só `dev/build/typecheck/preview`), então não há suíte
adicional a rodar. Dev server **não** foi subido (verificação visual via Chrome DevTools é do QA,
step seguinte).

### Arquivos

- `src/types/domain.ts` — +enums `WHATSAPP_CONNECTION_STATUSES`/`MESSAGE_STATUSES`/
  `MESSAGE_TEMPLATES` + tipos derivados + interfaces `WhatsAppInstance`/`Message` (PII-safe).
- `src/hooks/usePermissions.ts` — +`canManageWhatsAppConnection`/`canSendWhatsAppMessage`.
- `src/lib/whatsapp.ts` — rótulos pt-BR fonte-única, chaves de query, DTOs do contrato.
- `src/lib/validations/whatsapp.ts` — schema zod `sendMessageSchema` (resolver de ADR-08).
- `src/lib/whatsapp-errors.ts` — `mapSendOutcome`/`isSendSuccess`/`mapWhatsAppError` defensivos.
- `src/components/WhatsAppStatusBadge.tsx` — badge irmão, tokens reusados, cor+texto.

Diff completo: `git show 658634a`.

</details>
