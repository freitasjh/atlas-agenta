-- Migration: mensagem fixa no trigger de fuso de tenants (correção do review da ADR-03).
-- A função validate_tenant_timezone(), criada em 20250228090000, levantava
-- 'Fuso horário inválido: %' e ecoava o valor recusado. O RNF-03 pede que uma tentativa recusada
-- devolva só o código de erro, sem eco de valor gravado. Esta migration substitui o corpo da
-- função pela mensagem fixa 'Fuso horário inválido', mantendo SQLSTATE 22023.
-- CREATE OR REPLACE preserva o owner e os grants (EXECUTE revogado de public, anon e
-- authenticated) definidos na migration anterior. O trigger tenants_validate_timezone não muda.

create or replace function public.validate_tenant_timezone()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (select 1 from pg_timezone_names where name = new.timezone) then
    raise exception 'Fuso horário inválido' using errcode = '22023';
  end if;
  return new;
end;
$$;
