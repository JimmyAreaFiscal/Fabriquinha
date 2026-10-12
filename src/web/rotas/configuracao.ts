// Rotas da Configuração (F7 §4.2): a configuração do F4 §3 com o estado do agendador, os projetos com o cadastro
// (C19) e os modelos do pi para os seletores.
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { mensagem } from "../../dominio/erros.ts";
import { Projeto } from "../../dominio/projeto.ts";
import { conferirModelo, listarModelos } from "../../execucao/modelos.ts";
import { varrerBase } from "../../metricas/retrabalho.ts";
import { noLog } from "../../persistencia/execucoes.ts";
import { editarProjeto, issuesDoProjeto, projetos, registrarProjeto } from "../../persistencia/projetos.ts";
import { autonomaEmAndamento, configuracao, salvarConfiguracao } from "../../persistencia/servico.ts";
import { conferirProjeto } from "../../repositorio/cadastro.ts";
import { ErroHttp } from "../erros.ts";
import type { Agendador, Rota } from "../rotas.ts";

/** A configuração do F4 §3 e o estado do agendador: a próxima busca (só ligado) e a execução autônoma em andamento. */
function estado(banco: DatabaseSync, agendador: Agendador) {
  const c = configuracao(banco);
  return {
    ...c,
    proximaBusca: c.agendadorAtivo ? agendador.proximaBusca().toISOString() : null,
    emAndamento: autonomaEmAndamento(banco) ?? null,
  };
}

/** O projeto como o formulário manda: a hospedagem não vem dele, é deduzida do remoto pelo F5. */
const DoFormulario = Projeto.omit({ hospedagem: true });
const DaEdicao = DoFormulario.omit({ nome: true });

/**
 * C19 pelo web: confere o repositório (F5 §2; a falha é externa, 502, e nada é gravado), confere cada modelo (F4 §9;
 * o recusado vira erro do campo, 422), grava e fixa o cursor inicial da base (F6 §4.4). A varredura que falha só vai
 * para o log: o agendador a refaz no dia seguinte.
 */
async function cadastrar(
  banco: DatabaseSync,
  p: z.infer<typeof DoFormulario>,
  gravar: typeof registrarProjeto,
): Promise<Projeto> {
  const { hospedagem } = await conferirProjeto(p).catch((error_: unknown) => {
    throw new ErroHttp(502, mensagem(error_));
  });
  const recusados = (
    await Promise.all(
      Object.entries(p.modelos).map(([etapa, modelo]) =>
        conferirModelo(modelo).then(
          () => [],
          (error_: unknown) => [
            { code: "custom" as const, path: ["modelos", etapa], message: mensagem(error_), input: modelo },
          ],
        ),
      ),
    )
  ).flat();
  if (recusados.length > 0) throw new z.ZodError(recusados);
  const salvo = gravar(banco, { ...p, hospedagem });
  await varrerBase(banco, salvo.nome).catch(noLog);
  return salvo;
}

export const ROTAS_DA_CONFIGURACAO: Rota[] = [
  { metodo: "GET", caminho: "/api/configuracao", tratar: ({ banco, agendador }) => estado(banco, agendador) },
  {
    metodo: "POST",
    caminho: "/api/configuracao",
    tratar: ({ banco, agendador, corpo }) => {
      salvarConfiguracao(banco, corpo);
      return estado(banco, agendador);
    },
  },
  {
    metodo: "GET",
    caminho: "/api/projetos",
    tratar: ({ banco }) => projetos(banco).map((p) => ({ ...p, issues: issuesDoProjeto(banco, p.nome) })),
  },
  { metodo: "GET", caminho: "/api/modelos", tratar: () => listarModelos() },
  {
    metodo: "POST",
    caminho: "/api/projetos",
    tratar: ({ banco, corpo }) => cadastrar(banco, DoFormulario.parse(corpo), registrarProjeto),
  },
  // O nome é a chave e não muda (C19): o do caminho vale, e o do corpo é ignorado.
  {
    metodo: "POST",
    caminho: "/api/projetos/:nome",
    tratar: ({ banco, params, corpo }) =>
      cadastrar(banco, { ...DaEdicao.parse(corpo), nome: String(params.nome) }, editarProjeto),
  },
];
