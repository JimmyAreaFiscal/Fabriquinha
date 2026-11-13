// Os projetos cadastrados, que a Condução e o Despacho recebem como dado (MELHORIAS §11, regra 2): o cadastro e a
// configuração são de Demandas, e o Ciclo de Vida não importa Demandas. A composição liga aqui a leitura deles; o projeto
// cadastrado já tem a forma de `ProjetoConduzido`.
import type { DatabaseSync } from "node:sqlite";
import { encontrado } from "../../../../shared/nucleo/erros.ts";
import type { ConfiguracaoAgente, EtapaTicket } from "../../etapas/publico.ts";
import type { ProjetoAVerificar } from "../../verificacoes/publico.ts";
import type { RepositorioDoProjeto } from "../../../repositorio/publico.ts";

/** O que a Condução lê do projeto: o repositório, as verificações, a configuração de cada Etapa e a imagem do Ambiente. */
export interface ProjetoConduzido extends ProjetoAVerificar, RepositorioDoProjeto {
  readonly chave_sonarqube: string;
  readonly etapas: readonly { readonly etapa: EtapaTicket; readonly configuracao_agente?: ConfiguracaoAgente }[];
  readonly imagem_do_ambiente?: string;
  readonly verificacoes: ProjetoAVerificar["verificacoes"] & RepositorioDoProjeto["verificacoes"];
}

/** A leitura dos projetos cadastrados que a composição liga. */
interface LeituraDosProjetosCadastrados {
  buscarProjeto(banco: DatabaseSync, nome: string): ProjetoConduzido | undefined;
  /** O projeto com a configuração do SDLC, ou a recusa. */
  carregarProjeto(banco: DatabaseSync, nome: string): ProjetoConduzido;
  /** O projeto cadastrado, ou `ErroDeInexistente` com a orientação. */
  projetoExistente(banco: DatabaseSync, nome: string, orientacao?: string): ProjetoConduzido;
}

let leituraLigada: LeituraDosProjetosCadastrados | undefined;

/** A composição liga a leitura dos projetos de Demandas, uma vez, antes de qualquer condução. */
export const ligarLeituraDosProjetosCadastrados = (leitura: LeituraDosProjetosCadastrados): void => {
  leituraLigada = leitura;
};

export const projetosCadastrados = (): LeituraDosProjetosCadastrados =>
  encontrado(
    leituraLigada,
    "a leitura dos projetos cadastrados não foi ligada ao Ciclo de Vida",
    "abra o banco por abrirBancoDaFabriquinha, que liga a leitura de Demandas",
  );
