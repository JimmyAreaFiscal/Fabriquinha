// Rotas da Configuração (F7 §4.2): a configuração do F4 §3 com o estado do agendador, os projetos com o cadastro
// (C19), o modelo e o effort de cada etapa, e os modelos do pi para os seletores.
import {
  cadastrarProjetoDoFormulario,
  editarProjetoDoFormulario,
  removerProjeto,
} from "../../../ambiente/aplicacao/projeto/cadastro.ts";
import {
  conferirESalvarConfiguracao,
  validarESalvarConfiguracaoDoAmbiente,
} from "../../../ambiente/aplicacao/projeto/configuracao_do_ambiente.ts";
import { eliminarAmbienteDoConjunto } from "../../../ambiente/aplicacao/conjunto_de_ambientes/conjunto_da_configuracao.ts";
import {
  consultarEstadoDaConfiguracao,
  consultarEstadoDoAmbiente,
  consultarModelosDoPi,
  consultarProjetoCadastrado,
  consultarProjetosCadastrados,
} from "../../../ambiente/aplicacao/consultas/configuracao.ts";
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
    tratar: async ({ banco, agendador, corpo }) => {
      await conferirESalvarConfiguracao(banco, corpo);
      return consultarEstadoDaConfiguracao(banco, () => agendador.proximaBusca());
    },
    resposta: EstadoDaConfiguracao,
  },
  {
    metodo: "GET",
    caminho: "/api/ambiente",
    tratar: ({ banco }) => consultarEstadoDoAmbiente(banco),
    resposta: EstadoDoAmbiente,
  },
  {
    metodo: "POST",
    caminho: "/api/ambiente",
    tratar: ({ banco, corpo }) => {
      validarESalvarConfiguracaoDoAmbiente(banco, corpo);
      return consultarEstadoDoAmbiente(banco);
    },
    resposta: EstadoDoAmbiente,
  },
  {
    metodo: "DELETE",
    caminho: "/api/ambiente/:id",
    resposta: SemCorpoEmJson,
    tratar: ({ banco, params }) => eliminarAmbienteDoConjunto(banco, String(params.id)),
  },
  {
    metodo: "GET",
    caminho: "/api/projetos",
    tratar: ({ banco }) => consultarProjetosCadastrados(banco),
    resposta: ProjetosCadastrados,
  },
  {
    metodo: "GET",
    caminho: "/api/projetos/:nome",
    tratar: ({ banco, params }) => consultarProjetoCadastrado(banco, String(params.nome)),
    resposta: ProjetoCadastrado,
  },
  { metodo: "GET", caminho: "/api/modelos", tratar: () => consultarModelosDoPi(), resposta: ModelosDoPi },
  {
    metodo: "POST",
    caminho: "/api/projetos",
    tratar: ({ banco, corpo }) => cadastrarProjetoDoFormulario(banco, FormularioDoProjeto.parse(corpo)),
    resposta: ProjetoCadastrado,
  },
  {
    metodo: "POST",
    caminho: "/api/projetos/:nome",
    tratar: ({ banco, params, corpo }) =>
      editarProjetoDoFormulario(banco, { ...FormularioDeEdicaoDoProjeto.parse(corpo), nome: String(params.nome) }),
    resposta: ProjetoCadastrado,
  },
  {
    metodo: "DELETE",
    caminho: "/api/projetos/:nome",
    tratar: async ({ banco, params }) => {
      const { avisos } = await removerProjeto(banco, String(params.nome));
      return { avisos };
    },
    resposta: ProjetoRemovido,
  },
];
