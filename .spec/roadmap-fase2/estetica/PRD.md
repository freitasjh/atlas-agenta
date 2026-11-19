# PRD — Fase 2 Estética (prontuário / pacotes / checkout clínica)

> Status: APROVADO pelo fundador (com emendas v1.1 da auditoria modern-web-guidance). Fonte UX vinculante: UX-SPEC.md v1.1.

## 1. Problema / valor
Clínica/estética sem prontuário (papel/planilha/WhatsApp); clinical_records existe sem UI (valor zero); sem pacotes de sessões (só combos venda única); checkout desligado p/ clínica (payments:false). Pronto: ficha+evolução no Drawer, fotos/mapa/termo auditáveis, pacotes com saldo/validade/baixa, checkout no ledger único, gating por entitlement. Sem papel, sem segundo financeiro.

## 2. Escopo
Entra: G4 UI prontuário (4ª aba Drawer + wizard anamnese, zero backend novo); G7 fotos/mapa/termo (storage privado, consentimento prévio); G6 pacotes (tabela packages/package_credits + RPCs venda/baixa/saldo; Config Pacotes admin; Dialog venda; card saldo; baixa ao concluir; vencido renova; zero bloqueia+avulso); G5 checkout clínica (flag aestheticCheckout, reuso 100% Settlement/Capture/ledger); T1.2 entitlements leitura (empty+upsell, degrada sem travar).
NÃO entra: motor quotas, Edge nova p/ ficha, entidade sales, status novo, mudança comissão, multi-unidade, desconto/override pacote, export/impressão, vídeo, autoagendamento/taxa/métricas (Fase 3), cross-tenant suporte, LGPD art. 11/18, clínico em WhatsApp/logs.

## 3. Requisitos (RF-01..RF-19): ficha/evolução (append-only, imutabilidade, timeline), foto/mapa/termo, pacotes (criar/vender/baixar/validade/recepção sem preço), checkout (5 formas, gorjeta fora, parcial, PIX máx 1, estorno lógico, sem regressão salão, segment-features), gating (empty+upsell, só-UI, sem request sensível).

## 4. Fronteiras: LGPD sensível (minimização, sem PII em log/toast/URL, consentimento); RLS tenant_id do JWT; RBAC clínico×financeiro; ledger append-only RF-24; PIX máx 1; *_cents/UTC; bloqueado/cancelado; segredos só Edge/env.

## 5. Perfis: matriz admin/professional(recepção sem clínico-financeiro)/super_admin sem caminho.

## 6. Enquadramento: Fase 1b schema → Fase 2 UI+pacotes+checkout; Fase 3 fora. Backend novo: 1 tabela + 2-3 RPCs.

## 7. Aceite QA: 375/1280 claro+escuro, touch 44px, WebP lazy, Network sem 4xx/5xx, Console zero, RBAC por papel, gating sem crash, append-only, screenshots em harness/, typecheck+build+test verdes, db reset 2x.

## 8. Perguntas — DEFAULTS assumidos para o PLAN (fundador pode corrigir no gate das ADRs): 1. pacote vinculado a 1 serviço; 2. validade desde a venda, vencido = venda nova; 3. baixa só ao `concluido`, cancelado NÃO estorna; 4. foto imutável (append-only, sem DELETE); 5. termo global, assinatura única por cliente; 6. recepção vende, mas NÃO conclui baixa; 7. sem entitlement, dado gravado segue legível (só escrita bloqueada + upsell); 8. comissão normal (preço cheio) em sessão de pacote.
