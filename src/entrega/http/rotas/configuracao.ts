// Rotas da Configuração (F7 §4.2): a configuração do F4 §3 com o estado do agendador, os projetos com o cadastro
// (C19), o modelo e o effort de cada etapa, e os modelos do pi para os seletores.
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { ConfiguracaoAgente } from "../../../nucleo/configuracao_agente.ts";
import { EtapaTicket } from "../../../nucleo/primitivos.ts";
import { ComandosDePreparacao, Hospedagem, Projeto } from "../../../nucleo/projeto.ts";
import { HarnessPi } from "../../../infra/agente/harness_pi.ts";
import {
  cadastrarProjetoDoFormulario,
  editarProjetoDoFormulario,
  listarProjetos,
  projetoExistente,
  removerProjeto,
} from "../../../aplicacao/projeto/cadastro.ts";
import { Configuracao, configuracao, configuracaoDoAmbiente } from "../../../armazenamento/servico.ts";
import {
  conferirESalvarConfiguracao,
  projetoComConfiguracoesDasEtapas,
  validarESalvarConfiguracaoDoAmbiente,
} from "../../../aplicacao/configuracao/configuracao_do_ambiente.ts";
import {
  eliminarAmbienteDoConjunto,
  listarAmbientesDoConjunto,
} from "../../../aplicacao/ambiente/conjunto_da_configuracao.ts";
import type { Agendador, Rota } from "../rotas.ts";

/** A configuração do F4 §3 e o estado do agendador: a próxima busca, só ligado. */
function estado(banco: DatabaseSync, agendador: Agendador) {
  const c = configuracao(banco);
  return { ...c, proximaBusca: c.agendadorAtivo ? agendador.proximaBusca().toISOString() : null };
}

/** O projeto como o formulário manda: a hospedagem, que ele só mostra, é ignorada; o F5 a deduz do remoto. */
const DoFormulario = Projeto.pick({ nome: true, raiz_git: true, branch_base: true, link_produto: true }).extend({
  hospedagem: Hospedagem.optional(),
  preparacao: ComandosDePreparacao,
  /** O modelo e o effort de cada etapa; a etapa ausente usa o padrão do pi. */
  configuracoes: z.partialRecord(EtapaTicket, ConfiguracaoAgente),
});
/** O nome é a chave e não muda (C19): o do caminho vale, e o do corpo é ignorado. */
const DaEdicao = DoFormulario.extend({ nome: z.unknown() });

/** O Ambiente: o tipo e os limites gravados, e o conjunto de containers da Fabriquinha (só os que ela criou). */
const estadoDoAmbiente = (banco: DatabaseSync) => ({
  configuracao: configuracaoDoAmbiente(banco),
  conjunto: listarAmbientesDoConjunto(banco),
});

export const ROTAS_DA_CONFIGURACAO: Rota[] = [
  { metodo: "GET", caminho: "/api/configuracao", tratar: ({ banco, agendador }) => estado(banco, agendador) },
  {
    metodo: "POST",
    caminho: "/api/configuracao",
    tratar: async ({ banco, agendador, corpo }) => {
      await conferirESalvarConfiguracao(banco, Configuracao.parse(corpo));
      return estado(banco, agendador);
    },
  },
  { metodo: "GET", caminho: "/api/ambiente", tratar: ({ banco }) => estadoDoAmbiente(banco) },
  {
    metodo: "POST",
    caminho: "/api/ambiente",
    tratar: ({ banco, corpo }) => {
      validarESalvarConfiguracaoDoAmbiente(banco, corpo);
      return estadoDoAmbiente(banco);
    },
  },
  {
    metodo: "DELETE",
    caminho: "/api/ambiente/:id",
    tratar: ({ banco, params }) => eliminarAmbienteDoConjunto(banco, String(params.id)),
  },
  {
    metodo: "GET",
    caminho: "/api/projetos",
    tratar: ({ banco }) => listarProjetos(banco).map(projetoComConfiguracoesDasEtapas),
  },
  {
    metodo: "GET",
    caminho: "/api/projetos/:nome",
    tratar: ({ banco, params }) => {
      const nome = String(params.nome);
      return projetoComConfiguracoesDasEtapas(projetoExistente(banco, nome));
    },
  },
  { metodo: "GET", caminho: "/api/modelos", tratar: () => new HarnessPi().listarModelos() },
  {
    metodo: "POST",
    caminho: "/api/projetos",
    tratar: ({ banco, corpo }) => cadastrarProjetoDoFormulario(banco, DoFormulario.parse(corpo)),
  },
  {
    metodo: "POST",
    caminho: "/api/projetos/:nome",
    tratar: ({ banco, params, corpo }) =>
      editarProjetoDoFormulario(banco, { ...DaEdicao.parse(corpo), nome: String(params.nome) }),
  },
  {
    metodo: "DELETE",
    caminho: "/api/projetos/:nome",
    tratar: async ({ banco, params }) => {
      const { avisos } = await removerProjeto(banco, String(params.nome));
      return { avisos };
    },
  },
];
