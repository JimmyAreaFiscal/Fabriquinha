// O transporte do cliente do agente: `fetch` à API de `FABRIQUINHA_API` com o token de `FABRIQUINHA_TOKEN`. A recusa da
// API volta como `ErroDoComando` com a mensagem e o código de saída do corpo; serviço parado vira "a Fabriquinha está fora".
import { ErroDaApiDoAgente } from "../contrato/agente.ts";
import { type ApiDoAgente, ErroDoComando, frase } from "./comando.ts";

export function criarApiDoAgente(env: NodeJS.ProcessEnv, buscar: typeof fetch): ApiDoAgente {
  async function pedir(metodo: "GET" | "POST", caminho: string, corpo?: unknown): Promise<unknown> {
    const { FABRIQUINHA_API: api, FABRIQUINHA_TOKEN: token } = env;
    if (!api) throw new ErroDoComando(frase("falta FABRIQUINHA_API", "o pi a define ao lançar o agente"));
    if (!token) throw new ErroDoComando(frase("falta FABRIQUINHA_TOKEN", "o pi o define ao lançar o agente"));
    let resposta: Response;
    try {
      resposta = await buscar(`${/^https?:\/\//.test(api) ? api : `http://${api}`}${caminho}`, {
        method: metodo,
        headers: {
          authorization: `Bearer ${token}`,
          ...(corpo !== undefined && { "content-type": "application/json" }),
        },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
      });
    } catch {
      throw new ErroDoComando(frase(`a Fabriquinha está fora: nada respondeu em ${api}`, "confira FABRIQUINHA_API"));
    }
    const json: unknown = await resposta.json().catch(() => undefined);
    if (resposta.ok && json !== undefined) return json;
    const erro = ErroDaApiDoAgente.safeParse(json);
    throw erro.success
      ? new ErroDoComando(erro.data.mensagem, erro.data.codigo_de_saida)
      : new ErroDoComando(`resposta inesperada da Fabriquinha (status ${String(resposta.status)})`);
  }

  return {
    get: (caminho) => pedir("GET", caminho),
    post: (caminho, corpo) => pedir("POST", caminho, corpo),
  };
}
