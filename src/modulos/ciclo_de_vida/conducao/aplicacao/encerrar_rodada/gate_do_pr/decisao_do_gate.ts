// Efeitos do gate do PR da rodada fora do agregado (comparacao-sdlc-implementacao.md §§4 e 6): integrar o PR na
// hospedagem, avançar a demanda local e abrir a sessão de ajustes do PR reprovado. A hospedagem é a fonte da verdade,
// então repetir a aprovação é seguro.
import type { DatabaseSync } from "node:sqlite";
import {
  type AgregadoDemanda,
  aprovarPRIntegradoDaRodada,
  carregarDemanda,
  decidirGateNaDemanda,
  type EntradaDoGate,
} from "../../../../processo/publico.ts";
import { type Ator, exigirAtor, formatarRodadaRef, Endereco } from "../../../../etapas/publico.ts";
import { ErroDeRegra, existe } from "../../../../../../shared/nucleo/erros.ts";
import { espacoDoTicket, ambienteDoEspaco, cicloDoEspaco } from "../../../../../repositorio/publico.ts";
import { GateDoPR } from "../gate.ts";
import type { GateComEfeitos } from "../../decisao_dos_gates/gate_com_efeitos.ts";
import type { Relogio } from "../../../../../../shared/nucleo/relogio.ts";
import { ticketAtualDaEtapa } from "../../../../planejamento/publico.ts";
import { raizDo } from "../../../../../../shared/armazenamento/banco.ts";
import { anotar, logDaOperacao } from "../../../../../../shared/infra/registro.ts";
import { ConducaoDeAjustarResultado } from "../../ajustar_resultado/conducao_de_ajustar_resultado.ts";
import { guardarMarcoDaSessao, sessaoDaRodada } from "../../ajustar_resultado/sessao_ajustes.ts";
import { condutor } from "../../politica_dos_agentes/condutor.ts";
import { projetosCadastrados } from "../../projetos_cadastrados.ts";

const gate = new GateDoPR();

const referenciaDaRodada = (endereco: Endereco) => ({
  demanda_id: endereco.demanda_id,
  rodada_id: existe(
    endereco.rodada_id,
    `o endereço ${endereco.toString()} não é de uma rodada`,
    "use o endereço da rodada, como I-206.R2",
  ),
});

/**
 * Aprova o PR da rodada com a nota (o Auditor) ou sem ela (a Fabriquinha, na aprovação automática). Falha antes da
 * confirmação não grava nada: o gate segue aberto para nova tentativa.
 */
async function aprovarPR(
  banco: DatabaseSync,
  endereco: Endereco,
  entrada: EntradaDoGate,
  ator: Ator,
  relogio: Relogio,
): Promise<AgregadoDemanda> {
  const ref = referenciaDaRodada(endereco);
  const ag = carregarDemanda(banco, ref.demanda_id);
  const rodada = existe(
    ag.rodadas.find((r) => r.rodada_id === ref.rodada_id),
    `a rodada ${formatarRodadaRef(ref)} não existe`,
    "use uma rodada da demanda",
  );
  const ticket = existe(
    ticketAtualDaEtapa(ag, gate.etapaAncora, ref.rodada_id),
    `a rodada ${formatarRodadaRef(ref)} não tem ticket ${gate.etapaAncora}`,
    "confira o estado da rodada",
  );

  if (rodada.estado === "concluida") {
    exigirAtor(ator, "aprovar o PR da rodada", "auditor");
    const decisao = ag.decisoes.find((d) => d.ticket_id === ticket.ticket_id && d.resultado === "aprovado");
    if (decisao?.nota === entrada.nota) return ag;
    throw new ErroDeRegra(
      `a rodada ${formatarRodadaRef(ref)} já foi concluída com ${decisao ? `a nota ${String(decisao.nota)}` : "outra decisão"}`,
      "a decisão do gate não muda depois de registrada",
    );
  }

  gate.ensaiar(ag, endereco, entrada, ator, { agora: relogio.agora() }); // recusa antes de integrar na hospedagem
  const projeto = projetosCadastrados().carregarProjeto(banco, ag.demanda.projeto);
  const raiz = raizDo(banco);
  const espaco = espacoDoTicket(ag, { rodada_id: ref.rodada_id }, projeto, raiz);
  const pr = existe(
    espaco.pr,
    `a rodada ${formatarRodadaRef(ref)} não tem PR publicado`,
    "o encerramento publica o PR",
  );
  const log = logDaOperacao(raiz, `pr-${formatarRodadaRef(ref)}`);
  await cicloDoEspaco(espaco, projeto, { raiz, log }, ambienteDoEspaco(espaco)).integrar();

  return aprovarPRIntegradoDaRodada(banco, gate, endereco, entrada, ator, relogio, {
    rodada_id: ref.rodada_id,
    numero: pr.numero,
    url: pr.url,
    head: pr.head,
  });
}

/**
 * Reprova o PR da rodada e abre a sessão de ajustes na hora (interativa, sem esperar o agendador). A recusa do domínio
 * (motivo vazio, ator, estado) lança antes de gravar o marco ou mudar o banco.
 */
async function reprovarPR(
  banco: DatabaseSync,
  endereco: Endereco,
  entrada: EntradaDoGate,
  ator: Ator,
  relogio: Relogio,
): Promise<{ demanda: AgregadoDemanda; sessao: string }> {
  const ref = referenciaDaRodada(endereco);
  const ag = carregarDemanda(banco, ref.demanda_id);
  gate.ensaiar(ag, endereco, entrada, ator, { agora: relogio.agora() });
  await guardarMarcoDaSessao(banco, ref, ag);
  const demanda = decidirGateNaDemanda(banco, gate, endereco, entrada, ator, relogio);
  const conducao = new ConducaoDeAjustarResultado({ banco, relogio, condutor, registro: anotar });
  const sessao = sessaoDaRodada(demanda, ref);
  const execucao = existe(
    await conducao.iniciar(Endereco.doTicket(ref.demanda_id, sessao.ticket_id)),
    "a sessão de ajustes não subiu",
    "confira o log da operação",
  );
  return { demanda, sessao: execucao.id };
}

/** O Gate do PR da rodada: a aprovação integra o PR na hospedagem; a reprovação abre a sessão de ajustes. */
export const GATE_DO_PR: GateComEfeitos = {
  regra: gate,
  async decidir(banco, endereco, entrada, ator, relogio) {
    const e = gate.validarEntrada(entrada, ator);
    if (e.resultado === "aprovado")
      return { demanda: await aprovarPR(banco, endereco, e, ator, relogio), canceladas: [] };
    return { ...(await reprovarPR(banco, endereco, e, ator, relogio)), canceladas: [] };
  },
};
