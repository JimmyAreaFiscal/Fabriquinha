// Revisão de rodada (comparacao-sdlc-implementacao.md §§4, 6): as evidências que cabem à Fabriquinha antes do pi.
import { matchesGlob } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { branchDemanda, branchRodada } from "../dominio/demanda.ts";
import { encontrado, ErroDeRegra } from "../dominio/erros.ts";
import { type EntradaEvidenciaDemanda, submeterEvidenciaDemanda } from "../dominio/evidencia_demanda.ts";
import { verificarFitness } from "../evidencias/verificacoes_comandos.ts";
import { schemaDe } from "../evidencias/schemas.ts";
import { raizDo } from "../persistencia/banco.ts";
import { configuracaoProjeto } from "../persistencia/configuracao_projeto.ts";
import { carregarDemanda, comDemanda } from "../persistencia/demandas.ts";
import { guardarBytes } from "../persistencia/arquivos.ts";
import { type Anexo, gravarAnexos } from "../persistencia/evidencia_demanda.ts";
import { arquivosDe } from "../repositorio/commit.ts";
import { garantirWorktreeRodada } from "../repositorio/worktree-demanda.ts";
import { exigirGit } from "../repositorio/worktree.ts";

type Dados = EntradaEvidenciaDemanda["dados"];

/** `arquivos_alterados` e `matriz_fitness` da rodada do ticket revisor, gravadas como evidência dele (regravar substitui). */
export async function prepararRevisaoRodada(
  banco: DatabaseSync,
  ref: { demanda_id: string; ticket_id: number },
): Promise<void> {
  const { demanda_id, ticket_id } = ref;
  const ag = carregarDemanda(banco, demanda_id);
  const { rodada_id } = encontrado(
    ag.tickets.find((t) => t.ticket_id === ticket_id),
    `o ticket ${demanda_id}.T${String(ticket_id)} não existe`,
    "confira o endereço do ticket",
  );
  if (rodada_id === undefined) {
    throw new ErroDeRegra(`o ticket ${demanda_id}.T${String(ticket_id)} não é de uma rodada`, "use o revisar_rodada");
  }
  const projeto = encontrado(
    configuracaoProjeto(banco, ag.demanda.projeto),
    `o projeto ${ag.demanda.projeto} não tem configuração`,
    "configure o projeto",
  );

  const worktree = await garantirWorktreeRodada(
    raizDo(banco),
    {
      nome: projeto.nome,
      repo: projeto.raiz_git,
      branchBase: projeto.branch_base,
      preparacao: projeto.preparacao.map((c) => c.comando),
    },
    { demanda_id, rodada_id },
    `${raizDo(banco)}/log`,
  );

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
  const alterados = schemaDe("arquivos_alterados").dados.parse({
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
  });

  const fitness = await verificarFitness({ projeto, e2e: false, worktree, arquivos: [] });
  const linhas = (fitness.dados.linhas as Record<string, unknown>[]).map((l) => ({
    ...l,
    log: `${String(l.nome)}.log`,
  }));
  const matriz = schemaDe("matriz_fitness").dados.parse({ linhas });
  const anexos: Anexo[] = fitness.logs.map(({ nome, texto }) => ({
    caminho: nome,
    mime: "text/plain",
    ...guardarBytes(banco, Buffer.from(texto)),
  }));

  const agora = new Date().toISOString();
  // Uma transação só: as duas evidências e os anexos entram juntos ou nenhuma entra.
  comDemanda(
    banco,
    demanda_id,
    (a) => {
      const autor = { ferramenta: a.demanda.origem_ferramenta, sessao: a.demanda.origem_sessao };
      const com = submeterEvidenciaDemanda(
        a,
        { tipo: "arquivos_alterados", dados: alterados as Dados, ticket_id },
        autor,
        agora,
      );
      return submeterEvidenciaDemanda(com, { tipo: "matriz_fitness", dados: matriz as Dados, ticket_id }, autor, agora);
    },
    () => {
      gravarAnexos(banco, { demanda_id, ticket_id, tipo: "matriz_fitness" }, anexos);
    },
  );
}
