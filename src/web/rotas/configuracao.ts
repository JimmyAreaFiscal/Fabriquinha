// Rotas da Configuração (F7 §4.2): a configuração do F4 §3 com o estado do agendador, os projetos com o cadastro
// (C19) e os modelos do pi para os seletores.
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { encontrado, mensagem } from "../../dominio/erros.ts";
import { Hospedagem, Projeto } from "../../dominio/projeto.ts";
import { conferirModelo, listarModelos } from "../../execucao/modelos.ts";
import { varrerBase } from "../../metricas/retrabalho.ts";
import { raizDo } from "../../persistencia/banco.ts";
import { noLog } from "../../persistencia/execucoes.ts";
import {
  editarProjeto,
  issuesDoProjeto,
  projeto,
  projetos,
  registrarProjeto,
  removerProjeto,
} from "../../persistencia/projetos.ts";
import { autonomasEmAndamento, Configuracao, configuracao, salvarConfiguracao } from "../../persistencia/servico.ts";
import { conferirProjeto } from "../../repositorio/cadastro.ts";
import { removerWorktrees } from "../../repositorio/worktree.ts";
import { ErroHttp } from "../erros.ts";
import type { Agendador, Rota } from "../rotas.ts";

/** A configuração do F4 §3 e o estado do agendador: a próxima busca (só ligado) e as execuções autônomas em andamento. */
function estado(banco: DatabaseSync, agendador: Agendador) {
  const c = configuracao(banco);
  return {
    ...c,
    proximaBusca: c.agendadorAtivo ? agendador.proximaBusca().toISOString() : null,
    emAndamento: autonomasEmAndamento(banco),
  };
}

/** O projeto como o formulário manda: a hospedagem, que ele só mostra, é ignorada; o F5 a deduz do remoto. */
const DoFormulario = Projeto.extend({ hospedagem: Hospedagem.optional() });
/** O nome é a chave e não muda (C19): o do caminho vale, e o do corpo é ignorado. */
const DaEdicao = DoFormulario.extend({ nome: z.unknown() });

/**
 * C19 pelo web: confere o repositório (F5 §2; a falha é externa, 502, e nada é gravado), confere cada modelo (F4 §9;
 * o recusado vira erro do campo, 422) e grava.
 */
async function conferirEGravar(
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
  return gravar(banco, { ...p, hospedagem });
}

/**
 * O cadastro e só ele fixa o cursor inicial da base (F6 §4.4); a edição não varre. A varredura que falha só vai para o
 * log: o agendador a refaz no dia seguinte.
 */
async function cadastrar(banco: DatabaseSync, p: z.infer<typeof DoFormulario>): Promise<Projeto> {
  const salvo = await conferirEGravar(banco, p, registrarProjeto);
  await varrerBase(banco, salvo.nome).catch(noLog);
  return salvo;
}

const comIssues = (banco: DatabaseSync, p: Projeto) => ({ ...p, issues: issuesDoProjeto(banco, p.nome) });

export const ROTAS_DA_CONFIGURACAO: Rota[] = [
  { metodo: "GET", caminho: "/api/configuracao", tratar: ({ banco, agendador }) => estado(banco, agendador) },
  {
    metodo: "POST",
    caminho: "/api/configuracao",
    tratar: async ({ banco, agendador, corpo }) => {
      const nova = Configuracao.parse(corpo);
      const modelo = nova.modeloAuditoria;
      const gravado = configuracao(banco).modeloAuditoria;
      if (modelo && (modelo.provedor !== gravado?.provedor || modelo.modelo !== gravado.modelo)) {
        await conferirModelo(modelo).catch((error_: unknown) => {
          throw new z.ZodError([
            { code: "custom", path: ["modeloAuditoria"], message: mensagem(error_), input: modelo },
          ]);
        });
      }
      salvarConfiguracao(banco, nova);
      return estado(banco, agendador);
    },
  },
  {
    metodo: "GET",
    caminho: "/api/projetos",
    tratar: ({ banco }) => projetos(banco).map((p) => comIssues(banco, p)),
  },
  {
    metodo: "GET",
    caminho: "/api/projetos/:nome",
    tratar: ({ banco, params }) => {
      const nome = String(params.nome);
      return comIssues(
        banco,
        encontrado(projeto(banco, nome), `o projeto ${nome} não existe`, "confira o nome do projeto"),
      );
    },
  },
  { metodo: "GET", caminho: "/api/modelos", tratar: () => listarModelos() },
  {
    metodo: "POST",
    caminho: "/api/projetos",
    tratar: ({ banco, corpo }) => cadastrar(banco, DoFormulario.parse(corpo)),
  },
  {
    metodo: "POST",
    caminho: "/api/projetos/:nome",
    tratar: ({ banco, params, corpo }) =>
      conferirEGravar(banco, { ...DaEdicao.parse(corpo), nome: String(params.nome) }, editarProjeto),
  },
  {
    metodo: "DELETE",
    caminho: "/api/projetos/:nome",
    tratar: async ({ banco, params }) => {
      const { projeto: p, avisos } = await removerProjeto(banco, String(params.nome));
      return { avisos: [...avisos, ...(await removerWorktrees(raizDo(banco), p))] };
    },
  },
];
