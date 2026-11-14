// Comandos da ferramenta externa (Claude Code, Codex, pi) sobre a demanda, fora de uma execução de agente
// (comparacao-sdlc-implementacao.md §6 e §9.1): `fabriquinha demanda ...`. Cada comando só converte os argumentos e
// chama a fachada de Demandas, um fluxo do servidor ou a do Ciclo de Vida; decidir, cancelar e arquivar são do Auditor
// e não existem aqui.
import { readFileSync, realpathSync } from "node:fs";
import { text } from "node:stream/consumers";
import type { ParseArgsOptionsConfig } from "node:util";
import { ErroDeRegra } from "../../shared/nucleo/erros.ts";
import {
  type Ator,
  type CatalogoDoCicloDeVida,
  type CicloDeVida,
  Endereco,
} from "../../modulos/ciclo_de_vida/publico.ts";
import type { GestaoDeDemandas } from "../../modulos/demandas/publico.ts";
import { registrarPedidoComProcesso } from "../fluxos/registro_do_pedido.ts";
import { enviarAoDesenvolvimento } from "../fluxos/envio_ao_desenvolvimento.ts";
import {
  type Comando,
  type DepsDoCli,
  type EntradaDoComando,
  ErroDeUso,
  lerJsonDoArquivo,
  schemaJsonDoTipo,
} from "./comando.ts";
import { demandaParaCli } from "../contrato/agente/demanda_para_cli.ts";

const IDENTIDADE: ParseArgsOptionsConfig = { ferramenta: { type: "string" }, sessao: { type: "string" } };
const USO_IDENTIDADE = "[--ferramenta <f>] [--sessao <s>]";

/** `I-12` ou `12` viram `I-12`; o endereço de rodada ou de ticket não é de demanda. */
function idDe(texto: string): string {
  const endereco = Endereco.ler(texto);
  if (endereco.rodada_id !== undefined || endereco.ticket_id !== undefined) {
    throw new ErroDeRegra(`${texto} não é o endereço de uma demanda`, "use I-n, como I-206");
  }
  return endereco.demanda_id;
}

/** O Ator externo: a ferramenta e a sessão de origem, da opção ou, sem ela, de `FABRIQUINHA_FERRAMENTA` e `FABRIQUINHA_SESSAO`. */
function autorDe({ opcoes }: EntradaDoComando, { env }: DepsDoCli): Ator {
  const ferramenta = (opcoes.ferramenta as string | undefined) ?? env.FABRIQUINHA_FERRAMENTA;
  const sessao = (opcoes.sessao as string | undefined) ?? env.FABRIQUINHA_SESSAO;
  if (ferramenta && sessao) return { tipo: "externo", ferramenta, sessao };
  const faltam = [
    ...(ferramenta ? [] : ["a ferramenta de origem (--ferramenta ou FABRIQUINHA_FERRAMENTA)"]),
    ...(sessao ? [] : ["a sessão de origem (--sessao ou FABRIQUINHA_SESSAO)"]),
  ];
  throw new ErroDeUso(`falta ${faltam.join(" e ")}`);
}

/** Texto longo de um arquivo, ou do stdin com `-`. */
const ler = (arquivo: string, stdin: NodeJS.ReadableStream): Promise<string> =>
  arquivo === "-" ? text(stdin) : Promise.resolve(readFileSync(arquivo, "utf8"));

/** A demanda com as dependências, as evidências e os anexos (nome e SHA-256) de cada uma. */
function visao(cicloDeVida: CicloDeVida, gestaoDeDemandas: GestaoDeDemandas, id: string) {
  const { agregado, evidencias } = cicloDeVida.andamento(id);
  return {
    ...demandaParaCli(agregado.demanda),
    dependencias: gestaoDeDemandas.pedido(id).predecessoras,
    evidencias: evidencias.map(({ evidencia, anexos }) => ({
      tipo: evidencia.tipo,
      em: evidencia.em,
      arquivos: anexos.map((a) => ({ nome: a.nome, sha256: a.sha256 })),
    })),
  };
}

function tipoDe({ tiposDaEvidenciaDaDemanda }: CatalogoDoCicloDeVida, texto: string) {
  const tipo = tiposDaEvidenciaDaDemanda.find((t) => t === texto);
  if (tipo === undefined) {
    throw new ErroDeUso(`${texto} não é evidência da demanda; os tipos são: ${tiposDaEvidenciaDaDemanda.join(", ")}`);
  }
  return tipo;
}

export const COMANDOS_DEMANDA_EXTERNA: readonly Comando[] = [
  {
    nome: "demanda registrar",
    posicionais: [],
    opcoesDeUso: `--projeto <p> --titulo <t> --tipo <funcionalidade|problema> --descricao <arquivo|-> [--dep I-<m>]... ${USO_IDENTIDADE}`,
    argumentos: {
      options: {
        ...IDENTIDADE,
        projeto: { type: "string" },
        titulo: { type: "string" },
        tipo: { type: "string" },
        descricao: { type: "string" },
        dep: { type: "string", multiple: true },
      },
    },
    async executar(entrada, deps) {
      const { opcoes } = entrada;
      const faltando = ["projeto", "titulo", "tipo", "descricao"].find((o) => opcoes[o] === undefined);
      if (faltando !== undefined) throw new ErroDeUso(`falta --${faltando}`);
      const autor = autorDe(entrada, deps);
      const { projeto, titulo, tipo } = opcoes;
      const dados = {
        projeto,
        titulo,
        tipo,
        descricao: await ler(opcoes.descricao as string, deps.stdin),
        dependencias: ((opcoes.dep ?? []) as string[]).map(idDe),
      };
      return deps.comBanco((_banco, gestaoDeDemandas, cicloDeVida) =>
        visao(
          cicloDeVida,
          gestaoDeDemandas,
          registrarPedidoComProcesso(cicloDeVida, gestaoDeDemandas, dados, autor).demanda.id,
        ),
      );
    },
  },
  {
    nome: "demanda editar",
    posicionais: ["I-<n>"],
    opcoesDeUso: `[--titulo <t>] [--tipo <funcionalidade|problema>] [--descricao <arquivo|->] ${USO_IDENTIDADE}`,
    argumentos: {
      options: { ...IDENTIDADE, titulo: { type: "string" }, tipo: { type: "string" }, descricao: { type: "string" } },
    },
    async executar(entrada, deps) {
      const { posicionais, opcoes } = entrada;
      const id = idDe(String(posicionais[0]));
      const autor = autorDe(entrada, deps);
      const arquivo = opcoes.descricao as string | undefined;
      const dados = {
        titulo: opcoes.titulo,
        tipo: opcoes.tipo,
        descricao: arquivo === undefined ? undefined : await ler(arquivo, deps.stdin),
      };
      return deps.comBanco((_banco, gestaoDeDemandas, cicloDeVida) => {
        gestaoDeDemandas.editar(id, dados, autor);
        return visao(cicloDeVida, gestaoDeDemandas, id);
      });
    },
  },
  {
    nome: "demanda evidencia",
    posicionais: ["I-<n>", "<tipo>"],
    opcoesDeUso: `--dados <arquivo.json|-> [--arquivo <caminho>]... ${USO_IDENTIDADE}`,
    argumentos: {
      options: { ...IDENTIDADE, dados: { type: "string" }, arquivo: { type: "string", multiple: true } },
    },
    executar(entrada, deps) {
      const { posicionais, opcoes } = entrada;
      // O tipo vem do catálogo do Ciclo de Vida, que só existe com o banco aberto; as recusas seguem na mesma ordem.
      return deps.comBanco(async (_banco, gestaoDeDemandas, cicloDeVida) => {
        const id = idDe(String(posicionais[0]));
        const tipo = tipoDe(cicloDeVida.etapas(), String(posicionais[1]));
        const autor = autorDe(entrada, deps);
        const arquivo = opcoes.dados as string | undefined;
        if (arquivo === undefined) throw new ErroDeUso("falta --dados");
        const dados = await lerJsonDoArquivo(arquivo, deps.stdin);
        // A pasta do comando é a única origem dos anexos.
        const pasta = realpathSync(process.cwd());
        const origens = {
          worktree: pasta,
          saida: pasta,
          fora: "da pasta do comando",
          copie: `a pasta do comando (${pasta})`,
        };
        const arquivos = (opcoes.arquivo ?? []) as string[];
        const { avisos } = cicloDeVida.submeterEvidenciaExterna(id, { tipo, dados, arquivos }, autor, origens);
        return { ...visao(cicloDeVida, gestaoDeDemandas, id), avisos };
      });
    },
  },
  {
    nome: "demanda uso",
    posicionais: ["I-<n>"],
    opcoesDeUso: `--dados <arquivo.json|-> ${USO_IDENTIDADE}`,
    argumentos: { options: { ...IDENTIDADE, dados: { type: "string" } } },
    async executar(entrada, deps) {
      const id = idDe(String(entrada.posicionais[0]));
      const autor = autorDe(entrada, deps);
      const arquivo = entrada.opcoes.dados as string | undefined;
      if (arquivo === undefined) throw new ErroDeUso("falta --dados");
      const dados = await lerJsonDoArquivo(arquivo, deps.stdin);
      return deps.comBanco((_banco, gestaoDeDemandas, cicloDeVida) => {
        const { avisos } = cicloDeVida.declararUso(id, dados, autor);
        return { ...visao(cicloDeVida, gestaoDeDemandas, id), avisos };
      });
    },
  },
  {
    nome: "demanda enviar",
    posicionais: ["I-<n>"],
    opcoesDeUso: USO_IDENTIDADE,
    argumentos: { options: IDENTIDADE },
    executar(entrada, deps) {
      const id = idDe(String(entrada.posicionais[0]));
      const autor = autorDe(entrada, deps);
      return deps.comBanco((_banco, gestaoDeDemandas, cicloDeVida) => {
        enviarAoDesenvolvimento(cicloDeVida, gestaoDeDemandas, id, autor);
        return visao(cicloDeVida, gestaoDeDemandas, id);
      });
    },
  },
  {
    nome: "demanda ver",
    posicionais: ["I-<n>"],
    opcoesDeUso: USO_IDENTIDADE,
    argumentos: { options: IDENTIDADE },
    executar: ({ posicionais }, deps) =>
      deps.comBanco((_banco, gestaoDeDemandas, cicloDeVida) =>
        visao(cicloDeVida, gestaoDeDemandas, idDe(String(posicionais[0]))),
      ),
  },
  {
    nome: "demanda schema",
    posicionais: ["<tipo>"],
    opcoesDeUso: USO_IDENTIDADE,
    argumentos: { options: IDENTIDADE },
    // O catálogo do Ciclo de Vida só existe com o banco aberto.
    executar: ({ posicionais }, deps) =>
      deps.comBanco((_banco, _gestaoDeDemandas, cicloDeVida) =>
        schemaJsonDoTipo(cicloDeVida.etapas(), tipoDe(cicloDeVida.etapas(), String(posicionais[0]))),
      ),
  },
];
