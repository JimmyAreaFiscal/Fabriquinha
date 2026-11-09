// Despacho das demandas (comparacao-sdlc-implementacao.md §§4.1, 4.2 e 6): a cada ciclo do agendador e no "Executar agora",
// escolhe o trabalho pela seleção global (o agente não escolhe), reserva e cria a execução na mesma transação e entrega
// ao serviço da etapa. pi, git e testes ficam fora da transação: rodam em segundo plano, depois dela.
import type { DatabaseSync } from "node:sqlite";
import { FABRIQUINHA } from "../nucleo/ator.ts";
import type { TicketDemanda } from "../nucleo/agregado_demanda.ts";
import { formatarTicketRef } from "../nucleo/demanda.ts";
import { ErroDeRegra, existe } from "../nucleo/erros.ts";
import { Endereco } from "../nucleo/item_de_trabalho.ts";
import { reservarTicket } from "../nucleo/reserva_ticket.ts";
import { selecionarTrabalhoGlobal } from "../nucleo/selecao_trabalho.ts";
import { falhaDoErro } from "../nucleo/tentativa.ts";
import { escrever } from "../armazenamento/banco.ts";
import { carregarDemanda, comDemanda } from "../armazenamento/demandas.ts";
import { demandasParaDespacho, ocupacaoDoLimite, retomadasDePlanejamento } from "../armazenamento/despacho_demanda.ts";
import { anotar, noLog } from "../infra/registro.ts";
import { type Configuracao, limiteParalelismo } from "../armazenamento/servico.ts";
import { concluirEncerramentoRodada, iniciarEncerramentoRodada } from "./encerramento_rodada.ts";
import { conduzirEncerramentoDemanda, type DepsEncerramentoDemanda } from "./encerramento_demanda.ts";
import type { DepsDaConducao } from "./etapas/conducao_de_etapa.ts";
import { ConducaoDeImplementar, type OpcoesDaImplementacao } from "./etapas/conducao_de_implementar.ts";
import { ConducaoDeResolverConflito } from "./etapas/conducao_de_resolver_conflito.ts";
import { ConducaoDeRevisarDemanda } from "./etapas/conducao_de_revisar_demanda.ts";
import { ConducaoDeRevisarRodada } from "./etapas/conducao_de_revisar_rodada.ts";
import { falharTicketDemanda } from "./fechamento_ticket.ts";
import { iniciarOuRetomarPlanejamento } from "./planejamento.ts";
import { retomarFalhasDeInfraestrutura } from "./retomada_infraestrutura.ts";
import { instanteAtual } from "./relogio.ts";
import { iniciarRevisaoIntegral } from "./revisao_demanda.ts";
import { condutor } from "./trabalho/condutor.ts";

/** @testes tipo que o teste usa para montar a entrada */
export interface DepsDespacho {
  /** Coleta das verificações e limite do commit do `implementar` e do `resolver_conflito`; injetáveis nos testes. */
  implementacao?: OpcoesDaImplementacao;
  /** Substitui a condução do `implementar` e do `resolver_conflito` nos testes que não sobem pi nem git. */
  conduzirImplementacao?: (banco: DatabaseSync, ticket: Endereco) => Promise<void>;
  /** Espera da verificação do PR no `encerrar_demanda`; injetável nos testes. */
  verificacao?: DepsEncerramentoDemanda["verificacao"];
}

/** Espera a etapa em segundo plano; o erro vai ao log, então a promessa devolvida nunca rejeita. */
const acompanhar = (fim: Promise<unknown>): Promise<void> => fim.then(() => undefined, noLog);

const rodadaDe = (t: TicketDemanda) => ({
  demanda_id: t.demanda_id,
  rodada_id: existe(t.rodada_id, `o ticket ${formatarTicketRef(t)} não é de uma rodada`, "use um ticket de rodada"),
});

/** Encerra a rodada: conduz o agente e, ao fim, confere e publica o PR; a falha do agente ou da publicação falha o ticket. */
async function encerrarRodada(banco: DatabaseSync, t: TicketDemanda, limiteMin: number): Promise<unknown> {
  const rodada = rodadaDe(t);
  const falha = await iniciarEncerramentoRodada(banco, rodada, limiteMin).fim;
  if (falha !== undefined) {
    falharTicketDemanda(banco, t, falha);
    return;
  }
  return falharSePreso(banco, t, () => concluirEncerramentoRodada(banco, rodada));
}

/** Roda `etapa`; se ela recusar sem falhar o ticket (documentação, estado), falha-o para não ficar preso em execução. */
async function falharSePreso<T>(banco: DatabaseSync, t: TicketDemanda, etapa: () => Promise<T>): Promise<T> {
  try {
    return await etapa();
  } catch (erro) {
    const atual = carregarDemanda(banco, t.demanda_id).tickets.find((x) => x.ticket_id === t.ticket_id);
    if (atual?.estado === "em_execucao") falharTicketDemanda(banco, t, falhaDoErro(erro));
    throw erro;
  }
}

/**
 * Reserva o ticket e inicia a etapa dele. Chamada dentro de `escrever`: a recusa síncrona desfaz a reserva. A promessa
 * devolvida é da etapa em segundo plano (as revisões, que são `async`, recusam por ela).
 */
function iniciarEtapa(banco: DatabaseSync, t: TicketDemanda, c: Configuracao, deps: DepsDespacho): Promise<unknown> {
  const { demanda_id, ticket_id } = t;
  const limiteMin = c.timeoutMin;
  if (t.etapa === "planejar") return iniciarOuRetomarPlanejamento(banco, demanda_id, limiteMin).fim;
  if (t.etapa === "encerrar_demanda") {
    const ctx = { agora: new Date().toISOString() };
    comDemanda(banco, demanda_id, (ag) => reservarTicket(ag, { ticket_id }, FABRIQUINHA, ctx, true));
    return falharSePreso(banco, t, () =>
      conduzirEncerramentoDemanda(banco, demanda_id, { verificacao: deps.verificacao }),
    );
  }
  const depsDaConducao: DepsDaConducao = { banco, relogio: instanteAtual, condutor, registro: anotar };
  const endereco = Endereco.doTicket(demanda_id, ticket_id);
  const conduzirImplementacao = (conducao: ConducaoDeImplementar) =>
    deps.conduzirImplementacao?.(banco, endereco) ?? conducao.conduzir(endereco);
  if (t.etapa === "implementar") {
    return conduzirImplementacao(new ConducaoDeImplementar(depsDaConducao, deps.implementacao));
  }
  if (t.etapa === "resolver_conflito") {
    return conduzirImplementacao(new ConducaoDeResolverConflito(depsDaConducao, deps.implementacao));
  }
  if (t.etapa === "revisar_rodada") return new ConducaoDeRevisarRodada(depsDaConducao).conduzir(endereco);
  if (t.etapa === "revisar_demanda") return new ConducaoDeRevisarDemanda(depsDaConducao).conduzir(endereco);
  return encerrarRodada(banco, t, limiteMin); // a seleção só devolve as sete etapas acima
}

/** Roda `inicio` numa transação (a recusa síncrona desfaz a reserva) e acompanha a etapa; o que falhar vai ao log. */
function disparar(banco: DatabaseSync, inicio: () => Promise<unknown>): Promise<void>[] {
  const etapas: Promise<unknown>[] = [];
  try {
    escrever(banco, () => {
      etapas.push(inicio());
    });
  } catch (erro) {
    noLog(erro);
  }
  return etapas.map(acompanhar);
}

/**
 * Um ciclo do agendador: (0) os tickets falhos por infraestrutura voltam a `aberto`; (1) a demanda cujas rodadas todas
 * concluíram vai à revisão integral; (2) retomam-se os planejamentos reprovados, até as vagas; (3) a seleção global
 * escolhe o resto no que sobra do limite. Devolve as etapas em segundo plano (nunca rejeitam); o ciclo não as espera.
 */
export function despacharDemandas(banco: DatabaseSync, c: Configuracao, deps: DepsDespacho = {}): Promise<void>[] {
  const retomadosPorInfraestrutura = retomarFalhasDeInfraestrutura(banco);
  if (retomadosPorInfraestrutura.length > 0) {
    noLog(`retomados depois de falha de ambiente: ${retomadosPorInfraestrutura.join(", ")}`);
  }
  for (const { agregado: ag } of demandasParaDespacho(banco)) {
    if (ag.demanda.estado !== "em_execucao" || !ag.rodadas.every((r) => r.estado === "concluida")) continue;
    try {
      iniciarRevisaoIntegral(banco, ag.demanda.id);
    } catch (erro) {
      noLog(erro);
    }
  }
  const limite = limiteParalelismo(banco);
  const vagas = limite - ocupacaoDoLimite(banco);
  const retomados = retomadasDePlanejamento(banco).slice(0, Math.max(0, vagas));
  const fins = retomados.flatMap((id) =>
    disparar(banco, () => iniciarOuRetomarPlanejamento(banco, id, c.timeoutMin).fim),
  );
  const escolhidos = selecionarTrabalhoGlobal(demandasParaDespacho(banco), {
    limite,
    vagasOcupadas: ocupacaoDoLimite(banco),
  });
  return [...fins, ...escolhidos.flatMap((t) => disparar(banco, () => iniciarEtapa(banco, t, c, deps)))];
}

/**
 * "Executar agora": a mesma elegibilidade e o mesmo limite global do ciclo, na mesma transação da reserva. Recusa com o
 * motivo, sem criar execução; duas tentativas seguidas geram uma só (a 2ª encontra o ticket já em execução). Devolve a
 * etapa em segundo plano, que nunca rejeita.
 */
export function executarAgoraDemanda(
  banco: DatabaseSync,
  ref: { demanda_id: string; ticket_id: number },
  c: Configuracao,
  deps: DepsDespacho = {},
): Promise<void> {
  return escrever(banco, () => {
    const { agregado, predecessoras_satisfeitas } = existe(
      demandasParaDespacho(banco).find((d) => d.agregado.demanda.id === ref.demanda_id),
      `a demanda ${ref.demanda_id} não está em planejamento, execução, revisão da demanda nem encerramento`,
      "só se executa agora o ticket de uma demanda dessas estados",
    );
    const ticket = existe(
      agregado.tickets.find((t) => t.ticket_id === ref.ticket_id),
      `o ticket ${formatarTicketRef(ref)} não existe`,
      "confira o endereço do ticket",
    );
    if (ticket.estado !== "aberto") {
      throw new ErroDeRegra(
        `o ticket ${formatarTicketRef(ref)} está ${ticket.estado}`,
        "só se executa agora um ticket aberto",
      );
    }
    if (ocupacaoDoLimite(banco) >= limiteParalelismo(banco)) {
      throw new ErroDeRegra("o limite global de paralelismo está ocupado", "espere uma execução terminar");
    }
    // Ensaio da reserva: a recusa diz por que a seleção não escolheria o ticket (predecessora pendente, rodada ocupada...).
    // O agregado volta como veio, então nada é gravado; a reserva de verdade é a da etapa.
    comDemanda(banco, ref.demanda_id, (ag) => {
      reservarTicket(
        ag,
        { ticket_id: ref.ticket_id },
        FABRIQUINHA,
        { agora: new Date().toISOString() },
        predecessoras_satisfeitas,
      );
      return ag;
    });
    return acompanhar(iniciarEtapa(banco, ticket, c, deps));
  });
}
