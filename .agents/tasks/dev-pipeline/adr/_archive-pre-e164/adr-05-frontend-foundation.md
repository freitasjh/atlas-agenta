# ADR-05 — Fundação de frontend do módulo (tipos, enums, permissões, lib pt-BR, mapa de erros)

- **Status:** proposto
- **Escopo:** frontend
- **Depende de:** ADR-04 (contrato de resposta da Edge Function, que os DTOs/zod refletem). Não toca banco. É pré-requisito dos hooks (ADR-06) e das telas (ADR-07/08).

## Contexto

Antes de escrever hooks e telas, o módulo precisa de uma base compartilhada que concentre strings mágicas, enums de domínio, capacidades de RBAC e o mapa de erro pt-BR — no mesmo padrão já estabelecido (`src/types/domain.ts`, `src/hooks/usePermissions.ts`, `src/lib/scheduling-errors.ts`, `src/components/StatusBadge.tsx`). Isolar isso numa ADR própria mantém cada tela pequena e evita duplicar rótulos/erros. TS estrito, sem `any`.

## Decisão

1. **Tipos e enums de domínio** em `src/types/domain.ts` (estender, não reescrever): enums `WHATSAPP_CONNECTION_STATUSES` (`desconectado|aguardando_qr|conectado`), `MESSAGE_STATUSES` (`fila|enviado|entregue|falha`), `MESSAGE_TEMPLATES` (`confirmacao|lembrete_d1|cobranca|comprovante`) como `as const` + tipos derivados; interfaces `WhatsAppInstance` e `Message` espelhando o shape lido sob RLS (sem PII: `Message` não inclui telefone; `payload` só campos não sensíveis). Alinhar aos enums de `dominio.md`.

2. **Capacidades RBAC** em `src/hooks/usePermissions.ts` (estender o objeto retornado e a interface `Permissions`): `canManageWhatsAppConnection = isAdmin` e `canSendWhatsAppMessage = isAdmin || isReceptionist || isProfessional`. Não reescrever as capacidades existentes. É defesa em profundidade; a trava real é RLS + autorização na function.

3. **Lib pt-BR do módulo** em `src/lib/whatsapp.ts`: rótulos pt-BR dos templates e dos status (conexão e mensagem) — fonte única, espelhando `getAppointmentStatusLabel`; chaves de query TanStack (`WHATSAPP_INSTANCE_KEY`, `MESSAGES_KEY`); tipos DTO da resposta da função. Nenhum segredo, nenhum `tenant_id`.

4. **Validações zod** em `src/lib/validations/whatsapp.ts`: schema do formulário de envio (`template ∈ MESSAGE_TEMPLATES`, `customerId` uuid, `appointmentId?` uuid), com mensagens pt-BR, para o resolver do react-hook-form (ADR-08).

5. **Mapa de erro** em `src/lib/whatsapp-errors.ts`, espelhando `scheduling-errors.ts`: lê `code`/`message` **defensivamente** da resposta da Edge Function (dado não confiável), mapeia para pt-BR (opt-in negado, instância desconectada, duplicado como no-op benigno, sem permissão, genérico), nunca vaza schema, nunca loga PII.

6. **`WhatsAppStatusBadge`** em `src/components/WhatsAppStatusBadge.tsx`: componente irmão do `StatusBadge` (não inchar o existente), mesma casca visual (`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium`), reusando os tokens de status já calibrados AA — conexão: `conectado→status-confirmado`, `aguardando_qr→status-pendente`, `desconectado→status-cancelado`; mensagem: `enviado/entregue→status-confirmado`, `fila→status-pendente`, `falha→status-cancelado`. Rótulo textual além da cor (cor não é o único sinal). Rótulos vindos de `src/lib/whatsapp.ts`.

## Consequências

- Estabelece o vocabulário do módulo num só lugar; telas e hooks consomem sem duplicar.
- O badge irmão evita regressão no `StatusBadge` já consumido por Agenda/Clientes/assinatura.
- Mantém o padrão de erro defensivo e PII-safe do projeto.
- Independente das migrations — pode ser codificada em paralelo lógico com dados, mas vem **depois** de ADR-04 no plano para refletir o contrato real da function.

## Arquivos afetados

- `src/types/domain.ts` (modificar — estender)
- `src/hooks/usePermissions.ts` (modificar — estender)
- `src/lib/whatsapp.ts` (novo)
- `src/lib/validations/whatsapp.ts` (novo)
- `src/lib/whatsapp-errors.ts` (novo)
- `src/components/WhatsAppStatusBadge.tsx` (novo)

## Critérios de aceite testáveis (desta ADR)

- **A1.** `npm run build` e `npm run typecheck` limpos; TS estrito, **sem `any`** (CA-16, CA-F11).
- **A2.** `usePermissions()` expõe `canManageWhatsAppConnection` (= isAdmin) e `canSendWhatsAppMessage` (= admin/receptionist/professional) — verificável por typecheck + inspeção.
- **A3.** `WhatsAppStatusBadge` renderiza rótulo textual pt-BR para cada estado de conexão e de mensagem, usando os tokens `status-*` existentes (sem token novo); cor + texto presentes (CA-F07).
- **A4.** Nenhum literal de template/status duplicado fora de `src/lib/whatsapp.ts`/`src/types/domain.ts` (inspeção).
- **A5.** `src/lib/whatsapp-errors.ts` não expõe schema nem PII e tem fallback genérico pt-BR (inspeção + espelho de `scheduling-errors.ts`).
