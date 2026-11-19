import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  fotoAltText,
  type ClinicalPhoto,
  type FotoTipo,
} from "@/app/agenda/prontuario/clinicalPhotos";
import {
  mapFotosError,
  useClinicalPhotos,
  useEnviarFoto,
} from "@/app/agenda/prontuario/useClinicalPhotos";

interface FotosAntesDepoisProps {
  customerId: string;
  appointmentId: string;
  timeZone: string;
  /** Termo assinado (fonte: TermoConsentimento). Sem ele, upload é recusado. */
  consented: boolean;
  canWrite: boolean;
  enabled: boolean;
}

/**
 * Fotos antes/depois (UX-SPEC T1 item 4): grid 2 col com miniaturas WebP lazy,
 * lightbox `Dialog` lado a lado (trap/Esc/retorno de foco nativos do Radix),
 * upload exige consentimento prévio. Append-only: nenhuma ação de excluir
 * existe nesta tela nem no hook (sem `remove`).
 */
export function FotosAntesDepois({
  customerId,
  appointmentId,
  timeZone,
  consented,
  canWrite,
  enabled,
}: FotosAntesDepoisProps) {
  const photosQuery = useClinicalPhotos({ customerId, appointmentId, consented, enabled });
  const enviarFoto = useEnviarFoto(consented);
  const [tipo, setTipo] = useState<FotoTipo>("antes");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [triggerRef, setTriggerRef] = useState<HTMLButtonElement | null>(null);

  const photos = photosQuery.data ?? [];
  const antes = photos.filter((photo) => photo.tipo === "antes");
  const depois = photos.filter((photo) => photo.tipo === "depois");

  useEffect(() => {
    if (lightboxIndex !== null && photos.length === 0) setLightboxIndex(null);
  }, [lightboxIndex, photos.length]);

  async function handleEnviar() {
    if (!arquivo) return;
    try {
      await enviarFoto.mutateAsync({ customerId, appointmentId, file: arquivo, tipo });
      setArquivo(null);
      toast.success("Foto enviada.");
    } catch (error) {
      toast.error(mapFotosError(error));
    }
  }

  const lightboxPhoto: ClinicalPhoto | null =
    lightboxIndex !== null ? (photos[lightboxIndex] ?? null) : null;
  const counterpart: ClinicalPhoto | null = lightboxPhoto
    ? (lightboxPhoto.tipo === "antes" ? depois : antes)[
        lightboxPhoto.tipo === "antes" ? antes.indexOf(lightboxPhoto) : depois.indexOf(lightboxPhoto)
      ] ?? null
    : null;

  function openLightbox(photo: ClinicalPhoto, trigger: HTMLButtonElement) {
    setTriggerRef(trigger);
    setLightboxIndex(photos.indexOf(photo));
  }

  function goTo(delta: number) {
    setLightboxIndex((index) =>
      index === null || photos.length === 0
        ? index
        : (index + delta + photos.length) % photos.length,
    );
  }

  function handleLightboxKeyDown(event: React.KeyboardEvent) {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      goTo(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      goTo(1);
    }
  }

  return (
    <section aria-label="Fotos antes e depois" className="space-y-3">
      <h4 className="text-sm font-semibold text-foreground">Fotos antes e depois</h4>

      {photosQuery.isLoading && enabled ? (
        <p className="text-sm text-muted-foreground" aria-busy="true">
          Carregando fotos…
        </p>
      ) : null}

      {photos.length === 0 && !(photosQuery.isLoading && enabled) ? (
        <p className="text-sm text-muted-foreground">Nenhuma foto registrada.</p>
      ) : null}

      {photos.length > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          {photos.map((photo) => (
            <button
              key={photo.path}
              type="button"
              onClick={(event) => openLightbox(photo, event.currentTarget)}
              className="overflow-hidden rounded-md border border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label={`Ampliar ${fotoAltText(photo, timeZone)}`}
            >
              <img
                src={photo.url}
                alt={fotoAltText(photo, timeZone)}
                loading="lazy"
                decoding="async"
                className="aspect-square w-full object-cover"
              />
              <span className="block bg-muted/40 px-2 py-1 text-left text-xs text-muted-foreground">
                {fotoAltText(photo, timeZone)}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {canWrite ? (
        consented ? (
          <div className="space-y-2 rounded-md border border-border bg-muted/20 p-3">
            <div role="group" aria-label="Tipo da foto" className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={tipo === "antes" ? "default" : "outline"}
                aria-pressed={tipo === "antes"}
                onClick={() => setTipo("antes")}
              >
                Antes
              </Button>
              <Button
                type="button"
                size="sm"
                variant={tipo === "depois" ? "default" : "outline"}
                aria-pressed={tipo === "depois"}
                onClick={() => setTipo("depois")}
              >
                Depois
              </Button>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="foto-arquivo">Escolher foto (JPG, PNG ou WebP, até 5 MB)</Label>
              <Input
                id="foto-arquivo"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(event) => setArquivo(event.target.files?.[0] ?? null)}
                className="text-base"
              />
              <Button
                type="button"
                disabled={!arquivo || enviarFoto.isPending}
                onClick={() => void handleEnviar()}
              >
                {enviarFoto.isPending ? (
                  <>
                    <Loader2 className="animate-spin" aria-hidden="true" />
                    Enviando…
                  </>
                ) : (
                  "Enviar foto"
                )}
              </Button>
            </div>
          </div>
        ) : (
          <p className="rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
            Registre o termo de consentimento abaixo antes de enviar fotos.
          </p>
        )
      ) : null}

      <Dialog
        open={lightboxPhoto !== null}
        onOpenChange={(open) => {
          if (!open) setLightboxIndex(null);
        }}
      >
        <DialogContent
          className="max-w-3xl"
          onKeyDown={handleLightboxKeyDown}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            triggerRef?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Comparar antes e depois</DialogTitle>
            <DialogDescription>
              Fotos lado a lado do atendimento. Use as setas para navegar.
            </DialogDescription>
          </DialogHeader>
          {lightboxPhoto ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <figure className="space-y-1">
                <img
                  src={lightboxPhoto.url}
                  alt={fotoAltText(lightboxPhoto, timeZone)}
                  className="w-full rounded-md object-contain"
                />
                <figcaption className="text-sm text-muted-foreground">
                  {fotoAltText(lightboxPhoto, timeZone)}
                </figcaption>
              </figure>
              {counterpart ? (
                <figure className="space-y-1">
                  <img
                    src={counterpart.url}
                    alt={fotoAltText(counterpart, timeZone)}
                    className="w-full rounded-md object-contain"
                  />
                  <figcaption className="text-sm text-muted-foreground">
                    {fotoAltText(counterpart, timeZone)}
                  </figcaption>
                </figure>
              ) : (
                <p className="self-center text-sm text-muted-foreground">
                  Sem foto correspondente do outro lado.
                </p>
              )}
            </div>
          ) : null}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              disabled={photos.length < 2}
              onClick={() => goTo(-1)}
            >
              Foto anterior
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={photos.length < 2}
              onClick={() => goTo(1)}
            >
              Próxima foto
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
