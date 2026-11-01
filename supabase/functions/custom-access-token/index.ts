// Entrada da Edge Function `custom-access-token` — ADR-01. A lógica está em handler.ts, que os
// testes importam sem subir servidor.
import { handleHookRequest } from "./handler.ts";

Deno.serve(handleHookRequest);
