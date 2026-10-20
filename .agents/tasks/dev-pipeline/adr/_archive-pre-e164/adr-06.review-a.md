# Parecer de Revisão Independente A — ADR-06

**Revisor:** Revisor A do dev-pipeline  
**Data:** 2025-02-19  
**ADR:** adr-06-data-hooks.md (Hooks de dados TanStack Query)  
**Status:** ✅ APROVADO

---

## Resumo

A ADR-06 implementa dois hooks de dados (`useWhatsAppInstance` e `useSendMessage`) que encapsulam a lógica de leitura e invocação da Edge Function `whatsapp` do módulo WhatsApp base. A implementação respeita **todos os critérios de aceite** da ADR, segue o padrão TanStack Query + zod do projeto, e cumpre as fronteiras de segurança multi-tenant (isolamento por RLS, nenhum `tenant_id` do cliente, validação de resposta).

**Contraprova executada:** `npm run build` ✅, `npm run typecheck` ✅. Nenhum erro de compilação ou tipo.

---

## High-Level View

Os dois hooks implementam o padrão já estabelecido em `useCustomers`/`useAppointments`: leitura via PostgREST sob RLS, mutações validadas com zod. `useWhatsAppInstance` faz **polling condicional** (só enquanto `aguardando_qr`), um detalhe crucial para tornar a transição observável sem reload manual. `useSendMessage` trata um contrato de resposta sofisticado: condições de negócio (`sent`/`duplicate`/`opt_out`/`not_connected`/`send_failed`) vêm no corpo mesmo quando o HTTP é não-2xx, e o hook as desambigua do erro de infra/auth.

A projeção de `messages` é **PII-safe** (sem `phone`/`email`, cliente identificado só por `customer_id`). Nenhum `tenant_id` sai do cliente; o servidor o deriva do JWT. Validação defensiva de resposta garante que payload inválido não quebra a UI.

---

<details>
<summary>Issues</summary>

Nenhum bloqueador. A implementação está alinhada aos requisitos e padrões.

</details>

---

<details>
<summary>Detalhes técnicos</summary>

### Isolamento multi-tenant (CA-05, RNF-WA-01)

Leitura de `whatsapp_instances` e `messages` via PostgREST com RLS do banco — o isolamento é garantido na camada de banco, não na aplicação. Confirmado por:

- `useWhatsAppInstance` chama `supabase.from("whatsapp_instances").select(...)` sem qualquer filtro de `tenant_id` (a RLS do banco o aplica automaticamente via `current_tenant_id()`).
- `useRecentMessages` idem para `messages`.

O cliente nunca envia `tenant_id` em nenhuma invocação (grep por "tenant_id" nas duas funções retorna 0 ocorrências fora de comentários e validações de leitura).

### Nenhum `tenant_id` do cliente em invocações privilegiadas (CA-21, CA-F10)

Payload de `pair`: `{ action: "pair" }` — vazio além do `action`.

Payload de `send`:
```javascript
{
  action: "send",
  template: input.template,
  customerId: input.customerId,
  ...(input.appointmentId ? { appointmentId: input.appointmentId } : {})
}
```

Nenhum `tenant_id`. O servidor resolve pelo JWT.

### Polling condicional (A2)

```typescript
refetchInterval: (query) =>
  query.state.data?.connection_status === "aguardando_qr"
    ? AWAITING_QR_POLL_MS
    : false,
```

Implementação correta: polling ativo só durante o estado transitório, desligado em `conectado`/`desconectado`. O intervalo é 2,5s — tempo razoável para o UX não travar a UI.

### Validação de resposta (A4)

Schemas zod para:
- Linha de `whatsapp_instances`: `whatsAppInstanceRowSchema` (id, tenant_id, evolution_instance_name, connection_status, last_connected_at, created_at).
- Linha de `messages`: `messageRowSchema` (mesmos campos, com failure_reason adicional).
- Resposta de `pair`: `pairResponseSchema` (connection_status, qr_code_base64?, last_connected_at?).
- Resposta de `send`: `sendResponseSchema` (outcome, message_id?, status, provider_message_id?).

Todas aplicadas via `.parse()` ou `.safeParse()` antes do uso. Shape inválido não quebra a UI.

### Contrato de negócio — condições de negócio em HTTP não-2xx

Ponto sofisticado e bem-feito: a função `readSendResponseFromError` recupera o corpo do erro quando ele contém um `SendResponse` válido (opt_out, duplicate, not_connected, send_failed). Apenas erros de infra/auth (401/403/500 sem resposta de negócio) propagam como erro, traduzidos por `mapWhatsAppError`.

Documentado no comentário da função com clareza. Comportamento defensivo: se o corpo não é `SendResponse`, devolve `null` e o erro segue como infra.

### Projeção sem PII (A5, RNF-WA-03)

```typescript
const MESSAGE_SELECT = "id, tenant_id, customer_id, appointment_id, channel, template, status, provider_message_id, failure_reason, payload, created_at";
```

Confirmado:
- Sem `phone`, `email`, documento.
- Vínculo ao destino é `customer_id` (FK).
- `payload` é jsonb de metadados (não sensível).

Conformidade LGPD na leitura.

### Enums alinhados (CA-02, dominio.md)

- `WHATSAPP_CONNECTION_STATUSES`: `[desconectado, aguardando_qr, conectado]`.
- `MESSAGE_TEMPLATES`: `[confirmacao, lembrete_d1, cobranca, comprovante]`.
- `MESSAGE_STATUSES`: `[fila, enviado, entregue, falha]`.

Todos exportados de `src/types/domain.ts` e consumidos nos schemas zod dos hooks. Sem duplicação de enums.

### Mapa de erro (pt-BR)

`src/lib/whatsapp-errors.ts` mapeia cada `outcome` de `send` e cada erro de infra em mensagem pt-BR, sem vazar schema nem PII. Exemplo:

- `sent` → "Mensagem enviada."
- `duplicate` → "Esta mensagem já havia sido enviada." (informativo, não erro)
- `opt_out` → "O cliente não autorizou o recebimento de mensagens por WhatsApp."
- `not_connected` → "O WhatsApp não está conectado. Faça a conexão em Configurações."

Qualidade alta de UX.

### Invalidação de cache

Ambas as mutações (`usePairWhatsApp`, `useSendMessage`) invalidam suas respectivas queries em `onSuccess`:
- `usePairWhatsApp` invalida `WHATSAPP_INSTANCE_KEY`.
- `useSendMessage` invalida `MESSAGES_KEY`.

Comportamento esperado: após o servidor reconhecer a mudança, a UI refetch os dados para refletir o novo estado.

### Tipos DTO alinhados com Edge Function (ADR-04)

Interfaces exportadas: `PairRequest`, `SendRequest`, `PairResponse`, `SendResponse`. Contrato documentado no topo do arquivo `whatsapp.ts` com referência a ADR-04 como "DONA do contrato". Comentário instrui: "se o contrato de resposta mudar na implementação, atualizar aqui e os schemas zod".

Conformidade com padrão de design.

### TypeScript estrito (A1, CA-16)

Build e typecheck passam sem qualquer erro. Nenhum `any` implícito. Tipos completos nos inputs/outputs dos hooks.

### Documentação e comentários

Comentários em português, precisos e referenciam as ADRs e regras de segurança por número (ADR-03, ADR-04, RNF-WA-01, etc.). Facilitam rastreabilidade.

</details>

---

## Conclusão

A ADR-06 cumpre **todos os 5 critérios de aceite** (A1–A5) com qualidade alta. Implementa o padrão TanStack Query do projeto, respeita isolamento multi-tenant, não envia dados sensíveis do cliente, valida respostas defensivamente, e fornece uma API clara para as telas (ADR-07/08) consumirem.

**Pendências identificadas:** Nenhuma. Os hooks estão prontos para consumo.

---

**Veredito:** ✅ **APROVADO**

