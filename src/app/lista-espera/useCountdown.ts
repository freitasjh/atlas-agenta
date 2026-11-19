import { useEffect, useState } from "react";

import { remainingMs } from "@/app/lista-espera/model";

/**
 * Countdown da oferta da waitlist (RF-09). Tique a cada 1s; ao zerar chama
 * `onExpire` uma única vez. Respeita `prefers-reduced-motion`? Não há animação
 * — só texto com `aria-live` no apresentador.
 */
export function useCountdown(
  expiresAt: string | null,
  options?: { onExpire?: () => void; tickMs?: number },
): { remaining: number; expired: boolean } {
  const tickMs = options?.tickMs ?? 1000;
  const onExpire = options?.onExpire;
  const [now, setNow] = useState(() => Date.now());
  const remaining = expiresAt ? remainingMs(expiresAt, now) : 0;
  const expired = expiresAt !== null && remaining <= 0;

  useEffect(() => {
    if (!expiresAt || remainingMs(expiresAt) <= 0) return;
    const id = window.setInterval(() => setNow(Date.now()), tickMs);
    return () => window.clearInterval(id);
  }, [expiresAt, tickMs]);

  useEffect(() => {
    if (expired) onExpire?.();
  }, [expired, onExpire]);

  return { remaining, expired };
}
