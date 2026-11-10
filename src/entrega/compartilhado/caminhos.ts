// Casamento de um padrão `/projects/:projeto` com o caminho pedido (F7 §4.4), usado pelo servidor nas rotas da API e
// pelo cliente nas páginas. Roda também no navegador: módulo puro, sem imports.

export type Parametros = Record<string, string>;

/** Os parâmetros de `caminho` se ele casa com `padrao`, cada um decodificado; senão, `undefined`. */
export function casar(padrao: string, caminho: string): Parametros | undefined {
  const literal = padrao.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
  const casou = new RegExp(`^${literal.replaceAll(/:(\w+)/g, "(?<$1>[^/]+)")}$`).exec(caminho);
  if (!casou) return undefined;
  try {
    return Object.fromEntries(
      Object.entries(casou.groups ?? {}).map(([nome, valor]) => [nome, decodeURIComponent(valor)]),
    );
  } catch {
    return undefined;
  }
}
