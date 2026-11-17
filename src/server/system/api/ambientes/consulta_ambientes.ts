// A consulta da tela Ambientes (F7 §4.2): o Ambiente não conhece demandas, então aqui o ocupante opaco do container
// (`I-n` ou `I-n.Rm`) é traduzido, pelo Ciclo de Vida e pelo Repositório, em projeto, demanda, ticket, worktree e branch.
import { join, relative } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { type CicloDeVida, Endereco } from "../../../../modulos/ciclo_de_vida/publico.ts";
import type { GestaoDeDemandas } from "../../../../modulos/demandas/publico.ts";
import { espacoDoTicket } from "../../../../modulos/repositorio/publico.ts";
import { configuracaoDoAmbiente } from "../../../../shared/armazenamento/configuracao_do_ambiente.ts";
import { encontrado, ErroDeRegra } from "../../../../shared/nucleo/erros.ts";
import type { AmbientesEmUso } from "../contrato/ambientes.ts";
import type { AmbientesDoServico } from "../rotas.ts";

type OcupanteDoContainer = Pick<
  AmbientesEmUso["containers"][number],
  "projeto" | "demanda" | "ticket" | "worktree" | "caminho_completo_da_worktree" | "branch"
>;

const SEM_OCUPANTE: OcupanteDoContainer = {
  projeto: null,
  demanda: null,
  ticket: null,
  worktree: null,
  caminho_completo_da_worktree: null,
  branch: null,
};

/** O ocupante do container em projeto, demanda, ticket, worktree e branch; o que o Ciclo de Vida não reconhece fica sem ocupante. */
function traduzirOcupanteEmDemanda(
  alocadoPara: string | null,
  cicloDeVida: CicloDeVida,
  demandas: GestaoDeDemandas,
  raiz: string,
): OcupanteDoContainer {
  if (alocadoPara === null) return SEM_OCUPANTE;
  try {
    const { demanda_id, rodada_id } = Endereco.ler(alocadoPara);
    const resumo = encontrado(
      cicloDeVida.andamentos({ demandas: [demanda_id] })[0],
      `a demanda ${demanda_id} não existe`,
      "confira o ocupante do container",
    );
    const espaco = espacoDoTicket(resumo, { rodada_id }, demandas.projeto(resumo.demanda.projeto), raiz);
    const ticketsEmExecucao = resumo.tickets
      .filter((ticket) => ticket.estado === "em_execucao" && ticket.rodada_id === rodada_id)
      .map((ticket) => Endereco.doTicket(ticket.demanda_id, ticket.ticket_id).toString());
    return {
      projeto: resumo.demanda.projeto,
      demanda: demanda_id,
      ticket: ticketsEmExecucao.length > 0 ? ticketsEmExecucao.join(", ") : null,
      worktree: relative(join(raiz, "worktrees"), espaco.pasta),
      caminho_completo_da_worktree: espaco.pasta,
      branch: espaco.branch,
    };
  } catch (erro) {
    if (erro instanceof ErroDeRegra) return SEM_OCUPANTE;
    throw erro;
  }
}

/** O conjunto de containers medido agora, cada um com o que roda nele; no `host_local` o trabalho roda no host e não há containers. */
export async function consultarAmbientesEmUso(
  banco: DatabaseSync,
  cicloDeVida: CicloDeVida,
  ambientes: AmbientesDoServico,
  demandas: GestaoDeDemandas,
): Promise<AmbientesEmUso> {
  const { tipo } = configuracaoDoAmbiente(banco);
  if (tipo === "host_local") return { tipo, containers: [] };
  const conjunto = await ambientes.gestao.listar();
  return {
    tipo,
    containers: conjunto.map(({ id, slot, imagem, estado, alocado_para, medido }) => ({
      id,
      slot,
      imagem,
      estado,
      medido: medido ?? null,
      ...traduzirOcupanteEmDemanda(alocado_para, cicloDeVida, demandas, ambientes.raiz),
    })),
  };
}
