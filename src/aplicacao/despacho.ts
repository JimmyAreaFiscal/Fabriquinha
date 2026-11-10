// Despacho das demandas (comparacao-sdlc-implementacao.md §§4.1, 4.2 e 6): a cada ciclo do agendador e no "Executar agora",
// escolhe o trabalho pelo Despacho (o agente não escolhe), reserva e cria a execução na mesma transação e entrega
// ao serviço da etapa. pi, git e testes ficam fora da transação: rodam em segundo plano, depois dela.
import type { DatabaseSync } from "node:sqlite";
import { FABRIQUINHA } from "../nucleo/ator.ts";
import type { TicketDemanda } from "../nucleo/agregado_demanda.ts";
import { formatarTicketRef } from "../nucleo/demanda.ts";
import { Despacho, type MotivoDeRecusa, motivoDeRecusaDoItem, type SituacaoDoDespacho } from "../nucleo/despacho.ts";
import { ErroDeRegra, existe } from "../nucleo/erros.ts";
import { exigirEtapaConduzida } from "../nucleo/etapa.ts";
import { Endereco } from "../nucleo/item_de_trabalho.ts";
import type { EtapaTicket } from "../nucleo/primitivos.ts";
import { reservarTicket } from "../nucleo/reserva_ticket.ts";
import { escrever } from "../armazenamento/banco.ts";
import { comDemanda } from "../armazenamento/demandas.ts";
import { demandasParaDespacho, noSnapshot, trabalhosVivos } from "../armazenamento/despacho_demanda.ts";
import { anotar, noLog } from "../infra/registro.ts";
import { type Configuracao, limiteParalelismo } from "../armazenamento/servico.ts";
import type { ConducaoDeEtapa, DepsDaConducao } from "./etapas/conducao_de_etapa.ts";
import {
  ConducaoDeEncerrarDemanda,
  type OpcoesDoEncerramentoDaDemanda,
} from "./etapas/conducao_de_encerrar_demanda.ts";
import { ConducaoDeAjustarResultado } from "./etapas/conducao_de_ajustar_resultado.ts";
import { ConducaoDeEncerrarRodada } from "./etapas/conducao_de_encerrar_rodada.ts";
import { ConducaoDeImplementar, type OpcoesDaImplementacao } from "./etapas/conducao_de_implementar.ts";
import { ConducaoDePlanejar } from "./etapas/conducao_de_planejar.ts";
import { ConducaoDeResolverConflito } from "./etapas/conducao_de_resolver_conflito.ts";
import { ConducaoDeRevisarDemanda } from "./etapas/conducao_de_revisar_demanda.ts";
import { ConducaoDeRevisarRodada } from "./etapas/conducao_de_revisar_rodada.ts";
import { retomarFalhasDeInfraestrutura } from "./retomada_infraestrutura.ts";
import { instanteAtual } from "./relogio.ts";
import { iniciarRevisaoIntegral } from "./revisao_demanda.ts";
import { condutor } from "./trabalho/condutor.ts";

/** @testes tipo que o teste usa para montar a entrada */
export interface DepsDespacho {
  /** Coleta das verificações e limite do commit do `implementar` e do `resolver_conflito`; injetáveis nos testes. */
  implementacao?: OpcoesDaImplementacao;
  /** Substitui conduções nos testes que não sobem pi nem git. */
  conducoesSubstitutas?: (
    deps: DepsDaConducao,
  ) => Partial<Record<Exclude<EtapaTicket, "entender_e_desenhar">, ConducaoDeEtapa>>;
  /** Espera da verificação do PR no `encerrar_demanda`; injetável nos testes. */
  verificacao?: OpcoesDoEncerramentoDaDemanda["verificacao"];
}

/** Espera a etapa em segundo plano; o erro vai ao log, então a promessa devolvida nunca rejeita. */
const acompanhar = (fim: Promise<unknown>): Promise<void> => fim.then(() => undefined, noLog);

const depsDaConducaoDe = (banco: DatabaseSync, { timeoutMin }: Configuracao): DepsDaConducao => ({
  banco,
  limiteMin: timeoutMin,
  relogio: instanteAtual,
  condutor,
  registro: anotar,
});

/** As recusas do último ciclo, só em memória: o Auditor as vê por `GET /api/despacho`; o reinício as zera até o ciclo seguinte. */
let recusasDoUltimoCiclo: ReadonlyMap<Endereco, MotivoDeRecusa> = new Map();

/** Por que cada item parado no último ciclo não foi despachado. */
export const ultimasRecusas = (): ReadonlyMap<Endereco, MotivoDeRecusa> => recusasDoUltimoCiclo;

/** A situação lida num snapshot só: as demandas em andamento e os tickets com trabalho vivo. */
const situacaoDoDespacho = (banco: DatabaseSync): SituacaoDoDespacho =>
  noSnapshot(banco, () => ({ demandas: demandasParaDespacho(banco), vivos: trabalhosVivos(banco) }));

/**
 * Reserva o ticket e inicia a etapa dele. Chamada dentro de `escrever`: a recusa síncrona desfaz a reserva. A promessa
 * devolvida é da etapa em segundo plano (as revisões, que são `async`, recusam por ela).
 */
function iniciarEtapa(banco: DatabaseSync, c: Configuracao, t: TicketDemanda, deps: DepsDespacho): Promise<unknown> {
  exigirEtapaConduzida(t.etapa);
  const depsDaConducao = depsDaConducaoDe(banco, c);
  const CONDUCAO_DA_ETAPA: Record<Exclude<EtapaTicket, "entender_e_desenhar">, ConducaoDeEtapa> = {
    planejar: new ConducaoDePlanejar(depsDaConducao),
    implementar: new ConducaoDeImplementar(depsDaConducao, deps.implementacao),
    resolver_conflito: new ConducaoDeResolverConflito(depsDaConducao, deps.implementacao),
    revisar_rodada: new ConducaoDeRevisarRodada(depsDaConducao),
    revisar_demanda: new ConducaoDeRevisarDemanda(depsDaConducao),
    encerrar_rodada: new ConducaoDeEncerrarRodada(depsDaConducao),
    encerrar_demanda: new ConducaoDeEncerrarDemanda(depsDaConducao, { verificacao: deps.verificacao }),
    ajustar_resultado: new ConducaoDeAjustarResultado(depsDaConducao),
    ...deps.conducoesSubstitutas?.(depsDaConducao),
  };
  return CONDUCAO_DA_ETAPA[t.etapa].conduzir(Endereco.doTicket(t.demanda_id, t.ticket_id));
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
 * concluíram vai à revisão integral; (2) o Despacho escolhe o que roda, no que sobra do limite (o planejamento
 * reprovado é um ticket pronto como os outros). Devolve as etapas em segundo plano (nunca rejeitam); o ciclo não as espera.
 */
export function cicloDoDespacho(banco: DatabaseSync, c: Configuracao, deps: DepsDespacho = {}): Promise<void>[] {
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
  const { prontos, recusas } = new Despacho(limiteParalelismo(banco)).selecionar(situacaoDoDespacho(banco));
  recusasDoUltimoCiclo = recusas;
  return prontos.flatMap((t) => disparar(banco, () => iniciarEtapa(banco, c, t, deps)));
}

/**
 * "Executar agora": a mesma seleção e o mesmo limite global do ciclo, na mesma transação da reserva. O que o Despacho
 * recusa volta como `MotivoDeRecusa`, sem criar execução; duas tentativas seguidas geram uma só (a 2ª encontra o ticket
 * já em execução e lança). Aceito, devolve a etapa em segundo plano, que nunca rejeita.
 */
export function executarAgora(
  banco: DatabaseSync,
  ref: { demanda_id: string; ticket_id: number },
  c: Configuracao,
  deps: DepsDespacho = {},
): MotivoDeRecusa | Promise<void> {
  return escrever(banco, () => {
    const situacao = situacaoDoDespacho(banco);
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
    const { recusas } = new Despacho(limiteParalelismo(banco)).selecionar(situacao);
    const recusa = motivoDeRecusaDoItem(recusas, Endereco.doTicket(ref.demanda_id, ref.ticket_id));
    // Os outros prontos disputam as vagas livres no ciclo; quem executa agora só esbarra no limite cheio de execuções.
    if (recusa && !(recusa.tipo === "limite_de_paralelismo" && recusa.em_uso < recusa.limite)) return recusa;
    // Ensaio da reserva: sem recusa, diz por que a seleção ainda não escolheria o ticket (outro aberto vem antes, etapa fora do estado).
    // O agregado volta como veio, então nada é gravado; a reserva de verdade é a da etapa.
    comDemanda(banco, ref.demanda_id, (ag) => {
      reservarTicket(
        ag,
        { ticket_id: ref.ticket_id },
        FABRIQUINHA,
        { agora: new Date().toISOString() },
        predecessoras_pendentes.length === 0,
      );
      return ag;
    });
    return acompanhar(iniciarEtapa(banco, c, ticket, deps));
  });
}
