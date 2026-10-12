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

/**
 * Cada regra é o programa e, em seguida, cada palavra de comando que ele recebe: a primeira palavra que não é opção
 * depois da anterior. `gh pr list --label ready` é `list`: o resto da linha não conta.
 */
const REGRAS: [Teste, ...Teste[]][] = [
  [programa("gh"), umDe("pr"), umDe("create", "new", "edit", "merge", "close", "reopen", "ready", "review", "comment")],
  [programa("gh"), umDe("api"), (palavra) => palavra.includes("pulls")],
  [programa("az"), umDe("repos"), umDe("pr"), umDe("create", "update", "set-vote", "reviewer", "work-item")],
];

/**
 * As posições em que pode estar a primeira palavra que não é opção a partir de `inicio`. A guarda não sabe quais
 * opções levam valor: `--opcao=valor` é uma palavra só, e `--opcao valor` vale das duas leituras, com e sem valor. Na
 * dúvida, a regra que casa em qualquer leitura barra.
 */
function proximas(palavras: string[], inicio: number): number[] {
  const achadas: number[] = [];
  const vistas = new Set<number>();
  const visitar = [inicio];
  for (let i = visitar.pop(); i !== undefined; i = visitar.pop()) {
    const palavra = palavras[i];
    if (palavra === undefined || vistas.has(i)) continue;
    vistas.add(i);
    if (palavra.startsWith("-")) visitar.push(i + 1, ...(palavra.includes("=") ? [] : [i + 2]));
    else achadas.push(i);
  }
  return achadas;
}

/** Se, a partir de `inicio`, cada próxima palavra de comando passa no teste seguinte da regra. */
const casa = (palavras: string[], regra: Teste[], inicio: number): boolean => {
  const [teste, ...resto] = regra;
  return (
    teste === undefined ||
    proximas(palavras, inicio).some((i) => teste(String(palavras[i])) && casa(palavras, resto, i + 1))
  );
};

/** O programa da regra em qualquer palavra do trecho (depois de `env`, `bash -c`...) e o resto em seguida a ele. */
const barra = (palavras: string[], [programaDaRegra, ...resto]: [Teste, ...Teste[]]): boolean =>
  palavras.some((palavra, i) => programaDaRegra(palavra) && casa(palavras, resto, i + 1));

/**
 * A recusa, se o comando mexe em PR (P1 §3.1), ou `null`. O pi entrega a string que o modelo escreveu e a roda com
 * `bash -c`: aspas, crases, `$(` e `)` viram espaço, e o comando se divide nos separadores (`&&`, `||`, `;`, `|`, `&`
 * e quebra de linha, que os de um caractere já cobrem). `echo "gh pr create"` também é recusado: o falso positivo
 * aceito. Comando em variável ou em script escrito antes passa; fica para a falta de credencial e o F5 (§5.0).
 */
export function bloqueio(comando: string): string | null {
  const trechos = comando.replaceAll(/["'`)]|\$\(/g, " ").split(/[;|&\n]/);
  const mexe = trechos.some((trecho) => {
    const palavras = trecho.split(/\s+/).filter(Boolean);
    return REGRAS.some((regra) => barra(palavras, regra));
  });
  return mexe ? RECUSA : null;
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
