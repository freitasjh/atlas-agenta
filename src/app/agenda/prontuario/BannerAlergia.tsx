interface BannerAlergiaProps {
  allergies: string | null | undefined;
  isLoading: boolean;
  /** Sem entitlement os dados nunca carregam: estado neutro, nunca o vazio afirmativo. */
  unavailable?: boolean;
}

/**
 * Banner de alergias no topo da aba Prontuário: `sticky`, destrutivo quando há
 * alergia registrada, `aria-live` para anunciar mudanças. É o único bloco que
 * a recepção vê (ficha/evolução são restritas ao perfil clínico).
 */
export function BannerAlergia({
  allergies,
  isLoading,
  unavailable = false,
}: BannerAlergiaProps) {
  const hasAllergies =
    typeof allergies === "string" && allergies.trim() !== "";

  if (unavailable) {
    return (
      <p
        className="rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground"
        aria-live="polite"
      >
        Dados de alergia indisponíveis sem o recurso Prontuário.
      </p>
    );
  }

  if (isLoading) {
    return (
      <p
        className="rounded-md border border-border p-3 text-sm text-muted-foreground"
        aria-busy="true"
      >
        Verificando alergias…
      </p>
    );
  }

  if (!hasAllergies) {
    return (
      <p
        className="rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground"
        aria-live="polite"
      >
        Sem alergias registradas para este atendimento.
      </p>
    );
  }

  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      className="sticky top-0 z-10 rounded-md border border-destructive/60 bg-destructive/10 p-3"
    >
      <p className="text-sm font-semibold text-destructive">
        Atenção: alergia registrada
      </p>
      <p className="mt-1 text-sm text-foreground">
        {allergies}
      </p>
    </div>
  );
}
