---
esperado: rota-b
---

# Validação de email no cadastro

Adicionar validação de email no endpoint `POST /internal/registrations` do módulo `company`. Rejeitar email inválido com 422. Não pode quebrar o cliente mobile, que hoje recebe 400. Bugfix — o cadastro aceita email sem arroba. Pronto quando `mvn test` passar e o IT do endpoint cobrir 422 para email inválido e 200/201 para email válido, com o contrato de sucesso inalterado.

## Veredito esperado (contrato — não é o prompt)

E1 ✅ · E2 ✅ · E3 ✅ · E4 ✅ · E5 ✅ · E6 ✅ → Rota B.
