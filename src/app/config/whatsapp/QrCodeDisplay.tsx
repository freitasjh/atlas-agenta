import { Loader2 } from "lucide-react";

/**
 * Render do QR Code de pareamento (base64, estado efêmero da resposta de `pair`
 * — ADR-04/06; não persistido). O código é só uma imagem; a alternativa real
 * não-visual são as instruções textuais numeradas ao lado (ver `ConnectionCard`).
 *
 * Moldura clara (quiet zone branca) garante leitura no tema escuro. Se o QR vier
 * ausente/vazio (resposta inesperada do mock), **não** renderiza `<img>` quebrada:
 * mostra uma mensagem genérica pt-BR e deixa o usuário gerar outro código.
 */
interface QrCodeDisplayProps {
  /** QR em base64 (sem prefixo data:). Ausente enquanto carrega ou se falhou. */
  qrCodeBase64?: string;
  /** True enquanto a função de pareamento está em andamento. */
  isLoading: boolean;
}

export function QrCodeDisplay({ qrCodeBase64, isLoading }: QrCodeDisplayProps) {
  if (isLoading) {
    return (
      <div
        className="flex aspect-square w-full max-w-[16rem] items-center justify-center rounded-lg border border-border bg-muted/30"
        aria-busy="true"
      >
        <Loader2
          className="h-8 w-8 animate-spin text-muted-foreground motion-reduce:animate-none"
          aria-hidden="true"
        />
        <span className="sr-only">Gerando código…</span>
      </div>
    );
  }

  if (!qrCodeBase64) {
    return (
      <div className="flex aspect-square w-full max-w-[16rem] items-center justify-center rounded-lg border border-dashed border-border p-4 text-center">
        <p className="text-sm text-muted-foreground">
          Não foi possível gerar o código. Tente novamente.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[16rem] rounded-lg bg-white p-3">
      <img
        src={`data:image/png;base64,${qrCodeBase64}`}
        alt="QR Code para conectar o WhatsApp"
        className="block aspect-square w-full"
      />
    </div>
  );
}
