---
esperado: rota-a
bloqueio: E2
---

# Horas erradas no relatório

Corrija o cálculo de horas do relatório de folha: quando estiver pronto, o total de horas exibido no PDF deve bater com os lançamentos aprovados. Fica no módulo `timesheet`, endpoint `GET /v1/timesheets/summary`. Não pode mudar o formato atual do PDF nem os campos que os clientes consomem. Pronto quando `mvn test` passar e um IT comparar o total do endpoint com dois lançamentos aprovados. Bugfix.

## Veredito esperado (contrato — não é o prompt)

E1 ✅ · E2 ❌ · E3 ✅ · E4 ✅ · E5 ✅ · E6 ✅ → Rota A; bloqueio E2 (não diz o que entra e o que NÃO entra).
