// Extensão `tempo_limite` do pacote P1 `pi-fabriquinha` (I-320): nenhum `bash` do agente passa de 30 min. O pi não tem
// limite padrão; o `timeout` do agente vale se for menor. Ao estourar, o pi encerra o comando e o agente recebe o aviso
// abaixo no resultado. Não importa o pacote do pi nem `src/`: o valor é igual ao `LIMITE_COMANDO_MS` (o teste confere).

export const LIMITE_SEGUNDOS = 30 * 60;

const AVISO =
  "o comando excedeu o limite de 30 min da Fabriquinha e foi encerrado; divida o trabalho em comandos menores";

interface Texto {
  type: string;
  text?: string;
}

/** O pedaço da API de extensões do pi que a extensão usa. */
interface Pi {
  on(evento: "tool_call", tratador: (evento: { toolName: string; input: { timeout?: number } }) => undefined): void;
  on(
    evento: "tool_result",
    tratador: (evento: { toolName: string; content: Texto[] }) => { content: Texto[] } | undefined,
  ): void;
}

export default function tempoLimite(pi: Pi): void {
  pi.on("tool_call", (evento) => {
    if (evento.toolName === "bash")
      evento.input.timeout = Math.min(evento.input.timeout ?? LIMITE_SEGUNDOS, LIMITE_SEGUNDOS);
    return undefined;
  });
  // ponytail: o aviso aparece também quando o estouro é do `timeout` menor do agente; o texto do pi já diz quantos segundos.
  pi.on("tool_result", (evento) => {
    if (evento.toolName !== "bash") return undefined;
    if (!evento.content.some((parte) => parte.text?.includes("Command timed out after"))) return undefined;
    return { content: [...evento.content, { type: "text", text: AVISO }] };
  });
}
