// Efeitos do gate do planejamento fora do agregado (comparacao-sdlc-implementacao.md §§3 e 6): preparar as worktrees
// ao aprovar e falar com o pi vivo da sessão de planejamento. Git e pi ficam fora da transação.
import type { DatabaseSync } from "node:sqlite";
import {
  type AgregadoDemanda,
  carregarDemanda,
  decidirGateNaDemanda,
  type EntradaDoGate,
} from "../../../processo/publico.ts";
import type { Ator, Endereco } from "../../../etapas/publico.ts";
import { mensagem } from "../../../../../shared/nucleo/erros.ts";
import { type EspacoDeTrabalho, espacoDoTicket } from "../../../../repositorio/publico.ts";
import { GateDoPlanejamento } from "./gate.ts";
import type { GateComEfeitos } from "../decisao_dos_gates/gate_com_efeitos.ts";
import { lerPlanoGravado } from "../../../planejamento/publico.ts";
import type { Relogio } from "../../../../../shared/nucleo/relogio.ts";
import { raizDo } from "../../../../../shared/armazenamento/banco.ts";
import { anotar, logDaOperacao } from "../../../../../shared/infra/registro.ts";
import { encerrarPiVivo, mandarAoPiVivoOcioso } from "../conducao_de_etapa/pi_vivo.ts";
import { devolverAmbienteDoEspaco } from "../devolucao_do_ambiente.ts";
import { projetosCadastrados } from "../projetos_cadastrados.ts";
import type { ModulosDoCiclo } from "../modulos_do_ciclo.ts";

const gate = new GateDoPlanejamento();
const preparacoesEmAndamento = new Set<Promise<void>>();

/** Espera as preparações soltas que as aprovações deixaram (os testes a usam para ver o resultado delas). */
export const esperarPreparacoesDaAprovacao = async (): Promise<void> => {
  await Promise.all(preparacoesEmAndamento);
};

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
  const reprovado = decidirGateNaDemanda(banco, gate, endereco, entrada, ator, relogio);
  mandarAoPiVivoOcioso(
    banco,
    { demanda_id: endereco.demanda_id, ticket_id },
    `Planejamento reprovado pelo Auditor. Motivo: ${motivo}`,
  );
  return reprovado;
}

/**
 * Grava a aprovação e responde na hora; a preparação da worktree da demanda e da de cada rodada independente roda solta,
 * porque pode esperar vaga de sandbox. Repetível: o que já existe é reaproveitado, e a condução refaz o que falhou.
 */
async function aprovarGateDoPlanejamento(
  modulos: ModulosDoCiclo,
  endereco: Endereco,
  entrada: EntradaDoGate,
  ator: Ator,
  relogio: Relogio,
): Promise<AgregadoDemanda> {
  const { banco, repositorio } = modulos;
  const { demanda_id } = endereco;
  const ag = carregarDemanda(banco, demanda_id);
  gate.ensaiar(ag, endereco, entrada, ator, { agora: relogio.agora() }); // recusa antes de tocar o git (estado, falha, plano ausente)
  const { ticket_id } = gate.ancora(ag, endereco);
  const plano = lerPlanoGravado(ag.evidencias.find((e) => e.tipo === "plano" && e.ticket_id === ticket_id)?.dados);
  const projeto = projetosCadastrados().carregarProjeto(banco, ag.demanda.projeto);
  const raiz = raizDo(banco);
  const log = logDaOperacao(raiz, `planejamento-${demanda_id}`);
  // Cada Espaço devolve o Ambiente assim que fica pronto: preparar todos de uma vez exigiria um sandbox por Espaço ao mesmo tempo.
  const garantirEspaco = async (espaco: EspacoDeTrabalho): Promise<void> => {
    await repositorio.prepararEspaco(projeto, espaco, log);
    await devolverAmbienteDoEspaco(modulos, espaco.dono);
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
  // Para na primeira falha; o Ambiente do Espaço da demanda, que o pi vivo segurava, volta ao conjunto de qualquer jeito.
  const prepararEspacosDaAprovacao = async (): Promise<void> => {
    try {
      for (const { caminho, garantir } of passos) {
        await garantir().catch((erro: unknown) => {
          throw new Error(`em ${caminho}: ${mensagem(erro)}`);
        });
      }
    } finally {
      await devolverAmbienteDoEspaco(modulos, { demanda_id });
    }
  };
  const aprovado = decidirGateNaDemanda(banco, gate, endereco, entrada, ator, relogio);
  // O planejamento acabou: o pi ocioso à espera do gate para e a execução ganha o fim.
  await encerrarPiVivo(banco, { demanda_id, ticket_id });
  // Promessa solta: o Espaço pode esperar vaga no conjunto de sandboxes e a resposta não espera. Falha vai ao log; a condução refaz a preparação.
  const preparacao = prepararEspacosDaAprovacao()
    .catch((erro: unknown) => {
      anotar(log, `preparação falhou ${mensagem(erro)}`);
    })
    .finally(() => preparacoesEmAndamento.delete(preparacao));
  preparacoesEmAndamento.add(preparacao);
  return aprovado;
}

/** O Gate do planejamento: a aprovação grava e prepara as worktrees sem esperar; a reprovação fala com o pi vivo. */
export const GATE_DO_PLANEJAMENTO: GateComEfeitos = {
  regra: gate,
  async decidir(modulos, endereco, entrada, ator, relogio) {
    const e = gate.validarEntrada(entrada, ator);
    const demanda =
      e.resultado === "aprovado"
        ? await aprovarGateDoPlanejamento(modulos, endereco, e, ator, relogio)
        : reprovarGateDoPlanejamento(modulos.banco, endereco, e, ator, e.motivo, relogio);
    return { demanda, canceladas: [] };
  },
};
