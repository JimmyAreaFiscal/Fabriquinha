// Trabalho Agêntico, processo do trabalho e uso por modelo (comparacao-sdlc-implementacao.md §7.3). Funções puras sobre
// arrays: quem chama persiste o resultado. `ProcessoDoTrabalho` registra uma execução do pi dentro do trabalho.
import { z } from "zod";
import { ConfiguracaoAgente } from "./configuracao_agente.ts";
import { TicketRef } from "./demanda.ts";
import { ErroDeRegra } from "./erros.ts";
import { Id, Instante, Slug } from "./primitivos.ts";

export const ModoTrabalho = z.enum(["autonomo", "interativo", "consulta"]);
export type ModoTrabalho = z.infer<typeof ModoTrabalho>;

const IdTexto = z.string().trim().min(1);
const Tokens = z.number().int().nonnegative();

/** O trabalho de uma ferramenta de fora da Fabriquinha: a ferramenta e a sessão dela. */
export const TrabalhoNaoGerenciado = z.object({ ferramenta: Slug, sessao: z.string().min(1) });

export const TrabalhoGerenciado = TicketRef.extend({
  id: IdTexto,
  modo: ModoTrabalho,
  conversa_referencia: IdTexto,
});

export const ProcessoDoTrabalho = z.object({
  id: IdTexto,
  trabalho_id: IdTexto,
  inicio: Instante,
  fim: Instante.nullish(),
  /** Só vale com `fim`: false é sucesso, true é falha. */
  falha: z.boolean(),
  /** Grupo de processo do pi, para o reinício do serviço interrompê-lo. */
  grupo_processo: Id.optional(),
  /** Modelo e effort efetivos (resolverConfiguracaoAgente). */
  configuracao_agente: ConfiguracaoAgente.optional(),
});

/** Tokens e custo pertencem ao uso do processo, nunca ao trabalho. `custo` ausente é desconhecido, não zero. */
export const UsoModeloExecucao = z.object({
  execucao_id: IdTexto,
  modelo_provedor: IdTexto,
  modelo_nome: IdTexto,
  tokens_entrada: Tokens,
  tokens_saida: Tokens,
  tokens_cache_leitura: Tokens,
  tokens_cache_escrita: Tokens,
  custo: z.number().nonnegative().optional(),
});

export type TrabalhoGerenciado = z.infer<typeof TrabalhoGerenciado>;
export type ProcessoDoTrabalho = z.infer<typeof ProcessoDoTrabalho>;
export type UsoModeloExecucao = z.infer<typeof UsoModeloExecucao>;

export const criarTrabalho = (
  sessoes: readonly TrabalhoGerenciado[],
  nova: TrabalhoGerenciado,
): TrabalhoGerenciado[] => {
  const sessao = TrabalhoGerenciado.parse(nova);
  if (sessoes.some((s) => s.id === sessao.id)) throw new ErroDeRegra(`sessão ${sessao.id} já existe`, "use outro id");
  return [...sessoes, sessao];
};

/** Fim null ou omitido é execução não encerrada. */
const aberta = (e: ProcessoDoTrabalho): boolean => e.fim == null;

const abrir = (
  sessoes: readonly TrabalhoGerenciado[],
  execucoes: readonly ProcessoDoTrabalho[],
  nova: ProcessoDoTrabalho,
  retomada: boolean,
) => {
  const exec = ProcessoDoTrabalho.parse(nova);
  const daSessao = execucoes.filter((e) => e.trabalho_id === exec.trabalho_id);
  if (!sessoes.some((s) => s.id === exec.trabalho_id)) throw new ErroDeRegra(`sessão ${exec.trabalho_id} não existe`);
  if (retomada && daSessao.length === 0)
    throw new ErroDeRegra(`sessão ${exec.trabalho_id} não tem execução a retomar`, "inicie uma");
  if (execucoes.some((e) => e.id === exec.id)) throw new ErroDeRegra(`execução ${exec.id} já existe`, "use outro id");
  if (daSessao.some(aberta))
    throw new ErroDeRegra(`sessão ${exec.trabalho_id} já tem execução sem fim`, "encerre-a antes");
  return [...execucoes, exec];
};

export const iniciarProcesso = (
  sessoes: readonly TrabalhoGerenciado[],
  execucoes: readonly ProcessoDoTrabalho[],
  nova: ProcessoDoTrabalho,
) => abrir(sessoes, execucoes, nova, false);

/** Execução nova (id distinto) na mesma sessão; `conversa_referencia` fica na sessão, que não muda. */
export const retomarTrabalho = (
  sessoes: readonly TrabalhoGerenciado[],
  execucoes: readonly ProcessoDoTrabalho[],
  nova: ProcessoDoTrabalho,
) => abrir(sessoes, execucoes, nova, true);

export const encerrarProcesso = (
  execucoes: readonly ProcessoDoTrabalho[],
  id: string,
  fim: string,
  falha: boolean,
): ProcessoDoTrabalho[] => {
  const alvo = execucoes.find((e) => e.id === id);
  if (!alvo) throw new ErroDeRegra(`execução ${id} não existe`);
  if (!aberta(alvo)) throw new ErroDeRegra(`execução ${id} já foi encerrada`);
  const encerrada = ProcessoDoTrabalho.parse({ ...alvo, fim, falha });
  return execucoes.map((e) => (e.id === id ? encerrada : e));
};

const mesmaChave = (a: UsoModeloExecucao, b: UsoModeloExecucao): boolean =>
  a.execucao_id === b.execucao_id && a.modelo_provedor === b.modelo_provedor && a.modelo_nome === b.modelo_nome;

/** Registrar de novo a mesma chave substitui o uso, não soma. */
export const registrarUso = (usos: readonly UsoModeloExecucao[], uso: UsoModeloExecucao): UsoModeloExecucao[] => {
  const novo = UsoModeloExecucao.parse(uso);
  return [...usos.filter((u) => !mesmaChave(u, novo)), novo];
};

/**
 * Soma o uso à mesma chave, em vez de substituí-lo: a consulta gasta tokens na execução que a pediu, e a coleta do fim
 * da execução não pode apagar o que a consulta já registrou. A parcela sem custo deixa o total sem custo, como na
 * coleta (parcial fica desconhecido, nunca zero).
 */
export const acumularUso = (usos: readonly UsoModeloExecucao[], uso: UsoModeloExecucao): UsoModeloExecucao[] => {
  const novo = UsoModeloExecucao.parse(uso);
  const anterior = usos.find((u) => mesmaChave(u, novo));
  if (!anterior) return [...usos, novo];
  const { custo: custoAnterior, ...tokensAnteriores } = anterior;
  return registrarUso(usos, {
    ...tokensAnteriores,
    tokens_entrada: anterior.tokens_entrada + novo.tokens_entrada,
    tokens_saida: anterior.tokens_saida + novo.tokens_saida,
    tokens_cache_leitura: anterior.tokens_cache_leitura + novo.tokens_cache_leitura,
    tokens_cache_escrita: anterior.tokens_cache_escrita + novo.tokens_cache_escrita,
    ...(custoAnterior !== undefined && novo.custo !== undefined && { custo: custoAnterior + novo.custo }),
  });
};
