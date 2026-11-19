# ADR-05 — G7 Fotos / mapa facial / termo (consentimento + append-only)

- Status: proposto

## Contexto

UX-SPEC T1 itens 4–6: fotos antes/depois, mapa facial SVG, termo de consentimento. Fronteiras: storage privado, consentimento prévio (whatsapp_opt_in como modelo), foto imutável (default §8 #4), termo global + assinatura única por cliente (default #5), LGPD dado sensível (minimização, sem PII em log/toast/URL). Emenda B2 (traço OU nome digitado), ajuste 6 (checkbox nunca pré-marcado), ajuste 8 (SVG button nativo).

## Decisão

Dentro da aba ADR-03, sem backend novo (storage privado existente + `clinical_records`/tabela de consentimento existente):

- Fotos: grid 2col WebP lazy, `alt "Antes — dd/mm/yyyy"`, lightbox `Dialog` nativo lado-a-lado com trap de foco/Esc/retorno de foco; upload exige consentimento prévio; append-only (sem DELETE).
- Mapa facial SVG: cada zona = `<button>` nativo ≥44px com nome acessível + lista textual espelhada (fonte p/ SR).
- Termo: status + Dialog texto + canvas assinatura + campo alternativo "Nome completo (vale como assinatura)" (B2) + checkbox LGPD nunca pré-marcado; assinado mostra nome/data/hash.

## Consequências

- Positivas: prontuário auditável completo; a11y real (SR usa lista textual).
- Riscos: peso de fotos — mitigado com lazy + WebP + limite de upload; canvas em mobile — fallback nome digitado garante conclusão.

## Escopo

Entra: fotos + mapa + termo na aba. Não entra: vídeo, export/impressão, LGPD art. 11/18, clínico em WhatsApp/logs.

## Arquivos afetados

- `src/app/agenda/prontuario/*` (FotosAntesDepois, MapaFacial, TermoConsentimento)
- Storage privado (reuso; sem bucket novo salvo inexistente — nesse caso, criar bucket privado conta como infra, não migration de domínio)
- Testes: upload bloqueado sem consentimento, foto sem DELETE, mapa keyboard-only operável, termo exige checkbox + (traço OU nome), hash exibido

## Critérios de aceite (testáveis)

1. Sem consentimento: upload recusado com mensagem; com consentimento: upload ok, miniatura WebP lazy.
2. Foto sem ação deletar no código/UI; tentativa de remoção cria nova versão ou é inexistente.
3. Mapa operável só por teclado (Tab + Enter em cada zona ≥44px); lista textual espelha seleção.
4. Termo só conclui com checkbox marcado + (canvas traço OU nome digitado); checkbox inicia desmarcado sempre.
5. Lightbox abre focado, Esc fecha e devolve foco ao trigger; Console zero; screenshots em `harness/`.

## Dependência

ADR-03 (aba hospedeira). Independente de ADR-02/04/06.
