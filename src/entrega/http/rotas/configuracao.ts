// Rotas da Configuração (F7 §4.2): a configuração do F4 §3 com o estado do agendador, os projetos com o cadastro
// (C19), o modelo e o effort de cada etapa, e os modelos do pi para os seletores.
import {
  cadastrarProjetoDoFormulario,
  editarProjetoDoFormulario,
  removerProjeto,
} from "../../../projeto/aplicacao/cadastro.ts";
import { conferirESalvarConfiguracao } from "../../../projeto/aplicacao/configuracao_do_agente.ts";
import { eliminarAmbienteDoConjunto } from "../../../sandbox/aplicacao/conjunto_de_ambientes/conjunto_da_configuracao.ts";
import {
  consultarEstadoDaConfiguracao,
  consultarEstadoDoAmbiente,
  consultarProjetoCadastrado,
  consultarProjetosCadastrados,
} from "../../../projeto/aplicacao/consultas/configuracao.ts";
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
import { condutor } from "../../../execucao/aplicacao/trabalho/condutor.ts";
import type { Modelo } from "../../../compartilhado/nucleo/primitivos.ts";
import { SemCorpoEmJson, type Rota } from "../rotas.ts";
import { validarESalvarConfiguracaoDoAmbiente } from "../../../sandbox/aplicacao/configuracao_do_ambiente.ts";

/** O harness do serviço confere o modelo novo ou trocado (F4 §9). */
const conferirModeloNoHarness = (modelo: Modelo): Promise<void> => condutor.harness.conferirModelo(modelo);

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
      await conferirESalvarConfiguracao(banco, corpo, conferirModeloNoHarness);
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
    tratar: ({ banco, corpo }) =>
      cadastrarProjetoDoFormulario(banco, FormularioDoProjeto.parse(corpo), conferirModeloNoHarness),
    resposta: ProjetoCadastrado,
  },
  {
    metodo: "POST",
    caminho: "/api/projetos/:nome",
    tratar: ({ banco, params, corpo }) =>
      editarProjetoDoFormulario(
        banco,
        { ...FormularioDeEdicaoDoProjeto.parse(corpo), nome: String(params.nome) },
        conferirModeloNoHarness,
      ),
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
