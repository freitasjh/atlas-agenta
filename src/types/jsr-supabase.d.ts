// Declaração mínima de `jsr:@supabase/supabase-js@2` para o typecheck do
// frontend/Vitest. Os arquivos de `supabase/functions/_shared/**` importam esse
// tipo (uso real é resolvido pelo Deno); quando um teste de `src/**` importa um
// helper de `_shared`, o `tsc -b` precisa resolver o specifier `jsr:`.
//
// O builder é tipado o suficiente para a inferência de `queryOptionalById`
// (devolve `{ data: any }`), sem reintroduzir `any` cru no cliente.
declare module "jsr:@supabase/supabase-js@2" {
  export interface PostgrestBuilder {
    select(columns?: string): PostgrestBuilder;
    eq(column: string, value: unknown): PostgrestBuilder;
    is(column: string, value: unknown): PostgrestBuilder;
    order(column: string, options?: { ascending?: boolean }): PostgrestBuilder;
    maybeSingle(): Promise<{ data: any; error: any }>;
    then<TResult1 = { data: any; error: any }, TResult2 = never>(
      onfulfilled?: ((value: { data: any; error: any }) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
    ): Promise<TResult1 | TResult2>;
  }

  export interface SupabaseClient {
    from(table: string): PostgrestBuilder;
    rpc(fn: string, args?: Record<string, unknown>): Promise<{ data: any; error: any }>;
    auth: any;
  }
}
