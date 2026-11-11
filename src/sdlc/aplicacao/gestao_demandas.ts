// Gestão de Demandas na camada de aplicação (comparacao-sdlc-implementacao.md §6): registrar, editar, dependência,
// evidência, enviar e arquivar, uma transação por operação. A web e o CLI chamam estas funções; as regras são do domínio.
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { AUDITOR, type Ator } from "../nucleo/ator.ts";
import type { AgregadoDemanda, TicketDemanda } from "../nucleo/demanda/agregado_demanda.ts";
import { arquivarDemanda, cancelarDemanda } from "../nucleo/ciclo_de_vida/cancelamento_demanda.ts";
import { CICLO_DA_DEMANDA } from "../nucleo/ciclo_de_vida/ciclos.ts";
import { registrarDependencia } from "../nucleo/item_de_trabalho/dependencia_demanda.ts";
import { ErroDeRegra, existe } from "../../compartilhado/nucleo/erros.ts";
import { exigirAutoria } from "../../qualidade/nucleo/evidencias/evidencia.ts";
import { TIPOS_DA_DEMANDA } from "../../etapas/entender_e_desenhar/definicao.ts";
import { Endereco } from "../nucleo/item_de_trabalho/item_de_trabalho.ts";
import type { Relogio } from "../../compartilhado/nucleo/relogio.ts";
import { CustosRealizados } from "../../qualidade/nucleo/evidencias/schemas.ts";
import {
  type ContextoDemanda,
  editarDemanda,
  enviarDemanda,
  reabrirTicket,
  registrarDemanda,
} from "../nucleo/transicoes/transicoes_demanda.ts";
import { escrever } from "../../compartilhado/armazenamento/banco.ts";
import { carregarDemanda, comDemanda, criarDemandaNova, situacaoDasDemandas } from "../armazenamento/demandas.ts";
import {
  arestasDeDependencia,
  demandaParaDependencia,
  gravarDependenciaDemanda,
} from "../armazenamento/dependencias_demanda.ts";
import { projetoExistente } from "../../projeto/armazenamento/projetos.ts";
import { gravarUsoDeclarado } from "../../custos/armazenamento/uso_declarado.ts";
import { submeterEvidencia as submeterEvidenciaAvaliada } from "../../qualidade/aplicacao/evidencias/submeter.ts";
import type { Origens } from "../../qualidade/aplicacao/evidencias/submissao.ts";
import { cancelandoEmCascata } from "./gates/cancelamento_em_cascata.ts";

/** `arquivos` são caminhos: abrir cada um, com a defesa de origem, é de `guardarAnexos`. */
const EntradaEvidencia = z.object({
  tipo: z.enum(TIPOS_DA_DEMANDA),
  dados: z.unknown(),
  rodada_id: z.number().int().positive().optional(),
  arquivos: z.array(z.string()).default([]),
});
/** @testes tipo que o teste usa para montar a entrada */
export type EntradaEvidencia = z.input<typeof EntradaEvidencia>;

type EntradaRegistro = { dependencias?: string[] } & Record<string, unknown>;

const campos = (issues: readonly z.core.$ZodIssue[], prefixo: string[] = []): string =>
  issues.map((i) => `${[...prefixo, ...i.path.map(String)].join(".")}: ${i.message}`).join("; ");

/** O `ZodError` das entradas vira ErroDeRegra com o campo e a correção (CA-18). */
function traduzir<T>(trabalho: () => T): T {
  try {
    return trabalho();
  } catch (erro) {
    if (!(erro instanceof z.ZodError)) throw erro;
    throw new ErroDeRegra(campos(erro.issues), "corrija o campo indicado e tente de novo");
  }
}

/** Registra `demandaId` como dependente de `dependeId`; as duas precisam existir e a regra recusa envio, repetição e ciclo. */
export const registrarDependenciaDemanda = (banco: DatabaseSync, demandaId: string, dependeId: string): void => {
  escrever(banco, () => {
    const demanda = demandaParaDependencia(banco, demandaId);
    demandaParaDependencia(banco, dependeId);
    gravarDependenciaDemanda(banco, registrarDependencia(arestasDeDependencia(banco), demanda, dependeId));
  });
};

/** CA-1 e CA-2: cria a demanda com o ID da sequência e as dependências; qualquer erro desfaz tudo, ID incluído. */
export const registrar = (
  banco: DatabaseSync,
  entrada: EntradaRegistro,
  autor: Ator,
  ctx: ContextoDemanda,
): AgregadoDemanda =>
  traduzir(() =>
    escrever(banco, () => {
      const { dependencias = [], ...dados } = entrada;
      projetoExistente(banco, String(dados.projeto));
      const demanda = criarDemandaNova(banco, (id) => registrarDemanda({ ...dados, id }, autor, ctx));
      for (const dependeId of dependencias) registrarDependenciaDemanda(banco, demanda.demanda.id, dependeId);
      return demanda;
    }),
  );

export const editar = (banco: DatabaseSync, id: string, entrada: unknown, autor: Ator): AgregadoDemanda =>
  traduzir(() => comDemanda(banco, id, (ag) => editarDemanda(ag, entrada, autor)));

export const enviar = (banco: DatabaseSync, id: string, autor: Ator, ctx: ContextoDemanda): AgregadoDemanda =>
  traduzir(() => comDemanda(banco, id, (ag) => enviarDemanda(ag, autor, ctx)));

export const arquivar = (banco: DatabaseSync, id: string, ator: Ator, ctx: ContextoDemanda): AgregadoDemanda =>
  traduzir(() => comDemanda(banco, id, (ag) => arquivarDemanda(ag, ator, ctx)));

/** Arquivar concluídas: cada demanda concluída do projeto, uma transação por demanda, como o Arquivar da demanda. */
export const arquivarConcluidas = (
  banco: DatabaseSync,
  projeto: string,
  relogio: Relogio,
  orientacaoProjetoInexistente: string,
): { arquivadas: number } => {
  projetoExistente(banco, projeto, orientacaoProjetoInexistente);
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
  const ag = traduzir(() =>
    comDemanda(banco, demandaId, (a) => reabrirTicket(a, entrada, ator, { agora: relogio.agora() })),
  );
  return existe(
    ag.tickets.find((t) => t.ticket_id === entrada.ticket_id),
    "ticket não encontrado",
    "confira o endereço",
  );
};

/** CA-21 a CA-26: só o Auditor, até a integração confirmada; o histórico fica intacto e as dependentes saem junto (D08). */
export const cancelar = (
  banco: DatabaseSync,
  id: string,
  ator: Ator,
  ctx: ContextoDemanda,
): { demanda: AgregadoDemanda; canceladas: string[] } =>
  traduzir(() => cancelandoEmCascata(banco, id, ator, ctx, (ag) => cancelarDemanda(ag, ator, ctx)));

/**
 * CA-8 a CA-12 e CA-15: a submissão segue o caminho único de evidência (Avaliador, guarda dos anexos e gravação);
 * a recusa vira ErroDeRegra. `avisos` segue na resposta do CLI externo e hoje vai sempre vazio.
 */
export const submeterEvidencia = (
  banco: DatabaseSync,
  id: string,
  entrada: EntradaEvidencia,
  autor: Ator,
  origens: Origens,
): { demanda: AgregadoDemanda; avisos: string[] } =>
  traduzir(() => {
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
