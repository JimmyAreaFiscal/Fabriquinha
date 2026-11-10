// Efeitos do gate do planejamento fora do agregado (comparacao-sdlc-implementacao.md §§3 e 6): preparar as worktrees
// antes de aprovar e falar com o pi vivo da sessão de planejamento. Git e pi ficam fora da transação.
import type { DatabaseSync } from "node:sqlite";
import type { AgregadoDemanda } from "../../nucleo/agregado_demanda.ts";
import type { Ator } from "../../nucleo/ator.ts";
import { ErroDeRegra, mensagem } from "../../nucleo/erros.ts";
import { type EspacoDeTrabalho, espacoDoTicket } from "../../nucleo/espaco_de_trabalho.ts";
import { type EntradaDoGate, GATES } from "../../nucleo/gate.ts";
import type { Endereco } from "../../nucleo/item_de_trabalho.ts";
import { lerPlanoGravado } from "../../nucleo/plano.ts";
import { raizDo } from "../../armazenamento/banco.ts";
import { carregarDemanda, comDemanda } from "../../armazenamento/demandas.ts";
import { carregarProjeto } from "../../armazenamento/projetos.ts";
import { anotar, logDaOperacao } from "../../infra/registro.ts";
import { ambienteDoServico } from "../espaco/ambiente_do_servico.ts";
import { cicloDoEspaco } from "../espaco/ciclo_do_espaco.ts";
import { encerrarPiVivo, mandarAoPiVivoOcioso } from "../etapas/pi_vivo.ts";
import { instanteAtual } from "../relogio.ts";
import { varrerBase } from "../retrabalho.ts";

const gate = GATES.gate_planejamento;

/**
 * O Auditor reprova com motivo; a demanda volta a `planejar`. Com o pi da sessão vivo e ocioso, o motivo vai a ele
 * como prompt; sem pi vivo, o despacho retoma a mesma sessão com o motivo.
 */
export function reprovarGateDoPlanejamento(
  banco: DatabaseSync,
  endereco: Endereco,
  entrada: EntradaDoGate,
  ator: Ator,
  motivo: string,
): AgregadoDemanda {
  const { ticket_id } = gate.ancora(carregarDemanda(banco, endereco.demanda_id), endereco);
  const reprovado = comDemanda(banco, endereco.demanda_id, (ag) =>
    gate.decidir(ag, endereco, entrada, ator, instanteAtual()),
  );
  mandarAoPiVivoOcioso(
    banco,
    { demanda_id: endereco.demanda_id, ticket_id },
    `Planejamento reprovado pelo Auditor. Motivo: ${motivo}`,
  );
  return reprovado;
}

/**
 * Prepara antes de confirmar (§6): garante a worktree da demanda e a de cada rodada independente e só então grava a
 * aprovação. Falha de preparação deixa o gate aberto, vai ao log e sobe com o caminho da worktree. Repetível: o que já
 * existe é reaproveitado.
 */
export async function aprovarGateDoPlanejamento(
  banco: DatabaseSync,
  endereco: Endereco,
  entrada: EntradaDoGate,
  ator: Ator,
): Promise<AgregadoDemanda> {
  const { demanda_id } = endereco;
  const ag = carregarDemanda(banco, demanda_id);
  gate.ensaiar(ag, endereco, entrada, ator, instanteAtual()); // recusa antes de tocar o git (estado, falha, plano ausente)
  const { ticket_id } = gate.ancora(ag, endereco);
  const plano = lerPlanoGravado(ag.evidencias.find((e) => e.tipo === "plano" && e.ticket_id === ticket_id)?.dados);
  const projeto = carregarProjeto(banco, ag.demanda.projeto);
  const raiz = raizDo(banco);
  const log = logDaOperacao(raiz, `planejamento-${demanda_id}`);
  const garantirEspaco = async (espaco: EspacoDeTrabalho): Promise<void> => {
    const ciclo = cicloDoEspaco(espaco, projeto, { raiz, log }, ambienteDoServico());
    const { buscouBase } = await ciclo.criar();
    if (buscouBase) await varrerBase(banco, projeto.nome).catch(ciclo.anotarFalhaDaVarredura);
  };
  const espacoDaDemanda = espacoDoTicket(ag, {}, projeto, raiz);
  const passos = [
    { caminho: espacoDaDemanda.pasta, garantir: () => garantirEspaco(espacoDaDemanda) },
    // D04: a rodada dependente nasce quando começa, da ponta da demanda já com as predecessoras integradas.
    ...plano.rodadas
      .filter((rodada) => rodada.depende.length === 0)
      .map(({ rodada_id }) => {
        const espaco = espacoDoTicket(ag, { rodada_id }, projeto, raiz);
        return { caminho: espaco.pasta, garantir: () => garantirEspaco(espaco) };
      }),
  ];
  for (const { caminho, garantir } of passos) {
    try {
      await garantir();
    } catch (erro) {
      anotar(log, `preparação falhou em ${caminho}: ${mensagem(erro)}`);
      throw new ErroDeRegra(`${mensagem(erro)} (worktree ${caminho})`);
    }
  }
  const aprovado = comDemanda(banco, demanda_id, (a) => gate.decidir(a, endereco, entrada, ator, instanteAtual()));
  // O planejamento acabou: o pi ocioso à espera do gate para e a execução ganha o fim.
  encerrarPiVivo(banco, { demanda_id, ticket_id });
  return aprovado;
}
