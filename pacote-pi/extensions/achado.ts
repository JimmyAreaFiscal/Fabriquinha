// Extensão `achado` do pacote P1 `pi-fabriquinha` (I-240): a ferramenta `registrar_achado` da avaliação de melhoria do
// SDLC. Valida o achado e anexa uma linha JSON em `achados.jsonl` no diretório de trabalho do pi (a pasta da avaliação);
// o serviço da Fabriquinha importa as linhas novas. Não importa nada do projeto nem o pacote do pi.

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface Entrada {
  titulo?: unknown;
  descricao?: unknown;
  evidencia?: unknown;
}

interface Resultado {
  content: { type: "text"; text: string }[];
  details: undefined;
}

/** O pedaço da API de extensões do pi que a extensão usa. */
interface Pi {
  registerTool(ferramenta: {
    name: string;
    label: string;
    description: string;
    promptSnippet: string;
    promptGuidelines: string[];
    parameters: object;
    execute(id: string, entrada: Entrada): Promise<Resultado>;
  }): void;
}

const MAX_TITULO = 120;

const resultado = (text: string): Resultado => ({ content: [{ type: "text", text }], details: undefined });

const texto = (descricao: string) => ({ type: "string", description: descricao });

const PARAMETROS = {
  type: "object",
  properties: {
    titulo: texto(`Título do achado: uma linha, até ${String(MAX_TITULO)} caracteres.`),
    descricao: texto("O que foi observado e por que importa para o SDLC."),
    evidencia: texto("A evidência citada: a demanda, a sessão e o trecho ou número que sustentam o achado."),
  },
  required: ["titulo", "descricao", "evidencia"],
};

/** O texto aparado do campo, ou `undefined` se não é uma string com conteúdo. */
const campo = (valor: unknown): string | undefined =>
  typeof valor === "string" && valor.trim() ? valor.trim() : undefined;

export default function achado(pi: Pi): void {
  pi.registerTool({
    name: "registrar_achado",
    label: "registrar_achado",
    description:
      "Registra um achado da avaliação de melhoria do SDLC. É o único jeito de registrar algo: cada chamada é um achado, com título (uma linha, até 120 caracteres), descrição e a evidência citada.",
    promptSnippet: "Use esta ferramenta para registrar cada achado da avaliação, com título, descrição e evidência.",
    promptGuidelines: [
      "Registre um achado por chamada, só com o que as sessões, evidências, métricas e decisões da pasta sustentam.",
      "Cite a evidência: a demanda, a sessão e o trecho ou número.",
    ],
    parameters: PARAMETROS,
    execute(_id, entrada) {
      const titulo = campo(entrada.titulo);
      const descricao = campo(entrada.descricao);
      const evidencia = campo(entrada.evidencia);
      if (!titulo || /[\r\n]/.test(titulo) || titulo.length > MAX_TITULO)
        return Promise.resolve(
          resultado(`Achado recusado: titulo deve ter uma linha de 1 a ${String(MAX_TITULO)} caracteres.`),
        );
      if (!descricao) return Promise.resolve(resultado("Achado recusado: descricao é obrigatória."));
      if (!evidencia) return Promise.resolve(resultado("Achado recusado: evidencia é obrigatória."));
      const arquivo = join(process.cwd(), "achados.jsonl");
      const anteriores = existsSync(arquivo) ? readFileSync(arquivo, "utf8").split("\n").filter(Boolean).length : 0;
      appendFileSync(arquivo, JSON.stringify({ titulo, descricao, evidencia }) + "\n");
      return Promise.resolve(resultado(`Achado ${String(anteriores + 1)} registrado.`));
    },
  });
}
