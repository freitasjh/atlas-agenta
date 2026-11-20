---
esperado: rota-b
---

# Substituir converter MapStruct

Trocar o converter MapStruct do módulo `identity` por classe com construtor privado e método `of()` estático, sem nenhuma dependência nova. Escopo: apenas `IdentityConverter` e seu teste unitário; não tocar entidades, controllers ou contrato de API. Manter comportamento idêntico — inclusive o mapeamento de nulos. Refactor, não feature. Pronto quando `mvn test -pl identity` passar, o teste cobrir `of()` direto (sem mock) e o projeto não declarar mais MapStruct no `pom.xml`.

## Veredito esperado (contrato — não é o prompt)

E1 ✅ · E2 ✅ · E3 ✅ · E4 ✅ · E5 ✅ · E6 ✅ → Rota B.
