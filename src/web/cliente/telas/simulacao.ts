// Simulação (F7 §4.4, F8) como funções puras: as abas por projeto, o aviso de link, o formulário de nova Tarefa e os
// cartões das Tarefas com os Usuários Simulados alocados. O DOM e a rede ficam em simulacao-montar.ts.
import type { Id } from "../../../dominio/primitivos.ts";
import type { Tarefa, UsuarioSimulado } from "../../../persistencia/simulacao.ts";
import { escapar } from "../render.ts";
import { type Erros, idDe, marca, type ProjetoListado } from "./configuracao.ts";

export const caminhoDaSimulacao = (nome: string): string => `/simulation/${encodeURIComponent(nome)}`;

export const SEM_PROJETOS_DA_SIMULACAO =
  '<div class="cabeca-pagina"><h1>Simulação</h1></div><p class="muted">Nenhum projeto cadastrado ainda. <a class="link" href="/config?novo">Cadastrar um projeto na Configuração</a></p>';

/** O que está nos campos do formulário de nova Tarefa; `n` fica como o Auditor digitou. */
export interface Rascunho {
  texto: string;
  n: string;
  usuarios: readonly Id[];
}

export const RASCUNHO_VAZIO: Rascunho = { texto: "", n: "1", usuarios: [] };

export interface DadosDaSimulacao {
  projetos: readonly ProjetoListado[];
  projeto: ProjetoListado;
  usuarios: readonly UsuarioSimulado[];
  tarefas: readonly Tarefa[];
  rascunho: Rascunho;
  /** Os erros do 422 do formulário, por campo (`texto`, `n`, `usuarios`). */
  erros: Erros;
  /** A recusa que não é de um campo (409), logo abaixo do formulário. */
  falha?: string;
}

const PREFIXO = "campo-tarefa";

/** O que o projeto tem de link do produto: o endereço, ou o aviso de que sem ele não há Simulação. */
const linkDoProduto = (projeto: ProjetoListado): string =>
  projeto.linkProduto
    ? `<span class="muted">Produto em <span class="mono">${escapar(projeto.linkProduto)}</span></span>`
    : '<span class="pill pill-aguarda sem-pulso">sem link do produto</span>';

function formulario({ projeto, usuarios, rascunho, erros, falha }: DadosDaSimulacao): string {
  const texto = marca(erros, "texto", PREFIXO);
  const n = marca(erros, "n", PREFIXO);
  const alocados = marca(erros, "usuarios", PREFIXO);
  const caixas =
    usuarios.length > 0
      ? usuarios
          .map(
            (u) =>
              `<label class="check"><input type="checkbox" name="usuarios" value="${String(u.id)}"${rascunho.usuarios.includes(u.id) ? " checked" : ""}> ${escapar(u.nome)}</label>`,
          )
          .join("")
      : `<span class="muted">Cadastre usuários simulados na <a class="link" href="/config?projeto=${encodeURIComponent(projeto.nome)}">Configuração do projeto</a>.</span>`;
  const descricao = alocados.msg ? ` aria-describedby="${idDe("usuarios", PREFIXO)}-erro"` : "";
  const aviso = falha ? `<span class="msg-erro falha" role="alert">${escapar(falha)}</span>` : "";
  return `<form class="superficie form-tarefa" data-nova-tarefa novalidate><h2>Nova tarefa</h2><div class="campo${texto.classe}"><label for="${idDe("texto", PREFIXO)}">Tarefa</label><textarea id="${idDe("texto", PREFIXO)}" name="texto" rows="2" placeholder="o que o usuário deve tentar fazer no produto"${texto.aria}>${escapar(rascunho.texto)}</textarea>${texto.msg}</div><div class="linha-tarefa"><div class="num-campo${n.classe}"><label for="${idDe("n", PREFIXO)}">Execuções por usuário (N)</label><input type="number" id="${idDe("n", PREFIXO)}" name="n" min="1" max="20" value="${escapar(rascunho.n)}"${n.aria}>${n.msg}</div><fieldset class="campo alocar${alocados.classe}"${descricao}><legend>Usuários simulados</legend>${caixas}${alocados.msg}</fieldset><button type="submit" class="btn btn-primario">Criar tarefa</button></div>${aviso}</form>`;
}

function cartao(t: Tarefa): string {
  const alocados = t.usuarios.map((u) => `<b>${escapar(u.nome)}</b>`).join(", ");
  return `<article class="tarefa superficie" data-tarefa="${String(t.id)}"><div class="tarefa-cab"><strong class="tarefa-texto">${escapar(t.texto)}</strong><span class="tag">N = ${String(t.n)}</span><span class="muted">alocada a ${alocados}</span></div></article>`;
}

/** A página `/simulation/:projeto`: as abas, o formulário de nova Tarefa e as Tarefas do projeto. */
export function paginaDaSimulacao(dados: DadosDaSimulacao): string {
  const abas = dados.projetos
    .map((p) => {
      const atual = p.nome === dados.projeto.nome ? ' aria-current="page"' : "";
      return `<a href="${caminhoDaSimulacao(p.nome)}"${atual}>${escapar(p.nome)}</a>`;
    })
    .join("");
  const tarefas =
    dados.tarefas.length > 0
      ? dados.tarefas.map(cartao).join("")
      : '<p class="muted">Nenhuma tarefa neste projeto.</p>';
  return `<div class="cabeca-pagina"><h1>Simulação</h1><nav class="abas-projeto" aria-label="Projetos">${abas}</nav><div class="acoes">${linkDoProduto(dados.projeto)}</div></div>${formulario(dados)}<div class="tarefas">${tarefas}</div>`;
}
