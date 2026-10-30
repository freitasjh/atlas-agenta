-- Migration: remove a função bootstrap_super_admin(uuid) (ADR-04, PRD D-02).
-- O super admin passa a nascer direto na plataforma, pelo caminho server-side de criação, e não
-- por conversão de um profile de tenant. As migrations 20250228092000 a 20250228092400 são
-- histórico já aplicado e não são editadas. Sem cascade: se houver dependente, a migration falha
-- alto e a ADR volta para revisão.

drop function if exists public.bootstrap_super_admin(uuid);
