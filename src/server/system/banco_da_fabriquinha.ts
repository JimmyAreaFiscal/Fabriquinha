// O banco da Fabriquinha com as migrações dos domínios (MELHORIAS §5.1.6): o histórico congelado do shared e, depois dele,
// as que cada domínio registra. Todo processo que abre o banco (serviço, CLI, testes) passa por aqui: quem abrisse sem as
// migrações dos domínios acharia o banco numa versão mais nova que a que conhece. Por isso é aqui também que a composição
// monta o Ciclo de Vida com o que ele lê de Demandas como dado: os projetos cadastrados, o conteúdo dos pedidos, as
// predecessoras pendentes (MELHORIAS §11, regra 2) e o fluxo da conclusão do desenvolvimento, que conclui o pedido em
// Demandas junto do encerramento do processo.
import type { DatabaseSync } from "node:sqlite";
import { abrir, enfileirarDepoisDoHistorico, migrar } from "../../shared/armazenamento/banco.ts";
import { VERSAO_LINHA_DE_BASE } from "../../shared/armazenamento/migracoes/migracoes.ts";
import { MIGRACOES_DA_CONFIGURACAO_DO_AMBIENTE } from "../../shared/armazenamento/configuracao_do_ambiente.ts";
import { MIGRACOES_DE_DEMANDAS } from "../../shared/armazenamento/migracoes/migracoes_de_demandas.ts";
import { MIGRACOES_DE_SESSOES } from "../../shared/armazenamento/migracoes/migracoes_de_sessoes.ts";
import { MIGRACOES_DO_CICLO_DE_VIDA } from "../../shared/armazenamento/migracoes/migracoes_do_ciclo_de_vida.ts";
import { ErroDeRegra } from "../../shared/nucleo/erros.ts";
import { type Modelo, montarSessoesDeAgente } from "../../modulos/sessoes/publico.ts";
import {
  type CicloDeVida,
  type DemandasDoCicloDeVida,
  type MontagemDoCicloDeVida,
  montarCicloDeVida,
} from "../../modulos/ciclo_de_vida/publico.ts";
import { type GestaoDeDemandas, montarGestaoDeDemandas } from "../../modulos/demandas/publico.ts";
import { montarRepositorio } from "../../modulos/repositorio/publico.ts";

/**
 * Recusa o par provedor/modelo que não está entre os `modelos` que o harness das Sessões conhece.
 * @testes os testes conferem com o harness do teste
 */
export async function conferirModeloNaLista(modelos: Promise<Modelo[]>, { provedor, nome }: Modelo): Promise<void> {
  if (!(await modelos).some((m) => m.provedor === provedor && m.nome === nome)) {
    throw new ErroDeRegra(
      `o modelo ${provedor}/${nome} não existe no pi`,
      "escolha um par listado por pi --list-models",
    );
  }
}

/**
 * A gestão de Demandas sobre o `banco`, com a conferência do modelo pelos modelos de Sessões (lidos na hora da conferência).
 * ponytail: a gestão só guarda o banco, a conferência e o Repositório sem a varredura, então montá-la a cada leitura ligada ao Ciclo de Vida não custa;
 * montar uma por banco quando a gestão guardar estado.
 */
export const montarDemandasDoBanco = (banco: DatabaseSync): GestaoDeDemandas =>
  montarGestaoDeDemandas({
    banco,
    conferirModeloNoHarness: (modelo) => conferirModeloNaLista(montarSessoesDeAgente({ banco }).modelos(), modelo),
    repositorio: montarRepositorio({ banco }),
  });

/** O que o Ciclo de Vida lê de Demandas sobre o `banco`: o projeto, os pedidos, as predecessoras pendentes e a conclusão. */
export const demandasDoCicloDeVida = (banco: DatabaseSync): DemandasDoCicloDeVida => {
  const gestaoDeDemandas = montarDemandasDoBanco(banco);
  return {
    projeto: (nome, orientacao) => gestaoDeDemandas.projeto(nome, orientacao),
    pedidos: (ids) => new Map(gestaoDeDemandas.pedidos({ ids }).map((pedido) => [pedido.id, pedido])),
    predecessorasPendentes: (ids) =>
      new Map(gestaoDeDemandas.pedidos({ ids }).map((pedido) => [pedido.id, pedido.predecessorasPendentes])),
    concluir: (id, gravarEncerramentoDoProcesso) => {
      gestaoDeDemandas.concluir(id, gravarEncerramentoDoProcesso);
    },
  };
};

/**
 * O Ciclo de Vida sobre o `banco`, com a leitura de Demandas da composição e os `modulos` que o serviço montou (sem eles,
 * os do banco, sem a gestão de Ambientes).
 */
export const montarCicloDeVidaDoBanco = (
  banco: DatabaseSync,
  {
    repositorio = montarRepositorio({ banco }),
    ...modulos
  }: Partial<Omit<MontagemDoCicloDeVida, "banco" | "demandas">> = {},
): CicloDeVida => montarCicloDeVida({ ...modulos, banco, repositorio, demandas: demandasDoCicloDeVida });

const MIGRACOES_DOS_DOMINIOS = [
  MIGRACOES_DE_DEMANDAS,
  MIGRACOES_DO_CICLO_DE_VIDA,
  MIGRACOES_DA_CONFIGURACAO_DO_AMBIENTE,
  MIGRACOES_DE_SESSOES,
];

/**
 * Abre o banco da `raiz` (padrão: a do serviço) e aplica as migrações pendentes, do histórico e dos domínios. Monta o
 * Ciclo de Vida sobre ele, o que liga a leitura de Demandas antes de qualquer leitura do agregado.
 */
export const abrirBancoDaFabriquinha = (raiz?: string): DatabaseSync => {
  const banco = abrir(raiz, MIGRACOES_DOS_DOMINIOS);
  montarCicloDeVidaDoBanco(banco);
  return banco;
};

/**
 * Leva o banco já aberto à versão atual, ou só até `versao`, pelas mesmas migrações que a abertura aplica.
 * @testes os testes de migração montam o banco numa versão anterior e o banco em memória
 */
export const migrarBancoDaFabriquinha = (banco: DatabaseSync, versao?: number): void => {
  const migracoes = enfileirarDepoisDoHistorico(MIGRACOES_DOS_DOMINIOS);
  migrar(banco, versao === undefined ? migracoes : migracoes.slice(0, versao - VERSAO_LINHA_DE_BASE));
  montarCicloDeVidaDoBanco(banco);
};
