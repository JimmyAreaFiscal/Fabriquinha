// Rotas da Configuração (F7 §4.2): a configuração do F4 §3 com o estado do agendador, os projetos com o cadastro
// (C19), o modelo e o effort de cada etapa, e os modelos do pi para os seletores.
import { validarESalvarConfiguracao } from "../../../modulos/ciclo_de_vida/publico.ts";
import { montarSessoesDeAgente } from "../../../modulos/sessoes/publico.ts";
import { ConfiguracaoDoAmbiente } from "../../../shared/nucleo/configuracao_do_ambiente.ts";
import {
  consultarEstadoDaConfiguracao,
  consultarEstadoDoAmbiente,
  consultarProjetoCadastrado,
  consultarProjetosCadastrados,
  projetoComConfiguracoesDasEtapas,
} from "../../consultas/configuracao.ts";
import {
  EstadoDaConfiguracao,
  EstadoDoAmbiente,
  FormularioDeEdicaoDoProjeto,
  FormularioDoProjeto,
  ModelosDoPi,
  ProjetosCadastrados,
  ProjetoCadastrado,
  ProjetoRemovido,
} from "../../contrato/configuracao.ts";
import { removerProjetoComOQueDependeDele } from "../../fluxos/projeto/remocao_do_projeto.ts";
import { SemCorpoEmJson, type Rota } from "../rotas.ts";

export const ROTAS_DA_CONFIGURACAO: Rota[] = [
  {
    metodo: "GET",
    caminho: "/api/configuracao",
    tratar: ({ banco, agendador }) => consultarEstadoDaConfiguracao(banco, () => agendador.proximaBusca()),
    resposta: EstadoDaConfiguracao,
  },
  {
    metodo: "POST",
    caminho: "/api/configuracao",
    tratar: ({ banco, agendador, corpo }) => {
      validarESalvarConfiguracao(banco, corpo);
      return consultarEstadoDaConfiguracao(banco, () => agendador.proximaBusca());
    },
    resposta: EstadoDaConfiguracao,
  },
  {
    metodo: "GET",
    caminho: "/api/ambiente",
    tratar: ({ banco, ambientes }) => consultarEstadoDoAmbiente(banco, ambientes.gestao),
    resposta: EstadoDoAmbiente,
  },
  {
    metodo: "POST",
    caminho: "/api/ambiente",
    tratar: ({ banco, ambientes, corpo }) => {
      ambientes.configurar(ConfiguracaoDoAmbiente.parse(corpo));
      return consultarEstadoDoAmbiente(banco, ambientes.gestao);
    },
    resposta: EstadoDoAmbiente,
  },
  {
    metodo: "DELETE",
    caminho: "/api/ambiente/:id",
    resposta: SemCorpoEmJson,
    tratar: ({ ambientes, params }) => ambientes.gestao.deletar(String(params.id)),
  },
  {
    metodo: "GET",
    caminho: "/api/projetos",
    tratar: ({ demandas }) => consultarProjetosCadastrados(demandas),
    resposta: ProjetosCadastrados,
  },
  {
    metodo: "GET",
    caminho: "/api/projetos/:nome",
    tratar: ({ demandas, params }) => consultarProjetoCadastrado(demandas, String(params.nome)),
    resposta: ProjetoCadastrado,
  },
  {
    metodo: "GET",
    caminho: "/api/modelos",
    tratar: ({ banco }) => montarSessoesDeAgente({ banco }).modelos(),
    resposta: ModelosDoPi,
  },
  {
    metodo: "POST",
    caminho: "/api/projetos",
    tratar: async ({ demandas, corpo }) =>
      projetoComConfiguracoesDasEtapas(await demandas.cadastrarProjeto(FormularioDoProjeto.parse(corpo))),
    resposta: ProjetoCadastrado,
  },
  {
    metodo: "POST",
    caminho: "/api/projetos/:nome",
    tratar: async ({ demandas, params, corpo }) =>
      projetoComConfiguracoesDasEtapas(
        await demandas.editarProjeto({ ...FormularioDeEdicaoDoProjeto.parse(corpo), nome: String(params.nome) }),
      ),
    resposta: ProjetoCadastrado,
  },
  {
    metodo: "DELETE",
    caminho: "/api/projetos/:nome",
    tratar: async ({ banco, demandas, params }) => {
      const { avisos } = await removerProjetoComOQueDependeDele(banco, demandas, String(params.nome));
      return { avisos };
    },
    resposta: ProjetoRemovido,
  },
];
