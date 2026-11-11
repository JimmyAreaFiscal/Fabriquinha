// Efeitos do gate do planejamento fora do agregado (comparacao-sdlc-implementacao.md §§3 e 6): preparar as worktrees
// antes de aprovar e falar com o pi vivo da sessão de planejamento. Git e pi ficam fora da transação.
import type { DatabaseSync } from "node:sqlite";
import type { AgregadoDemanda } from "../../sdlc/nucleo/demanda/agregado_demanda.ts";
import type { Ator } from "../../compartilhado/nucleo/vocabulario_do_sdlc/ator.ts";
import { ErroDeRegra, mensagem } from "../../compartilhado/nucleo/erros.ts";
import { type EspacoDeTrabalho, espacoDoTicket } from "../../repositorio/nucleo/espaco_de_trabalho.ts";
import type { EntradaDoGate } from "../../sdlc/nucleo/gate.ts";
import { GateDoPlanejamento } from "./gate.ts";
import type { GateComEfeitos } from "../../sdlc/aplicacao/gates/decisao_do_gate.ts";
import type { Endereco } from "../../compartilhado/nucleo/vocabulario_do_sdlc/endereco.ts";
import { lerPlanoGravado } from "../../sdlc/nucleo/demanda/plano.ts";
import type { Relogio } from "../../compartilhado/nucleo/relogio.ts";
import { raizDo } from "../../compartilhado/armazenamento/banco.ts";
import { carregarDemanda, comDemanda } from "../../sdlc/armazenamento/demandas.ts";
import { carregarProjeto } from "../../projeto/armazenamento/projetos.ts";
import { anotar, logDaOperacao } from "../../compartilhado/infra/registro.ts";
import { ambienteDoEspaco } from "../../repositorio/aplicacao/espaco/ambiente_do_espaco.ts";
import { cicloDoEspaco } from "../../repositorio/aplicacao/espaco/ciclo_do_espaco.ts";
import { encerrarPiVivo, mandarAoPiVivoOcioso } from "../conducao/pi_vivo.ts";
import { varrerCommitsHumanos } from "../../custos/aplicacao/metricas/varrer_commits_humanos.ts";

const gate = new GateDoPlanejamento();

/**
 * O Auditor reprova com motivo; a demanda volta a `planejar`. Com o pi da sessão vivo e ocioso, o motivo vai a ele
 * como prompt; sem pi vivo, o despacho retoma a mesma sessão com o motivo.
 */
function reprovarGateDoPlanejamento(
  banco: DatabaseSync,
  endereco: Endereco,
  entrada: EntradaDoGate,
  ator: Ator,
  motivo: string,
  relogio: Relogio,
): AgregadoDemanda {
  const { ticket_id } = gate.ancora(carregarDemanda(banco, endereco.demanda_id), endereco);
  const reprovado = comDemanda(banco, endereco.demanda_id, (ag) =>
    gate.decidir(ag, endereco, entrada, ator, { agora: relogio.agora() }),
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
async function aprovarGateDoPlanejamento(
  banco: DatabaseSync,
  endereco: Endereco,
  entrada: EntradaDoGate,
  ator: Ator,
  relogio: Relogio,
): Promise<AgregadoDemanda> {
  const { demanda_id } = endereco;
  const ag = carregarDemanda(banco, demanda_id);
  gate.ensaiar(ag, endereco, entrada, ator, { agora: relogio.agora() }); // recusa antes de tocar o git (estado, falha, plano ausente)
  const { ticket_id } = gate.ancora(ag, endereco);
  const plano = lerPlanoGravado(ag.evidencias.find((e) => e.tipo === "plano" && e.ticket_id === ticket_id)?.dados);
  const projeto = carregarProjeto(banco, ag.demanda.projeto);
  const raiz = raizDo(banco);
  const log = logDaOperacao(raiz, `planejamento-${demanda_id}`);
  const garantirEspaco = async (espaco: EspacoDeTrabalho): Promise<void> => {
    const ciclo = cicloDoEspaco(espaco, projeto, { raiz, log }, ambienteDoEspaco(espaco));
    const { buscouBase } = await ciclo.criar();
    if (buscouBase) await varrerCommitsHumanos(banco, projeto.nome).catch(ciclo.anotarFalhaDaVarredura);
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
  const aprovado = comDemanda(banco, demanda_id, (a) =>
    gate.decidir(a, endereco, entrada, ator, { agora: relogio.agora() }),
  );
  // O planejamento acabou: o pi ocioso à espera do gate para e a execução ganha o fim.
  encerrarPiVivo(banco, { demanda_id, ticket_id });
  return aprovado;
}

/** O Gate do planejamento: a aprovação prepara as worktrees antes de gravar; a reprovação fala com o pi vivo. */
export const GATE_DO_PLANEJAMENTO: GateComEfeitos = {
  regra: gate,
  async decidir(banco, endereco, entrada, ator, relogio) {
    const e = gate.validarEntrada(entrada, ator);
    const demanda =
      e.resultado === "aprovado"
        ? await aprovarGateDoPlanejamento(banco, endereco, e, ator, relogio)
        : reprovarGateDoPlanejamento(banco, endereco, e, ator, e.motivo, relogio);
    return { demanda, canceladas: [] };
  },
};
