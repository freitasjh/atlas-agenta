import { useCallback, useEffect, useRef, useState } from "react";

import { stripDigits } from "@/lib/mask";

/**
 * ViaCEP como sugestão, nunca autoridade (ADR-003, SPEC §1).
 *
 * - Debounce de 400ms após a última digitação; CEP com ≠8 dígitos nem dispara.
 * - Cada `lookup` aborta a requisição anterior (`AbortController`) e o timeout
 *   de 5s aborta a pendente — redigitar nunca deixa resposta velha na tela.
 * - Sucesso pré-preenche (a TELA decide o merge e nunca sobrescreve campo
 *   tocado); `{"erro": true}`/404 ⇒ `not-found`; rede/timeout ⇒ `error`.
 * - Sem cache persistente; nenhum valor sensível em log.
 */

export type CepLookupStatus =
  | "idle"
  | "loading"
  | "success"
  | "not-found"
  | "error";

export interface CepAddress {
  street: string;
  city: string;
  state: string;
}

interface ViaCepPayload {
  erro?: string | boolean;
  logradouro?: string;
  localidade?: string;
  uf?: string;
}

const DEBOUNCE_MS = 400;
const TIMEOUT_MS = 5000;

function parseAddress(payload: ViaCepPayload): CepAddress | null {
  if (payload.erro === true || payload.erro === "true") return null;
  return {
    street: typeof payload.logradouro === "string" ? payload.logradouro : "",
    city: typeof payload.localidade === "string" ? payload.localidade : "",
    state: typeof payload.uf === "string" ? payload.uf.toUpperCase() : "",
  };
}

export interface CepLookup {
  status: CepLookupStatus;
  address: CepAddress | null;
  lookup: (cep: string) => void;
  retry: () => void;
  reset: () => void;
}

export function useCepLookup(): CepLookup {
  const [status, setStatus] = useState<CepLookupStatus>("idle");
  const [address, setAddress] = useState<CepAddress | null>(null);
  const lastCepRef = useRef<string>("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutFiredRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const runFetch = useCallback(async (cep8: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    if (mountedRef.current) setStatus("loading");

    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutFiredRef.current = false;
    timeoutRef.current = setTimeout(() => {
      timeoutFiredRef.current = true;
      controller.abort();
    }, TIMEOUT_MS);

    try {
      const response = await fetch(
        `https://viacep.com.br/ws/${cep8}/json/`,
        { signal: controller.signal },
      );
      if (!response.ok) {
        if (!mountedRef.current) return;
        setAddress(null);
        setStatus(response.status === 404 ? "not-found" : "error");
        return;
      }
      const payload = (await response.json()) as ViaCepPayload;
      if (!mountedRef.current) return;
      const parsed = parseAddress(payload);
      if (parsed === null) {
        setAddress(null);
        setStatus("not-found");
        return;
      }
      setAddress(parsed);
      setStatus("success");
    } catch (error) {
      if (!mountedRef.current) return;
      if (error instanceof DOMException && error.name === "AbortError") {
        if (!timeoutFiredRef.current) return;
        setAddress(null);
        setStatus("error");
        return;
      }
      setAddress(null);
      setStatus("error");
    } finally {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    }
  }, []);

  const lookup = useCallback(
    (cep: string) => {
      const cep8 = stripDigits(cep);
      lastCepRef.current = cep8;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (cep8.length !== 8) {
        abortRef.current?.abort();
        if (mountedRef.current) {
          setStatus("idle");
          setAddress(null);
        }
        return;
      }
      debounceRef.current = setTimeout(() => {
        void runFetch(cep8);
      }, DEBOUNCE_MS);
    },
    [runFetch],
  );

  const retry = useCallback(() => {
    const cep8 = lastCepRef.current;
    if (cep8.length !== 8) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    void runFetch(cep8);
  }, [runFetch]);

  const reset = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    abortRef.current?.abort();
    lastCepRef.current = "";
    setStatus("idle");
    setAddress(null);
  }, []);

  return { status, address, lookup, retry, reset };
}
