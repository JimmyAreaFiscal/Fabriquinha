// Comandos da issue: C1 registrar, C2 editar, C3/C4 dependências, C18 arquivar e C22 cancelar (F1 §5).
import { z } from "zod";
import {
  type Agregado,
  type Ator,
  CANCELADA,
  type Contexto,
  exigirAuditor,
  exigirAuditorOuAgente,
  type Issue,
  rotuloIssue,
  type Ticket,
  TipoIssue,
} from "./agregado.ts";
import { ErroDeEscopo, ErroDeRegra } from "./erros.ts";
import { Id, Markdown, Slug, Titulo } from "./primitivos.ts";

const EntradaRegistro = z.object({
  projeto: Slug,
  deps: z.array(Id).default([]),
  descricao: Markdown.default(""),
  titulo: Titulo.optional(),
});
/** A IA externa chega com o registro escrito: título e tipo vêm junto, e ela segue com as evidências. */
const EntradaRegistroExterno = EntradaRegistro.extend({ titulo: Titulo, tipo: TipoIssue });
const EntradaEdicao = z.strictObject({ titulo: Titulo, tipo: TipoIssue, descricao: Markdown }).partial();

function exigirIssue(ctx: Contexto, id: Id): void {
  if (!ctx.issueExiste(id)) {
    throw new ErroDeRegra(`a issue I-${String(id)} não existe`, "confira o número da issue");
  }
}

/** C3 e C4 não mudam issue concluída. */
function exigirNaoConcluida(ag: Agregado): void {
  if (ag.issue.fase === "concluida") {
    throw new ErroDeRegra(
      `a ${rotuloIssue(ag)} está concluída e as dependências dela não mudam mais`,
      "registre uma nova issue se precisar",
    );
  }
}

/**
 * C1: issue em `registro`, com o ticket de registro. Do Auditor, sem tipo (e sem título, salvo o da proposta de issue,
 * C24), com o ticket aberto para a sessão do pi. Da IA externa, com título e tipo, e o ticket já em execução por ela,
 * sem sessão do pi: ela submete as evidências e envia pelo `fabriquinha necessidade`.
 */
export function registrarIssue(entrada: unknown, ator: Ator, ctx: Contexto): Agregado {
  if (ator.tipo !== "auditor" && ator.tipo !== "externo") {
    throw new ErroDeEscopo("só o Auditor ou a IA externa pode registrar uma issue", "peça ao Auditor pelo web");
  }
  const externo = ator.tipo === "externo";
  const { projeto, deps, descricao, titulo, tipo } = externo
    ? EntradaRegistroExterno.parse(entrada)
    : { ...EntradaRegistro.parse(entrada), tipo: null };
  if (!ctx.projeto(projeto)) throw new ErroDeRegra(`o projeto ${projeto} não existe`, "cadastre-o na Configuração");
  for (const dep of deps) exigirIssue(ctx, dep);
  // Uma issue nova ainda não é dependência de ninguém, então as dependências dela não fecham ciclo.
  const id = ctx.novoId("issue");
  return {
    issue: {
      id,
      projeto,
      titulo: titulo ?? null,
      tipo,
      descricao,
      fase: "registro",
      deps: [...new Set(deps)],
      criadaEm: ctx.agora,
    },
    tickets: [
      {
        id: ctx.novoId("ticket"),
        issue: id,
        etapa: "registro",
        titulo: "Registrar a necessidade",
        descricao: "",
        status: externo ? "em_execucao" : "aberto",
        origem: externo ? "externo" : "fabriquinha",
        criadoEm: ctx.agora,
      },
    ],
    execucoes: [],
    decisoes: [],
    evidencias: [],
  };
}

/** C2: muda só os campos informados. Título, tipo e descrição ficam congelados depois do registro. */
export function editarIssue(ag: Agregado, entrada: unknown, ator: Ator): Agregado {
  exigirAuditorOuAgente(ag, ator, ["registro"], `editar a ${rotuloIssue(ag)}`);
  if (ag.issue.fase !== "registro") {
    throw new ErroDeRegra(
      `a ${rotuloIssue(ag)} está na fase ${ag.issue.fase}: título, tipo e descrição só mudam no registro`,
      "registre uma nova issue para a mudança",
    );
  }
  // Campo ausente ou `undefined` (ex.: opção não passada no CLI) mantém o valor atual.
  const campos = Object.entries(EntradaEdicao.parse(entrada)).filter((par: [string, unknown]) => par[1] !== undefined);
  return { ...ag, issue: { ...ag.issue, ...Object.fromEntries(campos) } };
}

/** C3: idempotente; recusa autorreferência, issue inexistente e ciclo. Vale entre projetos. */
export function adicionarDependencia(ag: Agregado, entrada: unknown, ator: Ator, ctx: Contexto): Agregado {
  exigirAuditorOuAgente(ag, ator, ["registro"], `mudar as dependências da ${rotuloIssue(ag)}`);
  const dep = Id.parse(entrada);
  exigirNaoConcluida(ag);
  const { issue } = ag;
  if (issue.deps.includes(dep)) return ag;
  const eu = rotuloIssue(ag);
  if (dep === issue.id) throw new ErroDeRegra(`a ${eu} não pode depender de si mesma`, "informe outra issue");
  exigirIssue(ctx, dep);
  if (ctx.alcancaveis(dep).includes(issue.id)) {
    throw new ErroDeRegra(
      `a ${eu} não pode depender da I-${String(dep)}: a I-${String(dep)} já depende da ${eu} e isso fecharia um ciclo`,
      "remova antes uma das dependências do ciclo",
    );
  }
  return { ...ag, issue: { ...issue, deps: [...issue.deps, dep] } };
}

/** C4: idempotente. */
export function removerDependencia(ag: Agregado, entrada: unknown, ator: Ator): Agregado {
  exigirAuditorOuAgente(ag, ator, ["registro"], `mudar as dependências da ${rotuloIssue(ag)}`);
  const dep = Id.parse(entrada);
  exigirNaoConcluida(ag);
  const { issue } = ag;
  return issue.deps.includes(dep) ? { ...ag, issue: { ...issue, deps: issue.deps.filter((d) => d !== dep) } } : ag;
}

/** C18: devolve só as issues que arquivou, com `arquivadaEm`; as demais não mudam. */
export function arquivarConcluidas(issues: readonly Issue[], ator: Ator, ctx: Contexto): Issue[] {
  exigirAuditor(ator, "arquivar issues");
  return issues
    .filter((i) => i.fase === "concluida" && i.arquivadaEm === undefined)
    .map((i) => ({ ...i, arquivadaEm: ctx.agora }));
}

/** C22, só as guardas: Auditor, fora da concluída e ainda não cancelada. */
export function exigirCancelavel(ag: Agregado, ator: Ator): void {
  exigirAuditor(ator, `cancelar a ${rotuloIssue(ag)}`);
  if (ag.issue.fase === "concluida") {
    throw new ErroDeRegra(`a ${rotuloIssue(ag)} está concluída e não pode ser cancelada`, "ela já terminou o processo");
  }
  if (ag.issue.canceladaEm !== undefined) {
    throw new ErroDeRegra(`a ${rotuloIssue(ag)} já está cancelada`, "não há mais nada a fazer");
  }
}

/** Aberto ou falho vira `fechado` (sem `erro`), em execução vira `cancelado`; o resto fica como está. */
function encerrarTicket(t: Ticket): Ticket {
  const { erro: _, ...semErro } = t;
  if (t.status === "aberto" || t.status === "falhou") return { ...semErro, status: "fechado" };
  return t.status === "em_execucao" ? { ...semErro, status: "cancelado" } : t;
}

/**
 * C22: cancela a issue (a fase fica onde parou). Tickets abertos ou falhos ficam `fechado`, o em execução fica
 * `cancelado`, e a execução em andamento termina em `falha` com `CANCELADA`. Nada se apaga.
 */
export function cancelarIssue(ag: Agregado, ator: Ator, ctx: Contexto): Agregado {
  exigirCancelavel(ag, ator);
  return {
    ...ag,
    issue: { ...ag.issue, canceladaEm: ctx.agora },
    tickets: ag.tickets.map(encerrarTicket),
    execucoes: ag.execucoes.map((e) =>
      e.resultado === "em_andamento" ? { ...e, resultado: "falha", erro: CANCELADA, terminadaEm: ctx.agora } : e,
    ),
  };
}
