// Gestão de Demandas na camada de aplicação (comparacao-sdlc-implementacao.md §6): o lado do processo no registro e no
// envio do pedido, evidência, arquivar, reabrir e o Uso declarado, uma transação por operação. O registro, a edição, o
// envio e o cancelamento do pedido são dos Pedidos (Demandas), e os fluxos do servidor os coordenam com estas funções.
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { type Ator, AUDITOR, Endereco, TIPOS_DA_DEMANDA } from "../../etapas/publico.ts";
import type { AgregadoDemanda, TicketDemanda } from "../nucleo/agregado/agregado_demanda.ts";
import { arquivarDemanda } from "../nucleo/transicoes/cancelamento_demanda.ts";
import { CICLO_DA_DEMANDA } from "../nucleo/ciclos/ciclos.ts";
import { ErroDeRegra, existe } from "../../../../shared/nucleo/erros.ts";
import { CustosRealizados, exigirAutoria, type Origens } from "../../evidencias/publico.ts";
import type { Relogio } from "../../../../shared/nucleo/relogio.ts";
import {
  type ContextoDemanda,
  enviarDemanda,
  reabrirTicket,
  registrarDemanda,
} from "../nucleo/transicoes/transicoes_demanda.ts";
import { escrever } from "../../../../shared/armazenamento/banco.ts";
import {
  carregarDemanda,
  comDemanda,
  gravarDemandaNova,
  situacaoDasDemandas,
} from "../armazenamento/agregado_da_demanda.ts";
import { gravarUsoDeclarado } from "../../../sessoes/publico.ts";
import { submeterEvidencia as submeterEvidenciaAvaliada } from "./submissao_de_evidencia.ts";

/** `arquivos` são caminhos: abrir cada um, com a defesa de origem, é de `guardarAnexos`. */
const EntradaEvidencia = z.object({
  tipo: z.enum(TIPOS_DA_DEMANDA),
  dados: z.unknown(),
  rodada_id: z.number().int().positive().optional(),
  arquivos: z.array(z.string()).default([]),
});
/** @testes tipo que o teste usa para montar a entrada */
export type EntradaEvidencia = z.input<typeof EntradaEvidencia>;

const campos = (issues: readonly z.core.$ZodIssue[], prefixo: string[] = []): string =>
  issues.map((i) => `${[...prefixo, ...i.path.map(String)].join(".")}: ${i.message}`).join("; ");

/** O `ZodError` das entradas vira ErroDeRegra com o campo e a correção (CA-18). */
export function comCampoInvalidoComoErroDeRegra<T>(operacaoQueValidaAEntrada: () => T): T {
  try {
    return operacaoQueValidaAEntrada();
  } catch (erro) {
    if (!(erro instanceof z.ZodError)) throw erro;
    throw new ErroDeRegra(campos(erro.issues), "corrija o campo indicado e tente de novo");
  }
}

/** O conteúdo do pedido e quem o registrou, como o processo o recebe de Demandas. */
interface PedidoRecebido {
  readonly id: string;
  readonly projeto: string;
  readonly titulo: string;
  readonly tipo: string;
  readonly descricao: string;
  readonly criada_por: Ator;
}

/**
 * CA-1: o processo do pedido recém-registrado, no estado da primeira Etapa, com o ticket 1 dela; grava a linha da demanda
 * com o conteúdo do pedido. Roda na unidade de trabalho do fluxo do registro, que alocou o ID do pedido.
 */
export const criarProcessoDoPedido = (
  banco: DatabaseSync,
  pedido: PedidoRecebido,
  ctx: ContextoDemanda,
): AgregadoDemanda => {
  const { id, projeto, titulo, tipo, descricao, criada_por } = pedido;
  return gravarDemandaNova(banco, registrarDemanda({ id, projeto, titulo, tipo, descricao }, criada_por, ctx));
};

/** CA-2 e CA-3: sem as obrigatórias recusa listando todas; completa, o processo vai ao Gate da demanda. */
export const levarAoGateDaDemanda = (
  banco: DatabaseSync,
  id: string,
  autor: Ator,
  ctx: ContextoDemanda,
): AgregadoDemanda =>
  comCampoInvalidoComoErroDeRegra(() => comDemanda(banco, id, (ag) => enviarDemanda(ag, autor, ctx)));

export const arquivar = (banco: DatabaseSync, id: string, ator: Ator, ctx: ContextoDemanda): AgregadoDemanda =>
  comCampoInvalidoComoErroDeRegra(() => comDemanda(banco, id, (ag) => arquivarDemanda(ag, ator, ctx)));

/**
 * Arquivar concluídas: cada demanda concluída do projeto, uma transação por demanda, como o Arquivar da demanda. Que o
 * projeto existe, quem chama confere em Demandas.
 */
export const arquivarConcluidas = (banco: DatabaseSync, projeto: string, relogio: Relogio): { arquivadas: number } => {
  const concluidas = situacaoDasDemandas(banco, projeto).filter((d) => d.estado === "concluida");
  for (const { id } of concluidas) arquivar(banco, id, AUDITOR, { agora: relogio.agora() });
  return { arquivadas: concluidas.length };
};

/** Só o Auditor reabre o ticket falho, com a instrução para a sessão que o retomar; devolve o ticket já aberto. */
export const reabrir = (
  banco: DatabaseSync,
  demandaId: string,
  entrada: { ticket_id: number; instrucao: string },
  ator: Ator,
  relogio: Relogio,
): TicketDemanda => {
  const ag = comCampoInvalidoComoErroDeRegra(() =>
    comDemanda(banco, demandaId, (a) => reabrirTicket(a, entrada, ator, { agora: relogio.agora() })),
  );
  return existe(
    ag.tickets.find((t) => t.ticket_id === entrada.ticket_id),
    "ticket não encontrado",
    "confira o endereço",
  );
};

/**
 * CA-8 a CA-12 e CA-15: a submissão segue o caminho único de evidência (Avaliador, guarda dos anexos e gravação);
 * a recusa vira ErroDeRegra. `avisos` segue na resposta do CLI externo e hoje vai sempre vazio.
 */
export const submeterEvidenciaDaEntradaExterna = (
  banco: DatabaseSync,
  id: string,
  entrada: EntradaEvidencia,
  autor: Ator,
  origens: Origens,
): { demanda: AgregadoDemanda; avisos: string[] } =>
  comCampoInvalidoComoErroDeRegra(() => {
    const { tipo, dados, arquivos, rodada_id } = EntradaEvidencia.parse(entrada);
    const dono = rodada_id === undefined ? Endereco.daDemanda(id) : Endereco.daRodada(id, rodada_id);
    const submissao = { tipo, dono, produtor: autor, dados, anexos: arquivos };
    escrever(banco, () => {
      const avaliacao = submeterEvidenciaAvaliada(banco, submissao, { origens });
      if (avaliacao.resultado === "recusada") throw new ErroDeRegra(avaliacao.motivo, "corrija e submeta de novo");
    });
    return { demanda: carregarDemanda(banco, id), avisos: [] };
  });

/**
 * O Uso declarado de sessões da ferramenta externa (D10): vale até a demanda terminar, mesmo depois do envio. A sessão
 * que outra demanda já informou não é contada de novo e vira aviso; informar de novo a da própria demanda troca as linhas.
 */
export const declararUso = (banco: DatabaseSync, id: string, dados: unknown, autor: Ator): { avisos: string[] } => {
  const entrada = CustosRealizados.safeParse(dados);
  if (!entrada.success)
    throw new ErroDeRegra(campos(entrada.error.issues), "corrija o campo indicado e submeta de novo");
  return escrever(banco, () => {
    const { demanda } = carregarDemanda(banco, id);
    if (CICLO_DA_DEMANDA.ehTerminal(demanda.estado)) {
      throw new ErroDeRegra(`a demanda ${id} já terminou (${demanda.estado})`, "o Uso declarado vale até a conclusão");
    }
    if (!demanda.enviada) exigirAutoria(demanda, autor, "declarar o Uso da");
    const avisos: string[] = [];
    for (const { ferramenta, sessao, linhas } of entrada.data.sessoes) {
      const uso = {
        ferramenta,
        sessao,
        demanda_id: id,
        // A ferramenta externa não informa `chamadas`.
        linhas: linhas.map(({ provedor, modelo, ...numeros }) => ({
          modelo: `${provedor}/${modelo}`,
          ...numeros,
          chamadas: 0,
        })),
      };
      const { demandaDona } = gravarUsoDeclarado(banco, uso);
      if (demandaDona !== id) {
        avisos.push(
          `a sessão ${sessao} de ${ferramenta} já consta na demanda ${demandaDona} e não é contada de novo para ${id}`,
        );
      }
    }
    return { avisos };
  });
};
