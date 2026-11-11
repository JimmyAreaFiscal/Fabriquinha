// Rotas da Simulação (F7 §4.2, F8): os Usuários Simulados do projeto, os seus anexos, as Tarefas e o Executar.
import {
  anexarArquivoAoUsuarioSimulado,
  listarTarefas,
  listarUsuariosSimulados,
  removerAnexoDoUsuarioSimulado,
  validarECriarTarefa,
  validarECriarUsuarioSimulado,
} from "../../../avaliacao/aplicacao/simulacao/cadastro_da_simulacao.ts";
import { iniciarExecucaoDaTarefa } from "../../../avaliacao/aplicacao/simulacao/executor.ts";
import { Anexo, Tarefa, UsuarioSimulado } from "../../contrato/simulacao.ts";
import { ErroHttp } from "../erros.ts";
import { IdDoCaminho, SemCorpoEmJson, type Rota } from "../rotas.ts";

export const ROTAS_DA_SIMULACAO: Rota[] = [
  {
    metodo: "GET",
    caminho: "/api/projetos/:nome/usuarios-simulados",
    tratar: ({ banco, params }) => listarUsuariosSimulados(banco, String(params.nome)),
    resposta: UsuarioSimulado.array(),
  },
  {
    metodo: "POST",
    caminho: "/api/projetos/:nome/usuarios-simulados",
    tratar: ({ banco, params, corpo }) => validarECriarUsuarioSimulado(banco, String(params.nome), corpo),
    resposta: UsuarioSimulado,
  },
  {
    // O arquivo vai como corpo binário e o nome em `?nome=`: o JSON só leva 64 KiB.
    metodo: "POST",
    caminho: "/api/usuarios-simulados/:id/anexos",
    tratar: ({ banco, params, query, corpo }) => {
      if (!Buffer.isBuffer(corpo)) {
        throw new ErroHttp(422, "envie o arquivo como corpo binário (Content-Type: application/octet-stream)");
      }
      return anexarArquivoAoUsuarioSimulado(banco, IdDoCaminho.parse(params.id), query.get("nome") ?? "", corpo);
    },
    resposta: Anexo,
  },
  {
    metodo: "DELETE",
    caminho: "/api/usuarios-simulados/:id/anexos/:nome",
    resposta: SemCorpoEmJson,
    tratar: ({ banco, params }) => {
      removerAnexoDoUsuarioSimulado(banco, IdDoCaminho.parse(params.id), String(params.nome));
    },
  },
  {
    metodo: "GET",
    caminho: "/api/projetos/:nome/tarefas",
    tratar: ({ banco, params }) => listarTarefas(banco, String(params.nome)),
    resposta: Tarefa.array(),
  },
  {
    metodo: "POST",
    caminho: "/api/projetos/:nome/tarefas",
    tratar: ({ banco, params, corpo, relogio }) => validarECriarTarefa(banco, String(params.nome), corpo, relogio),
    resposta: Tarefa,
  },
  {
    // As execuções seguem em segundo plano: a resposta é 204 assim que estão na fila (409 sem link ou com pendente).
    metodo: "POST",
    caminho: "/api/tarefas/:id/executar",
    resposta: SemCorpoEmJson,
    tratar: ({ banco, params, relogio }) => {
      iniciarExecucaoDaTarefa(banco, IdDoCaminho.parse(params.id), relogio);
    },
  },
];
