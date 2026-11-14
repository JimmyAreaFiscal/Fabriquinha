// O Despacho (MELHORIAS §11, regras 4 a 6, e §5.2, regra 6): a cada ciclo do agendador e no "Executar agora", escolhe o
// trabalho pela mesma regra (o agente não escolhe), reserva o ticket na mesma transação e o entrega à Condução da Etapa
// dele. pi, git e testes ficam fora da transação: rodam em segundo plano, depois dela.
import type { DatabaseSync } from "node:sqlite";
import {
  type AgregadoDemanda,
  iniciarRevisaoIntegral,
  reservarTicketSelecionado,
  type TicketDemanda,
} from "../../processo/publico.ts";
import {
  Despacho,
  type DemandaParaDespacho,
  type MotivoDeRecusa,
  motivoDeRecusaDoItem,
  type ResultadoDoDespacho,
  type SituacaoDoDespacho,
  ESTADOS_DESPACHADOS,
} from "../nucleo/despacho.ts";
import { exigirSelecaoDoDespacho } from "../nucleo/reserva_ticket.ts";
import { ErroDeRegra, existe } from "../../../../shared/nucleo/erros.ts";
import { Endereco, exigirEtapaConduzida, formatarTicketRef } from "../../etapas/publico.ts";
import { escrever } from "../../../../shared/armazenamento/banco.ts";
import { agregadosParaDespacho, trabalhosVivos } from "../armazenamento/despacho_demanda.ts";
import { lerEmSnapshot } from "../../../../shared/armazenamento/snapshot.ts";
import { anotar, noLog } from "../../../../shared/infra/registro.ts";
import { type Configuracao, limiteParalelismo } from "../armazenamento/configuracao_do_servico.ts";
import { retomarFalhasDeInfraestrutura } from "./retomada_infraestrutura.ts";
import { type Relogio, relogioDoSistema } from "../../../../shared/nucleo/relogio.ts";
import { condutor, type DepsDaConducao, type DepsDespacho, type ModulosDoCiclo } from "../../conducao/publico.ts";

/**
 * As predecessoras ainda não satisfeitas de cada demanda de `demandaIds`; a que não tem nenhuma está liberada. Quem chama
 * o Despacho a informa a cada chamada: as dependências entre demandas são de Demandas, e o Despacho não as consulta.
 */
type PredecessorasPendentes = (demandaIds: readonly string[]) => ReadonlyMap<string, readonly string[]>;

/** Os agregados das demandas em planejamento, execução, revisão da demanda e encerramento. */
const agregadosDespachados = (banco: DatabaseSync): AgregadoDemanda[] =>
  agregadosParaDespacho(banco, ESTADOS_DESPACHADOS);

/**
 * As demandas que o Despacho avalia, cada uma com as predecessoras pendentes que `predecessorasPendentes` informa.
 * @testes o teste confere os estados lidos e as predecessoras; a produção a usa só dentro do módulo
 */
export function demandasParaDespacho(
  banco: DatabaseSync,
  predecessorasPendentes: PredecessorasPendentes,
): DemandaParaDespacho[] {
  const agregados = agregadosDespachados(banco);
  const pendentes = predecessorasPendentes(agregados.map((agregado) => agregado.demanda.id));
  return agregados.map((agregado) => ({
    agregado,
    predecessoras_pendentes: pendentes.get(agregado.demanda.id) ?? [],
  }));
}

/** Espera a etapa em segundo plano; o erro vai ao log, então a promessa devolvida nunca rejeita. */
const acompanhar = (fim: Promise<unknown>): Promise<void> => fim.then(() => undefined, noLog);

const depsDaConducaoDe = (modulos: ModulosDoCiclo, { timeoutMin }: Configuracao, relogio: Relogio): DepsDaConducao => ({
  ...modulos,
  limiteMin: timeoutMin,
  relogio,
  condutor,
  registro: anotar,
});

/** As recusas do último ciclo, só em memória: o Auditor as vê por `GET /api/despacho`; o reinício as zera até o ciclo seguinte. */
let recusasDoUltimoCiclo: ReadonlyMap<Endereco, MotivoDeRecusa> = new Map();

/** Por que cada item parado no último ciclo não foi despachado. */
export const ultimasRecusas = (): ReadonlyMap<Endereco, MotivoDeRecusa> => recusasDoUltimoCiclo;

/** A situação lida num snapshot só: as demandas em andamento e os tickets com trabalho vivo. */
const situacaoDoDespacho = (banco: DatabaseSync, predecessorasPendentes: PredecessorasPendentes): SituacaoDoDespacho =>
  lerEmSnapshot(banco, () => ({
    demandas: demandasParaDespacho(banco, predecessorasPendentes),
    vivos: trabalhosVivos(banco),
  }));

/** O ponto único do limite global de paralelismo (MELHORIAS §11, regra 6): o ciclo e o "Executar agora" selecionam por aqui. */
const selecionarNoLimiteGlobal = (banco: DatabaseSync, situacao: SituacaoDoDespacho): ResultadoDoDespacho =>
  new Despacho(limiteParalelismo(banco)).selecionar(situacao);

/**
 * A reserva do ticket aberto para a Fabriquinha, a mesma do ciclo e do "Executar agora": o Despacho precisa selecioná-lo
 * (`predecessorasSatisfeitas` diz se a demanda está liberada). Atômica: a unidade de trabalho do agregado pega o lock de
 * escrita antes de ler o ticket, então de duas reservas simultâneas a segunda o encontra já em execução e é recusada.
 */
export const reservarTicketParaAFabriquinha = (
  banco: DatabaseSync,
  { demanda_id, ticket_id }: { demanda_id: string; ticket_id: number },
  relogio: Relogio,
  predecessorasSatisfeitas: boolean,
): AgregadoDemanda =>
  reservarTicketSelecionado(banco, { demanda_id, ticket_id }, relogio, (ag, ticket) => {
    exigirSelecaoDoDespacho(ag, ticket, predecessorasSatisfeitas);
  });

/**
 * Reserva o ticket aberto (o planejamento reprovado que se retoma já está em execução) e o entrega à Condução da Etapa
 * dele. Chamada dentro de `escrever`: a recusa síncrona desfaz a reserva. A promessa devolvida é da Condução, em segundo
 * plano (as revisões, que são `async`, recusam por ela).
 */
function entregarAConducao(
  modulos: ModulosDoCiclo,
  c: Configuracao,
  predecessorasSatisfeitas: boolean,
  t: TicketDemanda,
  deps: DepsDespacho,
  relogio: Relogio,
): Promise<unknown> {
  exigirEtapaConduzida(t.etapa);
  if (t.estado === "aberto") reservarTicketParaAFabriquinha(modulos.banco, t, relogio, predecessorasSatisfeitas);
  const conducaoDaEtapa = deps.montarConducoes(depsDaConducaoDe(modulos, c, relogio))[t.etapa];
  return conducaoDaEtapa.conduzir(Endereco.doTicket(t.demanda_id, t.ticket_id));
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
 * concluíram vai à revisão integral; (2) o Despacho escolhe o que roda, por ticket e no que sobra do limite (o
 * planejamento reprovado é um ticket pronto como os outros), e as rodadas livres de uma demanda rodam em paralelo.
 * Devolve as etapas em segundo plano (nunca rejeitam); o ciclo não as espera.
 */
export function cicloDoDespacho(
  modulos: ModulosDoCiclo,
  c: Configuracao,
  deps: DepsDespacho,
  predecessorasPendentes: PredecessorasPendentes,
  relogio: Relogio = relogioDoSistema,
): Promise<void>[] {
  const { banco } = modulos;
  const retomadosPorInfraestrutura = retomarFalhasDeInfraestrutura(banco, relogio);
  if (retomadosPorInfraestrutura.length > 0) {
    noLog(`retomados depois de falha de ambiente: ${retomadosPorInfraestrutura.join(", ")}`);
  }
  for (const ag of agregadosDespachados(banco)) {
    if (ag.demanda.estado !== "em_execucao" || !ag.rodadas.every((r) => r.estado === "concluida")) continue;
    try {
      iniciarRevisaoIntegral(banco, ag.demanda.id, relogio);
    } catch (erro) {
      noLog(erro);
    }
  }
  const situacao = situacaoDoDespacho(banco, predecessorasPendentes);
  const { prontos, recusas } = selecionarNoLimiteGlobal(banco, situacao);
  recusasDoUltimoCiclo = recusas;
  const liberada = (t: TicketDemanda) =>
    situacao.demandas.some((d) => d.agregado.demanda.id === t.demanda_id && d.predecessoras_pendentes.length === 0);
  return prontos.flatMap((t) => disparar(banco, () => entregarAConducao(modulos, c, liberada(t), t, deps, relogio)));
}

/**
 * "Executar agora": a mesma seleção, o mesmo limite global e a mesma reserva do ciclo, numa transação só. O que o
 * Despacho recusa volta como `MotivoDeRecusa`, sem criar execução; duas tentativas seguidas geram uma só (a 2ª encontra o
 * ticket já em execução e lança). Aceito, devolve a etapa em segundo plano, que nunca rejeita.
 */
export function executarAgora(
  modulos: ModulosDoCiclo,
  ref: { demanda_id: string; ticket_id: number },
  c: Configuracao,
  deps: DepsDespacho,
  predecessorasPendentes: PredecessorasPendentes,
  relogio: Relogio = relogioDoSistema,
): MotivoDeRecusa | Promise<void> {
  const { banco } = modulos;
  return escrever(banco, () => {
    const situacao = situacaoDoDespacho(banco, predecessorasPendentes);
    const { agregado, predecessoras_pendentes } = existe(
      situacao.demandas.find((d) => d.agregado.demanda.id === ref.demanda_id),
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
    const { recusas } = selecionarNoLimiteGlobal(banco, situacao);
    const recusa = motivoDeRecusaDoItem(recusas, Endereco.doTicket(ref.demanda_id, ref.ticket_id));
    // Os outros prontos disputam as vagas livres no ciclo; quem executa agora só esbarra no limite cheio de execuções.
    if (recusa && !(recusa.tipo === "limite_de_paralelismo" && recusa.em_uso < recusa.limite)) return recusa;
    // Sem recusa, a reserva ainda diz por que a seleção não escolheria o ticket (outro aberto vem antes, etapa fora do
    // estado): ela lança, e a transação desfaz tudo.
    return acompanhar(entregarAConducao(modulos, c, predecessoras_pendentes.length === 0, ticket, deps, relogio));
  });
}
