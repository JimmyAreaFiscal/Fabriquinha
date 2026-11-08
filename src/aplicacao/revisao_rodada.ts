// Revisão de rodada (comparacao-sdlc-implementacao.md §§4, 6): as evidências que cabem à Fabriquinha antes do pi.
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, matchesGlob } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { FABRIQUINHA } from "../nucleo/ator.ts";
import { branchDemanda, branchRodada, formatarRodadaRef, formatarTicketRef } from "../nucleo/demanda.ts";
import { encontrado, ErroDeRegra } from "../nucleo/erros.ts";
import { espacoDoTicket } from "../nucleo/espaco_de_trabalho.ts";
import { Endereco, ticketAtualDaEtapa } from "../nucleo/item_de_trabalho.ts";
import { escrever, raizDo } from "../armazenamento/banco.ts";
import { carregarProjeto } from "../armazenamento/projetos.ts";
import { carregarDemanda } from "../armazenamento/demandas.ts";
import { arquivosDe } from "../infra/repositorio/commit.ts";
import { exigirGit } from "../infra/repositorio/worktree.ts";
import { VerificacaoDeFitness } from "../infra/verificacao/fitness.ts";
import { exigidaPelaEtapa } from "../infra/verificacao/verificacao.ts";
import { cicloDoEspaco } from "./espaco/ciclo_do_espaco.ts";
import { submeterEvidencia } from "./evidencia/submeter.ts";
import { conduzirRevisao, type OpcoesRevisao, type ResultadoRevisao } from "./revisao_conducao.ts";

/** `arquivos_alterados` e `matriz_fitness` da rodada do ticket revisor, gravadas como evidência dele (regravar substitui). */
/** @testes o teste exercita direto; a produção a usa só dentro do módulo */
export async function prepararRevisaoRodada(
  banco: DatabaseSync,
  ref: { demanda_id: string; ticket_id: number },
): Promise<void> {
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
  const projeto = carregarProjeto(banco, ag.demanda.projeto);

  const raiz = raizDo(banco);
  const { pasta: worktree } = await cicloDoEspaco(espacoDoTicket(ag, { rodada_id }, projeto, raiz), projeto, {
    raiz,
    log: `${raiz}/log`,
  }).criar();

  // `base...head` é o diff desde o ancestral comum: o que a rodada fez, mesmo se a demanda avançou depois.
  const rev = async (branch: string) => (await exigirGit(projeto.raiz_git, "rev-parse", `refs/heads/${branch}`)).trim();
  const base = await rev(branchDemanda(demanda_id));
  const head = await rev(branchRodada(demanda_id, rodada_id));
  const diff = (formato: string) => exigirGit(projeto.raiz_git, "diff", "-z", "-M", formato, `${base}...${head}`);
  const arquivos = arquivosDe(await diff("--name-status"), await diff("--numstat"));
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

  const fitness = await exigidaPelaEtapa("revisar_rodada", new VerificacaoDeFitness(projeto)).coletar({ worktree });
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
}

/** Reserva e executa o `revisar_rodada` atual da rodada, com as evidências da Fabriquinha preparadas antes do pi. */
export async function conduzirRevisaoRodada(
  banco: DatabaseSync,
  ref: { demanda_id: string; rodada_id: number },
  opcoes: Omit<OpcoesRevisao, "preparar">,
): Promise<ResultadoRevisao> {
  const { demanda_id, rodada_id } = ref;
  const { ticket_id } = encontrado(
    ticketAtualDaEtapa(carregarDemanda(banco, demanda_id), "revisar_rodada", rodada_id),
    `a rodada ${formatarRodadaRef(ref)} não tem ticket revisar_rodada`,
    "use uma rodada da demanda que esteja em revisão",
  );
  const alvo = { demanda_id, ticket_id };
  return conduzirRevisao(banco, alvo, { ...opcoes, preparar: () => prepararRevisaoRodada(banco, alvo) });
}
