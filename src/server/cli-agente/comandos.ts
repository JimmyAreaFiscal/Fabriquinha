// Os sete comandos do agente, cada um mapeado para um endpoint de /api/agente/*. O comando lê os argumentos, os arquivos
// e o stdin (que só o cliente alcança) e manda o pedido; a regra e a conferência do escopo são do serviço.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { resolve } from "node:path";
import type {
  PedidoEvidenciaAdd,
  PedidoRevisaoDecidir,
  PedidoTicketCriar,
  RespostaAnexoEnviado,
} from "../contrato/agente/agente.ts";
import { type Comando, ErroDoComando, frase, lerJsonDoArquivo, mensagem } from "./comando.ts";

const caminhoDaApi = (...partes: string[]): string => `/api/agente/${partes.map(encodeURIComponent).join("/")}`;

/** O anexo a enviar: o caminho absoluto no Ambiente do agente e o SHA-256 do arquivo, lido em blocos. */
async function lerAnexo(arquivo: string): Promise<RespostaAnexoEnviado> {
  const hash = createHash("sha256");
  try {
    for await (const bloco of createReadStream(arquivo)) hash.update(bloco as Buffer);
  } catch (error_) {
    throw new ErroDoComando(frase(`não consegui ler ${arquivo}: ${mensagem(error_)}`, "confira o caminho do arquivo"));
  }
  return { caminho: resolve(arquivo), sha256: hash.digest("hex") };
}

export const COMANDOS_DO_AGENTE: readonly Comando[] = [
  {
    nome: "projeto ver",
    posicionais: [],
    argumentos: {},
    executar: (_, api) => api.get(caminhoDaApi("projeto")),
  },
  {
    nome: "demanda ver",
    posicionais: ["I-<n>"],
    argumentos: {},
    executar: ({ posicionais }, api) => api.get(caminhoDaApi("demandas", String(posicionais[0]))),
  },
  {
    nome: "ticket ver",
    posicionais: ["I-<n>.T<m>"],
    argumentos: {},
    executar: ({ posicionais }, api) => api.get(caminhoDaApi("tickets", String(posicionais[0]))),
  },
  {
    nome: "ticket criar",
    posicionais: ["I-<n>.R<m>"],
    opcoesDeUso: "--titulo <texto>",
    argumentos: { options: { titulo: { type: "string" } } },
    executar: ({ posicionais, opcoes }, api) => {
      const pedido: PedidoTicketCriar = { rodada: String(posicionais[0]), titulo: opcoes.titulo as string | undefined };
      return api.post(caminhoDaApi("tickets"), pedido);
    },
  },
  {
    nome: "revisao decidir",
    posicionais: ["I-<n>.T<m>", "aprovar|reprovar"],
    opcoesDeUso: "[--motivo <texto>] [--correcoes <json|->] [--plano <json|->]",
    argumentos: {
      options: {
        motivo: { type: "string" },
        correcoes: { type: "string" },
        plano: { type: "string" },
      },
    },
    executar: async ({ posicionais, opcoes }, api, stdin) => {
      const lerOpcao = async (opcao: "correcoes" | "plano") =>
        opcoes[opcao] === undefined ? undefined : lerJsonDoArquivo(String(opcoes[opcao]), stdin, `--${opcao}`);
      const pedido: PedidoRevisaoDecidir = {
        ticket: String(posicionais[0]),
        veredito: String(posicionais[1]),
        motivo: opcoes.motivo as string | undefined,
        correcoes: await lerOpcao("correcoes"),
        plano: await lerOpcao("plano"),
      };
      return api.post(caminhoDaApi("revisoes"), pedido);
    },
  },
  {
    nome: "evidencia schema",
    posicionais: ["<tipo>"],
    argumentos: {},
    executar: ({ posicionais }, api) => api.get(caminhoDaApi("evidencias", String(posicionais[0]), "schema")),
  },
  {
    nome: "evidencia add",
    posicionais: ["I-<n>.T<m>", "<tipo>"],
    opcoesDeUso: "--dados <arquivo.json|-> [--arquivo <caminho>]...",
    argumentos: { options: { dados: { type: "string" }, arquivo: { type: "string", multiple: true } } },
    executar: async ({ posicionais, opcoes }, api, stdin) => {
      const arquivos = (opcoes.arquivo ?? []) as string[];
      const dados = opcoes.dados === undefined ? undefined : await lerJsonDoArquivo(String(opcoes.dados), stdin);
      const lidos: { arquivo: string; anexo: RespostaAnexoEnviado }[] = [];
      for (const arquivo of arquivos) lidos.push({ arquivo, anexo: await lerAnexo(arquivo) });
      // Cada anexo vai em pedido próprio, em fluxo; só depois a evidência o cita pelo caminho e pelo SHA-256.
      for (const { arquivo, anexo } of lidos) {
        await api.postArquivo(`${caminhoDaApi("anexos")}?${new URLSearchParams(anexo).toString()}`, arquivo);
      }
      const pedido: PedidoEvidenciaAdd = {
        ticket: String(posicionais[0]),
        tipo: String(posicionais[1]),
        dados,
        anexos: lidos.map(({ anexo }) => anexo),
      };
      return api.post(caminhoDaApi("evidencias"), pedido);
    },
  },
];
