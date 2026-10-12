// Extensão `guarda` do pacote P1 `pi-fabriquinha` (P1 §3.1): a segunda camada contra PR criado pelo agente (F5 §5.0).
// No `tool_call` do `bash`, recusa o comando que cria, altera, reabre ou faz merge de PR pelo `gh` ou pelo `az`; o pi
// devolve o `reason` ao modelo como erro da ferramenta, e o agente segue o trabalho. Não importa o pacote do pi.

const RECUSA = "Somente a Fabriquinha cria e altera PR. Termine o seu ticket; ela publica o PR no encerramento.";

type Teste = (palavra: string) => boolean;

/** O programa pelo nome ou por um caminho terminado nele (`/usr/bin/gh`). */
const programa =
  (nome: string): Teste =>
  (palavra) =>
    palavra === nome || palavra.endsWith("/" + nome);
const umDe =
  (...nomes: string[]): Teste =>
  (palavra) =>
    nomes.includes(palavra);

/** Cada regra barra o trecho que tem, em ordem, uma palavra para cada teste, em qualquer posição adiante. */
const REGRAS: Teste[][] = [
  [programa("gh"), umDe("pr"), umDe("create", "new", "edit", "merge", "close", "reopen", "ready", "review", "comment")],
  [programa("gh"), umDe("api"), (palavra) => palavra.includes("pulls")],
  [programa("az"), umDe("repos"), umDe("pr"), umDe("create", "update", "set-vote", "reviewer", "work-item")],
];

/** Se as palavras contêm, em ordem e não necessariamente seguidas, uma que passa em cada teste da regra. */
const emOrdem = (palavras: string[], regra: Teste[]): boolean =>
  palavras.reduce((achados, palavra) => (regra[achados]?.(palavra) === true ? achados + 1 : achados), 0) ===
  regra.length;

/**
 * A recusa, se o comando mexe em PR (P1 §3.1), ou `null`. O pi entrega a string que o modelo escreveu e a roda com
 * `bash -c`: aspas, crases, `$(` e `)` viram espaço, e o comando se divide nos separadores (`&&`, `||`, `;`, `|`, `&`
 * e quebra de linha, que os de um caractere já cobrem). `echo "gh pr create"` também é recusado: o falso positivo
 * aceito. Comando em variável ou em script escrito antes passa; fica para a falta de credencial e o F5 (§5.0).
 */
export function bloqueio(comando: string): string | null {
  const trechos = comando.replaceAll(/["'`)]|\$\(/g, " ").split(/[;|&\n]/);
  const barra = trechos.some((trecho) => REGRAS.some((regra) => emOrdem(trecho.split(/\s+/), regra)));
  return barra ? RECUSA : null;
}

/** O pedaço da API de extensões do pi que a guarda usa. */
interface Pi {
  on(
    evento: "tool_call",
    tratador: (evento: { toolName: string; input: { command: string } }) => { block: true; reason: string } | undefined,
  ): void;
}

export default function guarda(pi: Pi): void {
  pi.on("tool_call", (evento) => {
    if (evento.toolName !== "bash") return undefined;
    const reason = bloqueio(evento.input.command);
    return reason === null ? undefined : { block: true, reason };
  });
}
