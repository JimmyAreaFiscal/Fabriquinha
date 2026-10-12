// Rotas da página da issue (F7 §4.2, §4.3): a leitura da página, as dependências (C3, C4), o "Executar agora", o log
// e o prompt de uma execução e os arquivos de evidência.
import { createReadStream, existsSync, statSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { type Agregado, AUDITOR, type Ticket } from "../../dominio/agregado.ts";
import { encontrado } from "../../dominio/erros.ts";
import { adicionarDependencia, removerDependencia } from "../../dominio/issue.ts";
import { type Fase, Id } from "../../dominio/primitivos.ts";
import type { Projeto } from "../../dominio/projeto.ts";
import { type InfoSessao, sessoes } from "../../execucao/sessoes.ts";
import { type MetricasIssue, numerosDoDesenho } from "../../metricas/issue.ts";
import { arquivoRegistrado, caminhoArquivo } from "../../persistencia/arquivos.ts";
import { raizDo } from "../../persistencia/banco.ts";
import { dirDaExecucao } from "../../persistencia/execucoes.ts";
import { agregado, comIssue } from "../../persistencia/issues.ts";
import { custoPorExecucao } from "../../persistencia/metricas.ts";
import { projeto } from "../../persistencia/projetos.ts";
import { ocupacaoDoD8, ticketElegivel } from "../../persistencia/servico.ts";
import { limpezaPendente } from "../../repositorio/worktree.ts";
import { ErroHttp } from "../erros.ts";
import type { Rota } from "../rotas.ts";

/** O ID de um `:parametro` do caminho. */
export const IdDoCaminho = z.coerce.number().pipe(Id);

/** O que a página da issue lê (F7 §5): o agregado e o que fica fora dele. */
export interface PaginaDaIssue extends Agregado {
  projeto: Projeto;
  /** As dependências com o projeto (a dependência vale entre projetos) e a fase de cada uma. */
  dependencias: { id: Id; projeto: string; fase: Fase }[];
  /** As sessões dos tickets, ativas e terminadas. */
  sessoes: InfoSessao[];
  /** O custo de cada execução com uso, pelo ID dela. */
  custos: Record<string, number>;
  /** Os comandos da limpeza que falhou (F5 §5.3), para o Auditor rodar. */
  limpeza: string[];
  /** O ticket do **Executar agora**, se há um elegível; `ocupada` diz por que ele está desabilitado (D8). */
  executar?: { ticket: Ticket; ocupada?: string };
  /** Os números do desenho (F6 §5.5), só no gate do desenho; `null` com as evidências faltando ou malformadas. */
  desenho?: MetricasIssue["desenho"];
}

export const issueExistente = (banco: DatabaseSync, id: Id): Agregado =>
  encontrado(agregado(banco, id), `a issue I-${String(id)} não existe`, "confira o número da issue");

export const projetoDa = (banco: DatabaseSync, ag: Agregado): Projeto =>
  encontrado(
    projeto(banco, ag.issue.projeto),
    `o projeto ${ag.issue.projeto} não existe`,
    "cadastre-o na Configuração",
  );

async function paginaDaIssue(banco: DatabaseSync, id: Id): Promise<PaginaDaIssue> {
  const ag = issueExistente(banco, id);
  const doProjeto = projetoDa(banco, ag);
  const elegivel = ticketElegivel(banco, id);
  const ticket = ag.tickets.find((t) => t.id === elegivel);
  const ocupada = ocupacaoDoD8(banco);
  return {
    ...ag,
    projeto: doProjeto,
    dependencias: ag.issue.deps.map((dep) => {
      const { projeto: p, fase } = issueExistente(banco, dep).issue;
      return { id: dep, projeto: p, fase };
    }),
    sessoes: [
      ...(await sessoes(banco, { escopo: "ativas", issue: id })),
      ...(await sessoes(banco, { escopo: "historico", issue: id })),
    ],
    custos: custoPorExecucao(banco, id),
    limpeza: limpezaPendente(raizDo(banco), doProjeto, ag.issue),
    ...(ticket && { executar: { ticket, ...(ocupada && { ocupada }) } }),
    ...(ag.issue.fase === "aprovacao_desenho" && { desenho: numerosDoDesenho(ag) }),
  };
}

/** Um intervalo de bytes, de `inicio` a `fim` inclusive. */
export interface Intervalo {
  inicio: number;
  fim: number;
}

/**
 * O intervalo do cabeçalho `Range` num arquivo de `tamanho` bytes (F7 §4.3): `undefined` para servir o arquivo
 * inteiro (sem `Range`, mais de um intervalo ou sintaxe que não é de um intervalo de bytes, que o HTTP manda
 * ignorar), ou `"fora"` quando o intervalo não alcança o arquivo (416).
 */
export function intervalo(range: string | undefined, tamanho: number): Intervalo | "fora" | undefined {
  const [, de = "", ate = ""] = /^bytes=(\d*)-(\d*)$/.exec(range ?? "") ?? [];
  if (de === "" && ate === "") return undefined;
  // `bytes=-n`: os últimos n bytes.
  if (de === "")
    return Number(ate) === 0 || tamanho === 0
      ? "fora"
      : { inicio: Math.max(0, tamanho - Number(ate)), fim: tamanho - 1 };
  const inicio = Number(de);
  const fim = ate === "" ? tamanho - 1 : Math.min(Number(ate), tamanho - 1);
  if (ate !== "" && Number(ate) < inicio) return undefined;
  return inicio >= tamanho ? "fora" : { inicio, fim };
}

/** Manda o arquivo inteiro, ou o trecho pedido por `Range` (206), com os `cabecalhos` do tipo. */
async function enviarArquivo(
  resposta: ServerResponse,
  caminho: string,
  range: string | undefined,
  cabecalhos: Record<string, string>,
): Promise<void> {
  const tamanho = statSync(caminho).size;
  const trecho = intervalo(range, tamanho);
  const comuns = { ...cabecalhos, "Accept-Ranges": "bytes" };
  if (trecho === "fora") {
    resposta.writeHead(416, { ...comuns, "Content-Range": `bytes */${String(tamanho)}` }).end();
    return;
  }
  const { inicio, fim } = trecho ?? { inicio: 0, fim: tamanho - 1 };
  resposta.writeHead(trecho ? 206 : 200, {
    ...comuns,
    "Content-Length": String(fim - inicio + 1),
    ...(trecho && { "Content-Range": `bytes ${String(inicio)}-${String(fim)}/${String(tamanho)}` }),
  });
  // Arquivo vazio: `createReadStream` com `end: -1` leria tudo; não há o que mandar.
  if (tamanho === 0) resposta.end();
  else await pipeline(createReadStream(caminho, { start: inicio, end: fim }), resposta);
}

/** O `log` ou o `prompt.md` da execução, como texto; o caminho sai do ID inteiro (F7 §4.3). */
const textoDaExecucao =
  (arquivo: "log" | "prompt.md", rotulo: string): Rota["tratar"] =>
  async ({ banco, params, cabecalhos, resposta }) => {
    const execucao = IdDoCaminho.parse(params.id);
    const caminho = join(dirDaExecucao(raizDo(banco), execucao), arquivo);
    if (!existsSync(caminho)) throw new ErroHttp(404, `a execução E-${String(execucao)} não tem ${rotulo}`);
    await enviarArquivo(resposta, caminho, cabecalhos.range, { "Content-Type": "text/plain; charset=utf-8" });
  };

export const ROTAS_DA_ISSUE: Rota[] = [
  {
    metodo: "GET",
    caminho: "/api/issues/:id",
    tratar: ({ banco, params }) => paginaDaIssue(banco, IdDoCaminho.parse(params.id)),
  },
  {
    metodo: "POST",
    caminho: "/api/issues/:id/deps",
    tratar: ({ banco, params, corpo }) => {
      const { dep } = z.object({ dep: Id }).parse(corpo);
      comIssue(banco, IdDoCaminho.parse(params.id), "adicionarDependencia", AUDITOR, (ag, ctx) =>
        adicionarDependencia(ag, dep, AUDITOR, ctx),
      );
    },
  },
  {
    metodo: "DELETE",
    caminho: "/api/issues/:id/deps/:dep",
    tratar: ({ banco, params }) => {
      const dep = IdDoCaminho.parse(params.dep);
      comIssue(banco, IdDoCaminho.parse(params.id), "removerDependencia", AUDITOR, (ag) =>
        removerDependencia(ag, dep, AUDITOR),
      );
    },
  },
  {
    metodo: "POST",
    caminho: "/api/tickets/:id/executar",
    tratar: ({ params, agendador }) => agendador.executarAgora(IdDoCaminho.parse(params.id)),
  },
  { metodo: "GET", caminho: "/api/execucoes/:id/log", tratar: textoDaExecucao("log", "log") },
  { metodo: "GET", caminho: "/api/execucoes/:id/prompt", tratar: textoDaExecucao("prompt.md", "prompt") },
  {
    // F7 §4.3, F3 §3.3: só um hash registrado; o HTML roda numa origem opaca e não alcança a API.
    metodo: "GET",
    caminho: "/arquivos/:sha256",
    tratar: async ({ banco, params, query, cabecalhos, resposta }) => {
      const sha256 = String(params.sha256);
      const arquivo = encontrado(
        arquivoRegistrado(banco, sha256),
        `nenhuma evidência tem o arquivo ${sha256}`,
        "abra o arquivo pelo card da evidência",
      );
      await enviarArquivo(resposta, caminhoArquivo(banco, sha256), cabecalhos.range, {
        "Content-Type": arquivo.mime,
        "Content-Security-Policy": "sandbox allow-scripts",
        ...(query.has("baixar") && {
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(arquivo.nome)}`,
        }),
      });
    },
  },
];
