# ADR-04 — T2 Wizard anamnese (primeira ficha)

- Status: proposto

## Contexto

Sem ficha, a aba ADR-03 mostra "Ficha não criada" + CTA. UX-SPEC T2 exige wizard 3 passos acessível (Quem → Histórico/contraindicações → Revisão + consentimento), mínimo 1 campo (regra trigger `has_content`). Ajustes 1/2/4 concentrados aqui.

## Decisão

Wizard local no Drawer (append via cliente sob RLS, zero backend):

- 3 passos com progresso acessível (`aria-current="step"` ou `<progress>` nomeado); foco move p/ heading do passo (`tabindex="-1"`); passos inativos fora da ordem de Tab (`hidden`/`inert`).
- `enterkeyhint` next/previous/done; validação no `blur` (se editado), limpa no `input`, nunca anuncia por keystroke; `aria-invalid` + `aria-describedby`; foco no 1º inválido no submit; CTA nunca desabilitado p/ bloquear validação (só anti duplo-post após submit válido).
- Autosave rascunho local + descarte com confirmação (2 cliques); inputs `font-size ≥16px`.

## Consequências

- Positivas: primeira ficha guiada, a11y AA, sem backend.
- Risco: rascunho local com dado saúde — mitigado com minimização (só rascunho do próprio atendimento, descarte explícito, sem PII em log).

## Escopo

Entra: wizard + CTA + rascunho + validação. Não entra: fotos/mapa/termo (ADR-05), edição de ficha existente (já em ADR-03 via nova versão).

## Arquivos afetados

- Novo `src/app/agenda/prontuario/AnamneseWizard.tsx` (+ passos)
- `src/app/agenda/prontuario/*` (integração CTA "Ficha não criada")
- Testes: navegação 3 passos, foco no heading, 1º inválido focado, rascunho/descarte, mínimo 1 campo

## Critérios de aceite (testáveis)

1. Transição de passo move foco p/ heading; passo inativo não é alcançável por Tab.
2. Submit inválido foca 1º inválido com `aria-invalid` + mensagem; digitar limpa erro sem anúncio por keystroke.
3. Mobile: `enterkeyhint` correto por passo; sem zoom iOS (font ≥16px).
4. Recarregar mantém rascunho; descartar exige confirmação.
5. Ficha criada aparece como v1 na timeline ADR-03; trigger `has_content` satisfeito.

## Dependência

ADR-03 (aba + CTA + timeline onde a v1 aparece). Independente de ADR-02.
