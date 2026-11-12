// A semeadura do ensaio de desempenho: os três volumes sintéticos, gravados no banco migrado pelas mesmas gravações da
// produção (o cadastro do projeto, `criarDemandaNova` com o agregado validado pelo schema do domínio e
// `comTrabalhosDoTicket`). Cada demanda anda uma trilha fixa de Etapas, cortada pelo estado dela, e as demandas se
// espalham pelos meses do volume: as mais recentes estão em andamento, as demais concluídas ou canceladas.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { AUDITOR, FABRIQUINHA } from "../../src/modulos/compartilhado/nucleo/vocabulario_do_sdlc/ator.ts";
import { Endereco } from "../../src/modulos/compartilhado/nucleo/vocabulario_do_sdlc/endereco.ts";
import type { ResultadoDaTentativa } from "../../src/modulos/compartilhado/nucleo/vocabulario_do_sdlc/resultado_da_tentativa.ts";
import type { EstadoTicket } from "../../src/modulos/compartilhado/nucleo/primitivos.ts";
import { encontrado } from "../../src/modulos/compartilhado/nucleo/erros.ts";
import { escrever, raizDo } from "../../src/modulos/compartilhado/armazenamento/banco.ts";
import type { EtapaTicket, NomeGate } from "../../src/modulos/etapas/catalogo.ts";
import { registrarProjeto } from "../../src/modulos/projeto/aplicacao/cadastro.ts";
import { criarDemandaNova } from "../../src/modulos/sdlc/armazenamento/demandas.ts";
import type { EstadoDemanda, EstadoRodada } from "../../src/modulos/sdlc/nucleo/ciclo_de_vida/ciclos.ts";
import { AgregadoDemanda } from "../../src/modulos/sdlc/nucleo/demanda/agregado_demanda.ts";
import { comTrabalhosDoTicket } from "../../src/modulos/trabalho_agentico/armazenamento/trabalho_agentico.ts";

export interface VolumeSintetico {
  nome: string;
  demandas: number;
  /** Os meses de histórico, contados para trás a partir de agora, por onde as demandas se espalham. */
  meses: number;
}

/** O médio tem o tamanho do banco real de novembro de 2026 (cerca de 300 demandas); o grande, dez vezes isso. */
export const VOLUMES_SINTETICOS: readonly VolumeSintetico[] = [
  { nome: "pequeno", demandas: 30, meses: 3 },
  { nome: "médio", demandas: 300, meses: 12 },
  { nome: "grande", demandas: 3000, meses: 24 },
];

/** O que as rotas medidas pedem pelo nome. */
export interface AlvosDasRotas {
  projeto: string;
  /** A demanda em execução mais recente: a que a página da demanda abre. */
  demandaEmExecucao: string;
  /** Uma sessão terminada da `demandaEmExecucao`: a que o Histórico mostra na prévia. */
  sessaoTerminada: string;
}

const PROJETOS = ["loja", "site", "app"] as const;

interface PassoDaTrilha {
  etapa: EtapaTicket;
  /** O passo é da rodada 1. */
  daRodada?: true;
  /** O Gate que decide o passo concluído. */
  gate?: NomeGate;
  /** A primeira Tentativa é reprovada e a segunda passa. */
  reprovadoUmaVez?: true;
  /** O passo concluído deixa um PR integrado: o da rodada ou o final da demanda. */
  pullRequest?: "da_rodada" | "final";
}

/** A trilha de uma demanda concluída, com uma rodada: a forma das demandas do banco real. */
const TRILHA_DA_DEMANDA: readonly PassoDaTrilha[] = [
  { etapa: "entender_e_desenhar", gate: "gate_demanda" },
  { etapa: "planejar", gate: "gate_planejamento" },
  { etapa: "implementar", daRodada: true, reprovadoUmaVez: true },
  { etapa: "revisar_rodada", daRodada: true, gate: "gate_revisao_rodada" },
  { etapa: "encerrar_rodada", daRodada: true, gate: "gate_pr", pullRequest: "da_rodada" },
  { etapa: "revisar_demanda", gate: "gate_revisao_demanda" },
  { etapa: "encerrar_demanda", pullRequest: "final" },
];

interface CorteDaTrilha {
  passosAndados: number;
  /** O estado do último passo andado; os anteriores estão concluídos. */
  estadoDoUltimoPasso: Extract<EstadoTicket, "concluido" | "em_execucao" | "cancelado">;
  /** O último passo, concluído, ainda espera a Decisão do Gate dele. */
  aguardaOGate?: true;
  /** O estado da rodada 1, quando a trilha chega a ela. */
  estadoDaRodada?: EstadoRodada;
}

type EstadoSemeado = Extract<
  EstadoDemanda,
  "concluida" | "cancelada" | "gate_demanda" | "gate_planejamento" | "em_execucao" | "revisar_demanda"
>;

const CORTE_DO_ESTADO: Record<EstadoSemeado, CorteDaTrilha> = {
  concluida: { passosAndados: 7, estadoDoUltimoPasso: "concluido", estadoDaRodada: "concluida" },
  cancelada: { passosAndados: 3, estadoDoUltimoPasso: "cancelado", estadoDaRodada: "implementar" },
  gate_demanda: { passosAndados: 1, estadoDoUltimoPasso: "concluido", aguardaOGate: true },
  gate_planejamento: { passosAndados: 2, estadoDoUltimoPasso: "concluido", aguardaOGate: true },
  em_execucao: { passosAndados: 3, estadoDoUltimoPasso: "em_execucao", estadoDaRodada: "implementar" },
  revisar_demanda: { passosAndados: 6, estadoDoUltimoPasso: "em_execucao", estadoDaRodada: "concluida" },
};

const ESTADOS_EM_ANDAMENTO: readonly EstadoSemeado[] = [
  "gate_demanda",
  "gate_planejamento",
  "em_execucao",
  "revisar_demanda",
];

const UM_DIA_MS = 86_400_000;
const INTERVALO_ENTRE_PASSOS_MS = 60 * 60_000;
const INTERVALO_ENTRE_TENTATIVAS_MS = 20 * 60_000;
const DURACAO_DA_TENTATIVA_MS = 15 * 60_000;

/** As mais recentes (10%, no mínimo 4) estão em andamento; das outras, uma em cada dez foi cancelada. */
function estadoDaDemanda(indice: number, totalDeDemandas: number): EstadoSemeado {
  const emAndamento = Math.max(4, Math.round(totalDeDemandas / 10));
  const indiceEmAndamento = indice - (totalDeDemandas - emAndamento);
  if (indiceEmAndamento >= 0)
    return encontrado(
      ESTADOS_EM_ANDAMENTO[indiceEmAndamento % ESTADOS_EM_ANDAMENTO.length],
      "estado fora da lista",
      "corrija a semeadura",
    );
  return indice % 10 === 9 ? "cancelada" : "concluida";
}

const instante = (milissegundos: number): string => new Date(milissegundos).toISOString();

interface TentativaSemeada {
  numero: number;
  processo: string;
  inicio: string;
  fim?: string;
  resultado?: ResultadoDaTentativa;
}

/** As Tentativas de um passo: a reprovada antes da que passa, a aberta do passo em execução, a interrompida do cancelado. */
function tentativasDoPasso(
  passo: PassoDaTrilha,
  estadoDoTicket: EstadoTicket,
  inicioDoPasso: number,
  processoDaTentativa: (numero: number) => string,
): TentativaSemeada[] {
  const resultados: (ResultadoDaTentativa | undefined)[] =
    estadoDoTicket === "em_execucao"
      ? [undefined]
      : estadoDoTicket === "cancelado"
        ? [{ tipo: "interrompida", por: AUDITOR, motivo: "demanda cancelada" }]
        : passo.reprovadoUmaVez
          ? [{ tipo: "reprovacao", motivo: "corrija o teste" }, { tipo: "sucesso" }]
          : [{ tipo: "sucesso" }];
  return resultados.map((resultado, posicao) => {
    const inicio = inicioDoPasso + posicao * INTERVALO_ENTRE_TENTATIVAS_MS;
    return {
      numero: posicao + 1,
      processo: processoDaTentativa(posicao + 1),
      inicio: instante(inicio),
      ...(resultado && { fim: instante(inicio + DURACAO_DA_TENTATIVA_MS), resultado }),
    };
  });
}

interface DemandaSemeada {
  id: string;
  estado: EstadoSemeado;
  tentativasPorTicket: Map<number, TentativaSemeada[]>;
}

/** Grava a demanda de índice `indice`, que começa em `inicio`, com o agregado validado pelo schema do domínio. */
function semearDemanda(
  banco: DatabaseSync,
  indice: number,
  totalDeDemandas: number,
  inicio: number,
  numeroDoProximoPr: () => number,
): DemandaSemeada {
  const estado = estadoDaDemanda(indice, totalDeDemandas);
  const corte = CORTE_DO_ESTADO[estado];
  const projeto = encontrado(PROJETOS[indice % PROJETOS.length], "projeto fora da lista", "corrija a semeadura");
  const tentativasPorTicket = new Map<number, TentativaSemeada[]>();
  const agregado = criarDemandaNova(banco, (id) => {
    const passos = TRILHA_DA_DEMANDA.slice(0, corte.passosAndados).map((passo, posicao) => {
      const ticket_id = posicao + 1;
      const ehUltimo = ticket_id === corte.passosAndados;
      const estadoDoTicket: EstadoTicket = ehUltimo ? corte.estadoDoUltimoPasso : "concluido";
      const tentativas = tentativasDoPasso(
        passo,
        estadoDoTicket,
        inicio + posicao * INTERVALO_ENTRE_PASSOS_MS,
        (numero) => `processo-${id}-T${String(ticket_id)}-${String(numero)}`,
      );
      tentativasPorTicket.set(ticket_id, tentativas);
      const ultimaTentativa = encontrado(tentativas.at(-1), "passo sem Tentativa", "corrija a semeadura");
      const decidido = estadoDoTicket === "concluido" && !(ehUltimo && corte.aguardaOGate);
      return {
        passo,
        ticket_id,
        estadoDoTicket,
        tentativas,
        terminouEm: ultimaTentativa.fim ?? ultimaTentativa.inicio,
        decidido,
      };
    });
    const ultimoInstante = encontrado(passos.at(-1), "demanda sem passo", "corrija a semeadura").terminouEm;
    const pullRequests = passos.flatMap(({ passo, estadoDoTicket, terminouEm }) =>
      passo.pullRequest && estadoDoTicket === "concluido"
        ? [
            {
              numero: numeroDoProximoPr(),
              url: `https://github.com/exemplo/${projeto}/pull/${String(indice)}`,
              head: indice.toString(16).padStart(40, "0"),
              estado: "integrado" as const,
              atualizado_em: terminouEm,
              ...(passo.pullRequest === "da_rodada" && { rodada_id: 1 }),
            },
          ]
        : [],
    );
    return AgregadoDemanda.parse({
      demanda: {
        id,
        projeto,
        titulo: `Demanda sintética ${String(indice + 1)}`,
        tipo: indice % 3 === 0 ? "problema" : "funcionalidade",
        descricao: "Demanda do ensaio de desempenho.",
        estado,
        estado_alterado_em: ultimoInstante,
        criada_por: { tipo: "externo", ferramenta: "claude", sessao: `ensaio-${id}` },
        enviada: true,
        branch: `fabriquinha/${id}`,
      },
      tickets: passos.map(({ passo, ticket_id, estadoDoTicket, terminouEm }) => ({
        demanda_id: id,
        ticket_id,
        etapa: passo.etapa,
        estado: estadoDoTicket,
        estado_alterado_em: terminouEm,
        criado_por: FABRIQUINHA,
        ...(passo.daRodada && { rodada_id: 1 }),
      })),
      decisoes: passos.flatMap(({ passo, ticket_id, decidido, terminouEm }) =>
        passo.gate && decidido
          ? [
              {
                demanda_id: id,
                ticket_id,
                decisao_id: 1,
                gate: passo.gate,
                resultado: "aprovado",
                nota: 4,
                por: AUDITOR,
                em: terminouEm,
              },
            ]
          : [],
      ),
      evidencias: [
        {
          demanda_id: id,
          tipo: "desenho_solucao",
          dados: {
            resumo: "Desenho sintético.",
            arquivosPrevistos: [{ caminho: "src/a.ts", acao: "alterar", motivo: "ensaio" }],
            foraDeEscopo: [],
          },
          autor: { tipo: "externo", ferramenta: "claude", sessao: `ensaio-${id}` },
          em: instante(inicio),
        },
      ],
      rodadas: corte.estadoDaRodada
        ? [
            {
              demanda_id: id,
              rodada_id: 1,
              titulo: "rodada 1",
              estado: corte.estadoDaRodada,
              estado_alterado_em: ultimoInstante,
              e2e: false,
              branch: `fabriquinha/${id}-1`,
            },
          ]
        : [],
      tentativas: passos.flatMap(({ ticket_id, tentativas }) =>
        tentativas.map(({ processo, ...tentativa }) => ({
          ...tentativa,
          ticket: Endereco.doTicket(id, ticket_id),
          processo_id: processo,
        })),
      ),
      pull_requests: pullRequests,
    });
  });
  return { id: agregado.demanda.id, estado, tentativasPorTicket };
}

/** Uma sessão por ticket, um processo por Tentativa e o uso de um modelo por processo. */
function semearTrabalhosDaDemanda(banco: DatabaseSync, { id, tentativasPorTicket }: DemandaSemeada): void {
  for (const [ticket_id, tentativas] of tentativasPorTicket) {
    const sessao = `sessao-${id}-T${String(ticket_id)}`;
    comTrabalhosDoTicket(banco, { demanda_id: id, ticket_id }, (trabalhos) => ({
      sessoes: [
        ...trabalhos.sessoes,
        { demanda_id: id, ticket_id, id: sessao, modo: "autonomo", conversa_referencia: sessao },
      ],
      execucoes: [
        ...trabalhos.execucoes,
        ...tentativas.map((tentativa) => ({
          id: tentativa.processo,
          trabalho_id: sessao,
          inicio: tentativa.inicio,
          fim: tentativa.fim ?? null,
          falha: tentativa.resultado !== undefined && tentativa.resultado.tipo !== "sucesso",
        })),
      ],
      usos: [
        ...trabalhos.usos,
        ...tentativas.map((tentativa) => ({
          execucao_id: tentativa.processo,
          modelo_provedor: "anthropic",
          modelo_nome: "claude-sonnet-5",
          tokens_entrada: 12_000,
          tokens_saida: 3_000,
          tokens_cache_leitura: 40_000,
          tokens_cache_escrita: 2_000,
          custo: 0.25,
        })),
      ],
    }));
  }
}

/**
 * Semeia o `volume` no banco migrado, numa transação só: os três projetos (sem repositório git: as rotas medidas não o
 * leem) e as demandas, uma a cada `meses / demandas` do histórico, a última um dia antes de `agora`.
 */
export function semearVolume(banco: DatabaseSync, volume: VolumeSintetico, agora: Date): AlvosDasRotas {
  return escrever(banco, () => {
    for (const nome of PROJETOS)
      registrarProjeto(banco, {
        nome,
        raiz_git: `/repos/${nome}`,
        branch_base: "main",
        hospedagem: "github",
        chave_sonarqube: nome,
      });
    const intervaloEntreDemandas = (volume.meses * 30 * UM_DIA_MS) / volume.demandas;
    const inicioDaUltima = agora.getTime() - UM_DIA_MS;
    let ultimoPr = 0;
    const demandas = Array.from({ length: volume.demandas }, (_, indice) => {
      const inicio = inicioDaUltima - (volume.demandas - 1 - indice) * intervaloEntreDemandas;
      const demanda = semearDemanda(banco, indice, volume.demandas, inicio, () => ++ultimoPr);
      semearTrabalhosDaDemanda(banco, demanda);
      return demanda;
    });
    const demandaEmExecucao = encontrado(
      demandas.findLast((demanda) => demanda.estado === "em_execucao"),
      "volume sem demanda em execução",
      "corrija a semeadura",
    ).id;
    const sessaoTerminada = `sessao-${demandaEmExecucao}-T1`;
    gravarConversaDaSessao(raizDo(banco), sessaoTerminada);
    return { projeto: "loja", demandaEmExecucao, sessaoTerminada };
  });
}

/** A conversa da sessão onde o pi a grava (`<raiz>/sessoes/<sessao>/<instante>_<sessao>.jsonl`): só o chat a lê. */
function gravarConversaDaSessao(raiz: string, sessao: string): void {
  const pasta = join(raiz, "sessoes", sessao);
  mkdirSync(pasta, { recursive: true });
  const mensagem = (role: string, text: string) =>
    JSON.stringify({ type: "message", message: { role, content: [{ type: "text", text }] } });
  writeFileSync(
    join(pasta, `2026-01-01T00-00-00-000Z_${sessao}.jsonl`),
    `${mensagem("user", "entenda a demanda")}\n${mensagem("assistant", "desenho submetido")}\n`,
  );
}
