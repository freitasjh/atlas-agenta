import { Loader2 } from "lucide-react";

/**
 * Render do QR Code de pareamento (data URL renderizável, estado efêmero da
 * resposta de `pair` — ADR-04/06; não persistido). O código é só uma imagem; a
 * alternativa real não-visual são as instruções textuais numeradas ao lado (ver
 * `ConnectionCard`).
 *
 * Moldura clara (quiet zone branca) garante leitura no tema escuro. Se o QR vier
 * ausente/vazio (resposta inesperada), **não** renderiza `<img>` quebrada: mostra
 * uma mensagem genérica pt-BR e deixa o usuário gerar outro código.
 */
interface QrCodeDisplayProps {
  /**
   * QR como data URL renderizável (o backend já entrega `data:image/png;base64,...`
   * via `toQrDataUrl`). Ausente enquanto carrega ou se falhou.
   */
  qrCodeBase64?: string;
  /** True enquanto a função de pareamento está em andamento. */
  isLoading: boolean;
}

/**
 * Normaliza o QR para uma data URL renderizável em `<img>`, espelhando o guard do
 * backend (`toQrDataUrl`): se já vier com o prefixo `data:`, usa direto; senão
 * prefixa. Evita duplicar o prefixo e quebrar a imagem (ERR_INVALID_URL).
 */
function toQrSrc(qrCodeBase64: string): string {
  return qrCodeBase64.startsWith("data:")
    ? qrCodeBase64
    : `data:image/png;base64,${qrCodeBase64}`;
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
        src={toQrSrc(qrCodeBase64)}
        alt="QR Code para conectar o WhatsApp"
        className="block aspect-square w-full"
      />
    </div>
  );
}
