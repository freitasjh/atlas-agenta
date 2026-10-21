# Parecer Revisor B — ADR-07: Preview no `SendMessageDialog` + QA ao vivo da fatia

Revisor independente B (modelo distinto do revisor A; não vi o parecer A). Escopo revisado:
diff `5681f85..HEAD` restrito a `src/` (fim da ADR-06 → HEAD), mais leitura dos ADRs 03/04 e da
Edge Function `whatsapp` para conferir paridade preview↔servidor.

A ADR adiciona um bloco de preview do texto renderizado no `SendMessageDialog`, extrai
`segmentTemplate` + `resolveEmpresa` para o contrato compartilhado (`src/lib/message-templates.ts`),
alinha o preview do editor (ADR-06) ao mesmo contrato e expõe `legal_name` via `useTenant`. O
contrato de fio do `send` não muda; as opções do `Select` vêm da lista fechada `MESSAGE_TEMPLATES`
(não do fetch de `message_templates`), o que mantém `receptionist`/`professional` — sem `SELECT` por
RLS — capazes de disparar as 4 chaves.

**Watch for:** divergência consciente mas não sinalizada entre o preview "Prévia da mensagem" e o
texto realmente enviado quando há `appointmentId` — `{servico}`/`{dataHora}` aparecem como fallback
pt-BR no preview enquanto o servidor envia serviço/data reais (possível → confirmado no código).
Fora isso, as fronteiras multi-tenant/RLS/RBAC/idempotência/segredos/LGPD estão preservadas e a
paridade `segmentTemplate == renderTemplate` está coberta por teste.

**Verdict**: APPROVED

## Visão de alto nível

A extração de `resolveVariable` como fonte única de resolução, consumida tanto por `renderTemplate`
quanto por `segmentTemplate`, é a decisão de design mais importante: garante por construção que o
realce do preview não diverge do texto canônico. O teste novo ancora isso com a invariante
"concatenar os `value` dos segmentos == `renderTemplate(body, vars)`", que é o critério certo.

A paridade de `{empresa}` entre cliente e servidor é real: `resolveEmpresa` (`trade_name?.trim() ||
legal_name?.trim() || null`) reproduz exatamente o encadeamento de `resolveRenderedText` na Edge
Function. Expor `legal_name` no `useTenant`/`CurrentTenant` é o mínimo necessário para isso e não
vaza nada sensível (razão social não é segredo nem PII de cliente).

Fronteiras preservadas: o diff é 100% frontend de leitura + util puro; nenhuma mudança no payload do
`send`, no `useSendMessage`, nos DTOs ou nos 5 outcomes. O preview é derivado de dados já no cliente
(`customerName` prop, `trade_name`/`legal_name` do tenant do próprio usuário sob RLS) — não introduz
leitura cross-tenant nem envia `tenant_id` do cliente. Segredos continuam só no servidor.

A única aresta de produto é o preview de envio com `appointmentId`: o rótulo "Prévia da mensagem"
promete fidelidade, mas para sends a partir da Agenda o serviço e a data/hora reais ficam no fallback
porque o diálogo não recebe esses dados. É decisão registrada na ADR, mas o rótulo não a sinaliza ao
admin — diferente do editor, que rotula honestamente "Prévia (com dados de exemplo)".

<details>
<summary>Issues (2)</summary>

1. **Preview de envio engana em sends com agendamento (não bloqueante)** — para `appointmentId`
   presente, o preview mostra "seu atendimento"/"no horário combinado" enquanto o cliente recebe
   serviço/data reais; o rótulo "Prévia da mensagem" não avisa. Considerar um rótulo honesto
   (ex.: "Prévia (serviço e data reais são preenchidos no envio)") ou passar os dados do agendamento
   ao diálogo numa fatia futura. Alinhado ao item 2 da §Decisão da ADR, mas o texto visível não
   reflete a ressalva.
2. **Preview invisível para `receptionist`/`professional` (esperado, documentar no QA)** — como o
   preview depende de `useMessageTemplates()` (RLS: `SELECT` só admin), esses papéis disparam sem
   nenhum preview. É o comportamento correto pela ADR, mas o QA ao vivo (AC-10) deve confirmar
   explicitamente que o envio por esses papéis segue funcionando sem o bloco de preview.

</details>

<details>
<summary>Details</summary>

### Fonte única de resolução e a invariante preview↔envio

`resolveVariable` foi extraída e passou a ser o único ponto que decide "valor fornecido vs fallback",
consumida por `renderTemplate` (texto plano) e por `segmentTemplate` (segmentos para realce). Isso
elimina a cópia que existia dentro de `segmentPreview` no `TemplatePreview.tsx` antigo — aquele código
duplicava a tabela de fallback e podia divergir. Agora há um só critério.

O teste novo trava a invariante que importa:

```ts
const joinSegments = (body, vars) =>
  segmentTemplate(body, vars).map((s) => s.value).join("");
expect(joinSegments(body, vars)).toBe(renderTemplate(body, vars));
```

Cobre dados completos, fallback + token desconhecido (`{foo}` mantido literal), e os formatos de
segmento. É a verificação correta: o realce é cosmético desde que a concatenação reproduza o texto
canônico. 16 testes passam.

### Paridade de `{empresa}` cliente↔servidor

Servidor (`resolveRenderedText`):

```ts
const empresa =
  (tenantRow?.trade_name)?.trim() ||
  (tenantRow?.legal_name)?.trim() ||
  null;
```

Cliente (`resolveEmpresa`): `tradeName?.trim() || legalName?.trim() || null`. Mesma semântica,
inclusive vazio/espaços tratados como ausentes (coberto por teste: `resolveEmpresa("   ", ...)` cai
para `legal_name`). Sem `legal_name` no `useTenant` o preview mostraria "nossa equipe" enquanto o
cliente receberia a razão social — a correção fecha exatamente essa divergência.

### Fronteiras: RBAC, RLS, payload e idempotência

O desacoplamento das opções do `Select` da leitura de `message_templates` está correto e é o ponto
sutil certo: `canSendWhatsAppMessage` permite `admin|receptionist|professional` disparar, mas a RLS
de `message_templates` concede `SELECT` só ao admin. Derivar as opções do enum `MESSAGE_TEMPLATES`
garante as 4 chaves para todos os papéis que podem enviar; o `useMessageTemplates()` entra só para
enriquecer o preview quando há linhas (admin). `sendDisabled = !whatsappOptIn || isPending` não trava
por ausência de linha — a trava ativo/inativo e o fallback de template ausente são do servidor
(ADR-04 → `DEFAULT_TEMPLATE_BODIES`), então não há regressão de envio para papel sem `SELECT` nem
para tenant legado sem seed.

Nenhuma mudança no `useSendMessage`, `sendMessageSchema`, DTOs de `whatsapp.ts` ou nos 5 outcomes —
confirmado por leitura do diff. O payload segue `{ template, customerId, appointmentId? }`; o
`tenant_id` continua derivado do JWT no servidor. Idempotência (`dedupe_key` + índice único parcial)
intocada.

### Segredos e PII/LGPD

O diff não toca segredos: expõe apenas `legal_name` (razão social do próprio tenant, sob RLS), que
não é credencial nem PII de cliente final. O preview renderiza o `customerName` que já era prop do
diálogo — nenhuma PII nova no cliente. O log/payload não muda; a defesa de opt-in na borda
(`whatsappOptIn`) permanece e, de fato, o preview só aparece com `whatsappOptIn && selectedRow`, então
nem o texto de preview é montado sem consentimento. Alinhado a RNF-T02/AC-08.

### Divergência consciente do preview em sends com agendamento

Em `SendMessageDialog`, `previewVars` resolve só `nome` e `empresa`; `servico`/`dataHora` ficam
`undefined` e caem no fallback. Para o `SendMessageDialog` aberto pela Agenda (com `appointmentId`),
o servidor resolve serviço e data reais via `resolveRenderedText`, então o texto efetivo difere do
preview nesses dois campos. A ADR registra isso como decisão (item 2 da §Decisão), e a fonte da
verdade é o servidor — correto do ponto de vista de arquitetura. O atrito é só de produto: o rótulo
"Prévia da mensagem" (sem o "com dados de exemplo" que o editor usa) sugere fidelidade total. Não é
bloqueante — o texto enviado está certo; o preview é camada de confiança — mas o QA deve observar e
uma iteração futura pode passar os dados do agendamento ao diálogo ou ajustar o rótulo.

### Design doc React

Componentes funcionais + hooks, um componente por arquivo, TanStack Query para dados de servidor,
`useMemo` para derivações puras (sem `fetch` em `useEffect`). Acessibilidade: o bloco de preview tem
`aria-live="polite"`, realce por **fundo** (`bg-primary/15`) além de cor com texto em `foreground`
(contraste não depende só de cor), `whitespace-pre-wrap break-words` para não estourar layout. O
`Select` mantém `aria-label`. Mobile-first preservado (`max-h-[90vh] overflow-y-auto` no dialog, que
acomoda o bloco novo). TS estrito sem `any` (build `tsc -b` limpo). Reuso de `cn`, componentes shadcn
e do contrato compartilhado — nada recriado.

### Contraprova (build + testes)

- `npm run build` (`tsc -b && vite build`): **exit 0**. Warning pré-existente de chunk > 500 kB, não
  introduzido por esta ADR.
- `npm run test` (vitest): **32/32** passam, incluindo os 16 de `message-templates.test.ts`
  (`renderTemplate`, `segmentTemplate`, `resolveEmpresa`).
- Não há script de lint separado no `package.json`; os gates de qualidade existentes são `build` e
  `test`, ambos verdes. Nenhum arquivo temporário criado.

Não subi dev server — a verificação visual ao vivo via Chrome DevTools é do QA (step seguinte).

</details>

## Veredito

**APROVADO.** A ADR-07 cumpre o critério central da fatia (o preview torna o "envio usa o template
renderizado" visível) sem regredir o contrato de envio, os 5 outcomes, a idempotência, o opt-in ou o
isolamento multi-tenant. A paridade preview↔servidor de `{empresa}` e da lógica de fallback está
garantida por extração de fonte única e coberta por teste. Build e testes verdes.

As 2 issues são **não bloqueantes**: (1) o rótulo do preview de envio não sinaliza que
serviço/data são preenchidos no servidor quando há agendamento — refinamento de produto, não defeito
de correção; (2) ausência de preview para `receptionist`/`professional` é correta por RLS e deve ser
confirmada no QA ao vivo. Ambas ficam registradas para o QA (AC-07/AC-10) e para iteração futura.
