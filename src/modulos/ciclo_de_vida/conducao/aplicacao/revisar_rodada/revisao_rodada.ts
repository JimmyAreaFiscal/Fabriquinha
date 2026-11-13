// Revisão de rodada (comparacao-sdlc-implementacao.md §§4, 6): as evidências que cabem à Fabriquinha antes do pi.
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, matchesGlob } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { FABRIQUINHA, formatarTicketRef, Endereco } from "../../../etapas/publico.ts";
import { encontrado, ErroDeRegra } from "../../../../../shared/nucleo/erros.ts";
import { ambienteDoEspaco, espacoDoTicket, montarRepositorio } from "../../../../repositorio/publico.ts";
import { escrever, raizDo } from "../../../../../shared/armazenamento/banco.ts";
import { carregarDemanda, submeterEvidencia } from "../../../processo/publico.ts";
import { VerificacaoDeFitness, montarVerificacoesDaEtapa } from "../../../verificacoes/publico.ts";
import { projetosCadastrados } from "../projetos_cadastrados.ts";

/**
 * `arquivos_alterados` e `matriz_fitness` da rodada do ticket revisor, gravadas como evidência dele (regravar substitui).
 * Devolve o Espaço da rodada que ela criou para rodar a fitness.
 */
export async function prepararRevisaoRodada(
  banco: DatabaseSync,
  ref: { demanda_id: string; ticket_id: number },
): Promise<{ pasta: string }> {
  const { demanda_id, ticket_id } = ref;
  const ag = carregarDemanda(banco, demanda_id);
  const { rodada_id } = encontrado(
    ag.tickets.find((t) => t.ticket_id === ticket_id),
    `o ticket ${formatarTicketRef(ref)} não existe`,
    "use um ticket da demanda",
  );
  if (rodada_id === undefined) {
    throw new ErroDeRegra(
      `o ticket ${formatarTicketRef(ref)} não é de uma rodada`,
      "use o ticket revisar_rodada de uma rodada da demanda",
    );
  }
  const projeto = projetosCadastrados().carregarProjeto(banco, ag.demanda.projeto);

  const raiz = raizDo(banco);
  const espacoDaRodada = espacoDoTicket(ag, { rodada_id }, projeto, raiz);
  const repositorio = montarRepositorio({ banco });
  const worktree = await repositorio.prepararEspaco(projeto, espacoDaRodada, `${raiz}/log`);
  const ambiente = ambienteDoEspaco(espacoDaRodada);

  // O que a rodada fez desde o ancestral comum com a demanda, mesmo se a demanda avançou depois.
  const { base, head, arquivos } = await repositorio.alteracoesDoEspaco(projeto, espacoDaRodada);
  const delRodada = new Set(
    ag.tickets.filter((t) => t.rodada_id === rodada_id && t.etapa === "implementar").map((t) => t.ticket_id),
  );
  const previstos = [...new Set(ag.caminhos_ticket.filter((c) => delRodada.has(c.ticket_id)).map((c) => c.caminho))];
  const casa = (a: (typeof arquivos)[number], padrao: string) =>
    matchesGlob(a.caminho, padrao) || (a.caminhoAnterior !== undefined && matchesGlob(a.caminhoAnterior, padrao));
  const alterados = {
    base,
    head,
    arquivos: arquivos.map((a) => ({
      caminho: a.caminho,
      status: a.status,
      adicionadas: a.adicionadas,
      removidas: a.removidas,
      previsto: previstos.find((p) => casa(a, p)) ?? null,
    })),
    previstosNaoTocados: previstos.filter((p) => !arquivos.some((a) => casa(a, p))),
  };

  const { fitness: verificacaoDeFitness } = montarVerificacoesDaEtapa("revisar_rodada", {
    fitness: () => new VerificacaoDeFitness(projeto),
  });
  const fitness = await verificacaoDeFitness.coletar({ ambiente, worktree });
  const linhas = (fitness.dados.linhas as Record<string, unknown>[]).map((l) => ({
    ...l,
    log: `${String(l.nome)}.log`,
  }));

  // Os logs só existem em memória; a pasta temporária é a única origem de onde `submeterEvidencia` os aceita.
  const pastaDosLogs = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-logs-")));
  try {
    const caminhosDosLogs = fitness.logs.map(({ nome, texto }) => {
      const caminho = join(pastaDosLogs, nome);
      writeFileSync(caminho, texto);
      return caminho;
    });
    const origens = {
      worktree: pastaDosLogs,
      saida: pastaDosLogs,
      fora: "da pasta dos logs",
      copie: "a pasta dos logs",
    };
    const dono = Endereco.doTicket(demanda_id, ticket_id);
    // Uma transação só: as duas evidências entram juntas ou nenhuma entra.
    escrever(banco, () => {
      for (const [tipo, dados, anexos] of [
        ["arquivos_alterados", alterados, []],
        ["matriz_fitness", { linhas }, caminhosDosLogs],
      ] as const) {
        const avaliacao = submeterEvidencia(banco, { tipo, dono, produtor: FABRIQUINHA, dados, anexos }, { origens });
        if (avaliacao.resultado === "recusada") throw new ErroDeRegra(avaliacao.motivo, "corrija a revisão da rodada");
      }
    });
  } finally {
    rmSync(pastaDosLogs, { recursive: true, force: true });
  }
  return { pasta: worktree };
}
