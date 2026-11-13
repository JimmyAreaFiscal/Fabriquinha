// Rotas da Configuração (F7 §4.2): a configuração do F4 §3 com o estado do agendador, os projetos com o cadastro
// (C19), o modelo e o effort de cada etapa, e os modelos do pi para os seletores.
import { condutor, validarESalvarConfiguracao } from "../../../modulos/ciclo_de_vida/publico.ts";
import { eliminarAmbienteDoConjunto, validarESalvarConfiguracaoDoAmbiente } from "../../../modulos/ambiente/publico.ts";
import {
  consultarEstadoDaConfiguracao,
  consultarEstadoDoAmbiente,
  consultarProjetoCadastrado,
  consultarProjetosCadastrados,
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
import {
  cadastrarProjetoConferindoOModelo,
  editarProjetoConferindoOModelo,
} from "../../fluxos/projeto/cadastro_do_projeto.ts";
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
  { metodo: "GET", caminho: "/api/modelos", tratar: () => condutor.harness.listarModelos(), resposta: ModelosDoPi },
  {
    metodo: "POST",
    caminho: "/api/projetos",
    tratar: ({ banco, corpo }) => cadastrarProjetoConferindoOModelo(banco, FormularioDoProjeto.parse(corpo)),
    resposta: ProjetoCadastrado,
  },
  {
    metodo: "POST",
    caminho: "/api/projetos/:nome",
    tratar: ({ banco, params, corpo }) =>
      editarProjetoConferindoOModelo(banco, { ...FormularioDeEdicaoDoProjeto.parse(corpo), nome: String(params.nome) }),
    resposta: ProjetoCadastrado,
  },
  {
    metodo: "DELETE",
    caminho: "/api/projetos/:nome",
    tratar: async ({ banco, params }) => {
      const { avisos } = await removerProjetoComOQueDependeDele(banco, String(params.nome));
      return { avisos };
    },
    resposta: ProjetoRemovido,
  },
];
