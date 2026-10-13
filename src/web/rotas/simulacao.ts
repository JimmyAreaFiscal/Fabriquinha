// Rotas da Simulação (F7 §4.2, F8): os Usuários Simulados do projeto e os seus anexos.
import { anexar, criarUsuarioSimulado, removerAnexo, usuariosSimulados } from "../../persistencia/simulacao.ts";
import { ErroHttp } from "../erros.ts";
import { IdDoCaminho, type Rota } from "../rotas.ts";

export const ROTAS_DA_SIMULACAO: Rota[] = [
  {
    metodo: "GET",
    caminho: "/api/projetos/:nome/usuarios-simulados",
    tratar: ({ banco, params }) => usuariosSimulados(banco, String(params.nome)),
  },
  {
    metodo: "POST",
    caminho: "/api/projetos/:nome/usuarios-simulados",
    tratar: ({ banco, params, corpo }) => criarUsuarioSimulado(banco, String(params.nome), corpo),
  },
  {
    // O arquivo vai como corpo binário e o nome em `?nome=`: o JSON só leva 64 KiB.
    metodo: "POST",
    caminho: "/api/usuarios-simulados/:id/anexos",
    tratar: ({ banco, params, query, corpo }) => {
      if (!Buffer.isBuffer(corpo)) {
        throw new ErroHttp(422, "envie o arquivo como corpo binário (Content-Type: application/octet-stream)");
      }
      return anexar(banco, IdDoCaminho.parse(params.id), query.get("nome") ?? "", corpo);
    },
  },
  {
    metodo: "DELETE",
    caminho: "/api/usuarios-simulados/:id/anexos/:nome",
    tratar: ({ banco, params }) => {
      removerAnexo(banco, IdDoCaminho.parse(params.id), String(params.nome));
    },
  },
];
