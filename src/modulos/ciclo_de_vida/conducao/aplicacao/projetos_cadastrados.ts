// Os projetos cadastrados, que a Condução e o Despacho recebem como dado (MELHORIAS §11, regra 2): o cadastro e a
// configuração são de Demandas, e o Ciclo de Vida não importa Demandas. A composição liga aqui a leitura deles; o projeto
// cadastrado já tem a forma de `ProjetoConduzido`.
import type { DatabaseSync } from "node:sqlite";
import { ErroDeRegra, encontrado } from "../../../../shared/nucleo/erros.ts";
import type { ConfiguracaoAgente, EtapaTicket } from "../../etapas/publico.ts";
import type { ProjetoAVerificar } from "../../verificacoes/publico.ts";
import type { ProjetoDoRepositorio } from "../../../repositorio/publico.ts";

/** O que a Condução lê do projeto: o repositório, as verificações, a configuração de cada Etapa e a imagem do Ambiente. */
export interface ProjetoConduzido extends ProjetoAVerificar, ProjetoDoRepositorio {
  readonly chave_sonarqube: string;
  readonly etapas: readonly { readonly etapa: EtapaTicket; readonly configuracao_agente?: ConfiguracaoAgente }[];
  readonly imagem_do_ambiente?: string;
  readonly verificacoes: ProjetoAVerificar["verificacoes"] & ProjetoDoRepositorio["verificacoes"];
}

/** A leitura dos projetos cadastrados que a composição liga. */
interface LeituraDosProjetosCadastrados {
  /** O projeto cadastrado, ou `ErroDeInexistente` com a orientação. */
  projetoExistente(banco: DatabaseSync, nome: string, orientacao?: string): ProjetoConduzido;
}

let leituraLigada: LeituraDosProjetosCadastrados | undefined;

/** A composição liga a leitura dos projetos de Demandas, uma vez, antes de qualquer condução. */
export const ligarLeituraDosProjetosCadastrados = (leitura: LeituraDosProjetosCadastrados): void => {
  leituraLigada = leitura;
};

const leituraDosProjetos = (): LeituraDosProjetosCadastrados =>
  encontrado(
    leituraLigada,
    "a leitura dos projetos cadastrados não foi ligada ao Ciclo de Vida",
    "abra o banco por abrirBancoDaFabriquinha, que liga a leitura de Demandas",
  );

/**
 * Os projetos como a Condução e o Despacho os leem: o cadastrado e, para conduzir uma Etapa, o que tem a configuração do
 * SDLC (ao menos uma linguagem), ou a recusa com a orientação. O projeto de uma demanda sempre existe (chave estrangeira).
 */
export const projetosCadastrados = () => ({
  projetoExistente: (banco: DatabaseSync, nome: string, orientacao?: string): ProjetoConduzido =>
    leituraDosProjetos().projetoExistente(banco, nome, orientacao),
  carregarProjeto(banco: DatabaseSync, nome: string): ProjetoConduzido {
    const projeto = leituraDosProjetos().projetoExistente(banco, nome);
    if (projeto.verificacoes.linguagens.length === 0)
      throw new ErroDeRegra(`o projeto ${nome} não tem configuração do SDLC`, "configure o projeto");
    return projeto;
  },
});
