// Gestão de Demandas na camada de aplicação (comparacao-sdlc-implementacao.md §6): registrar, editar, dependência,
// evidência, enviar e arquivar, uma transação por operação. A web e o CLI chamam estas funções; as regras são do domínio.
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { Ator } from "../dominio/agregado.ts";
import type { AgregadoDemanda } from "../dominio/agregado_demanda.ts";
import { arquivarDemanda, cancelarDemanda } from "../dominio/cancelamento_demanda.ts";
import { ErroDeInexistente, ErroDeRegra } from "../dominio/erros.ts";
import {
  type AutorDemanda,
  type EntradaEvidenciaDemanda,
  exigirAutoria,
  submeterEvidenciaDemanda,
  TipoEvidenciaDemanda,
} from "../dominio/evidencia_demanda.ts";
import {
  type ContextoDemanda,
  decidirDemanda,
  editarDemanda,
  enviarDemanda,
  registrarDemanda,
} from "../dominio/transicoes_demanda.ts";
import { type Classe, LIMITE, type RegraArquivos, schemaDe, schemaDeEtapa } from "../evidencias/schemas.ts";
import { guardarBytes } from "../persistencia/arquivos.ts";
import { escrever } from "../persistencia/banco.ts";
import { carregarDemanda, comDemanda, criarDemandaNova } from "../persistencia/demandas.ts";
import {
  dependentesNaoConcluidasDaDemanda,
  registrarDependenciaDemanda,
} from "../persistencia/dependencias_demanda.ts";
import { gravarAnexos, registrarSessoesExternas } from "../persistencia/evidencia_demanda.ts";
import { projeto } from "../persistencia/projetos.ts";
import { execucoesAbertasDaDemanda } from "../persistencia/sessoes.ts";
import { interromperExecucaoDemanda } from "./execucao_demanda.ts";

/** Um anexo já em memória: abrir o arquivo do disco, com a defesa de origem, é de quem chama. */
const Anexo = z.object({
  nome: z.string().min(1).max(200),
  mime: z.string().min(1),
  conteudo: z.instanceof(Buffer),
});
const EntradaEvidencia = z.object({
  tipo: TipoEvidenciaDemanda,
  dados: z.unknown(),
  rodada_id: z.number().int().positive().optional(),
  arquivos: z.array(Anexo).default([]),
});
export type EntradaEvidencia = z.input<typeof EntradaEvidencia>;

export type EntradaRegistro = { dependencias?: string[] } & Record<string, unknown>;

const campos = (issues: readonly z.core.$ZodIssue[], prefixo: string[] = []): string =>
  issues.map((i) => `${[...prefixo, ...i.path.map(String)].join(".")}: ${i.message}`).join("; ");

/** O `ZodError` das entradas vira ErroDeRegra com o campo e a correção (CA-18). */
function traduzir<T>(trabalho: () => T): T {
  try {
    return trabalho();
  } catch (erro) {
    if (!(erro instanceof z.ZodError)) throw erro;
    throw new ErroDeRegra(campos(erro.issues), "corrija o campo indicado e tente de novo");
  }
}

/** CA-1 e CA-2: cria a demanda com o ID da sequência e as dependências; qualquer erro desfaz tudo, ID incluído. */
export const registrar = (
  banco: DatabaseSync,
  entrada: EntradaRegistro,
  autor: AutorDemanda,
  ctx: ContextoDemanda,
): AgregadoDemanda =>
  traduzir(() =>
    escrever(banco, () => {
      const { dependencias = [], ...dados } = entrada;
      if (!projeto(banco, String(dados.projeto))) {
        throw new ErroDeInexistente(`o projeto ${String(dados.projeto)} não existe`, "confira o nome do projeto");
      }
      const demanda = criarDemandaNova(banco, (id) => registrarDemanda({ ...dados, id }, autor, ctx));
      for (const dependeId of dependencias) registrarDependenciaDemanda(banco, demanda.demanda.id, dependeId);
      return demanda;
    }),
  );

export const editar = (banco: DatabaseSync, id: string, entrada: unknown, autor: AutorDemanda): AgregadoDemanda =>
  traduzir(() => comDemanda(banco, id, (ag) => editarDemanda(ag, entrada, autor)));

/** CA-3: só a ferramenta e a sessão autoras; o domínio recusa demanda enviada, autorreferência, repetida e ciclo. */
export const registrarDependencia = (banco: DatabaseSync, id: string, dependeId: string, autor: AutorDemanda): void => {
  traduzir(() => {
    escrever(banco, () => {
      exigirAutoria(carregarDemanda(banco, id).demanda, autor, "registrar dependência da");
      registrarDependenciaDemanda(banco, id, dependeId);
    });
  });
};

export const enviar = (banco: DatabaseSync, id: string, autor: AutorDemanda, ctx: ContextoDemanda): AgregadoDemanda =>
  traduzir(() => comDemanda(banco, id, (ag) => enviarDemanda(ag, autor, ctx)));

export const arquivar = (banco: DatabaseSync, id: string, ator: Ator, ctx: ContextoDemanda): AgregadoDemanda =>
  traduzir(() => comDemanda(banco, id, (ag) => arquivarDemanda(ag, ator, ctx)));

/**
 * CA-16 a CA-26: decide ou cancela a demanda e, se ela terminou `cancelada`, cancela as dependentes não terminadas na
 * mesma transação (a leitura das dependentes é interna, sem janela para dependente nova). Só depois do commit as
 * execuções abertas das canceladas são interrompidas, uma vez por ticket.
 */
function cancelando(
  banco: DatabaseSync,
  id: string,
  ator: Ator,
  ctx: ContextoDemanda,
  transicao: (ag: AgregadoDemanda) => AgregadoDemanda,
): { demanda: AgregadoDemanda; canceladas: string[] } {
  const { demanda, canceladas } = escrever(banco, () => {
    const dependentes = dependentesNaoConcluidasDaDemanda(banco, id);
    const principal = comDemanda(banco, id, transicao);
    if (principal.demanda.fase !== "cancelada") return { demanda: principal, canceladas: [] };
    for (const d of dependentes) comDemanda(banco, d, (ag) => cancelarDemanda(ag, ator, ctx));
    return { demanda: principal, canceladas: [id, ...dependentes] };
  });
  const abertas = execucoesAbertasDaDemanda(banco).filter((e) => canceladas.includes(e.demanda_id));
  const tickets = new Map(
    abertas.map(({ demanda_id, ticket_id }) => [`${demanda_id}.${String(ticket_id)}`, { demanda_id, ticket_id }]),
  );
  for (const ref of tickets.values()) interromperExecucaoDemanda(banco, ref);
  return { demanda, canceladas };
}

/** CA-16 a CA-20: só o Auditor; aprovar não cascateia, recusar cancela a demanda e as dependentes. */
export const decidir = (
  banco: DatabaseSync,
  id: string,
  entrada: unknown,
  ator: Ator,
  ctx: ContextoDemanda,
): { demanda: AgregadoDemanda; canceladas: string[] } =>
  traduzir(() =>
    cancelando(banco, id, ator, ctx, (ag) => {
      try {
        return decidirDemanda(ag, entrada, ator, ctx);
      } catch (erro) {
        if (erro instanceof z.ZodError && erro.issues.some((i) => i.path[0] === "motivo")) {
          throw new ErroDeRegra("informe o motivo da recusa", "recuse com o motivo");
        }
        throw erro;
      }
    }),
  );

/** CA-21 a CA-26: só o Auditor, até a integração confirmada; o histórico fica intacto. */
export const cancelar = (
  banco: DatabaseSync,
  id: string,
  ator: Ator,
  ctx: ContextoDemanda,
): { demanda: AgregadoDemanda; canceladas: string[] } =>
  traduzir(() => cancelando(banco, id, ator, ctx, (ag) => cancelarDemanda(ag, ator, ctx)));

/** F3 §3.1 pelo mime informado; a classificação pelos bytes é de quem abre o arquivo. */
const CLASSES_DO_MIME: readonly [prefixo: string, classe: Classe][] = [
  ["video/", "video"],
  ["image/", "imagem"],
  ["text/html", "html"],
  ["text/plain", "texto"],
];

/** Quantidade, nomes, classe pelo mime, tamanho e `temClasse` contra as regras de arquivos do schema do tipo. */
function conferirAnexos(tipo: string, regra: RegraArquivos, anexos: readonly z.infer<typeof Anexo>[]): void {
  if (anexos.length < regra.min) {
    throw new ErroDeRegra(
      `${tipo} precisa de pelo menos ${String(regra.min)} arquivo(s), e veio ${String(anexos.length)}`,
      "anexe o que falta",
    );
  }
  if (regra.max !== undefined && anexos.length > regra.max) {
    throw new ErroDeRegra(
      `${tipo} aceita no máximo ${String(regra.max)} arquivo(s), e vieram ${String(anexos.length)}`,
      "submeta sem os excedentes",
    );
  }
  const repetido = anexos.find((a, i) => anexos.findIndex((b) => b.nome === a.nome) !== i);
  if (repetido) throw new ErroDeRegra(`dois anexos se chamam ${repetido.nome}`, "renomeie um deles");
  const classes = anexos.map((a) => {
    const classe = CLASSES_DO_MIME.find(([prefixo]) => a.mime.toLowerCase().startsWith(prefixo))?.[1];
    if (!classe || !regra.classes.includes(classe)) {
      throw new ErroDeRegra(
        `o anexo ${a.nome} (${a.mime}) não é de uma classe aceita por ${tipo}`,
        `${tipo} aceita só ${regra.classes.join(" ou ")}`,
      );
    }
    if (a.conteudo.length > LIMITE[classe]) {
      throw new ErroDeRegra(`o anexo ${a.nome} passa de ${String(LIMITE[classe])} bytes`, "anexe um arquivo menor");
    }
    return classe;
  });
  const exigida = regra.temClasse;
  if (exigida && !classes.some((c) => exigida.classes.includes(c))) {
    throw new ErroDeRegra(exigida.mensagem, `anexe também um arquivo ${exigida.classes.join(" ou ")}`);
  }
}

/**
 * CA-8 a CA-12 e CA-15: valida `dados` e anexos pelo schema do tipo, roda a regra pura do domínio antes de guardar
 * qualquer byte, e grava evidência, anexos e sessões externas numa transação só. O aviso é de sessão já contada.
 */
export const submeterEvidencia = (
  banco: DatabaseSync,
  id: string,
  entrada: EntradaEvidencia,
  autor: AutorDemanda,
  ctx: ContextoDemanda,
): { demanda: AgregadoDemanda; avisos: string[] } =>
  traduzir(() => {
    const { tipo, dados, arquivos, rodada_id } = EntradaEvidencia.parse(entrada);
    const schema = tipo === "custos_realizados" ? schemaDeEtapa(tipo) : schemaDe(tipo);
    const lidos = schema.dados.safeParse(dados);
    if (!lidos.success) {
      throw new ErroDeRegra(campos(lidos.error.issues, ["dados"]), "corrija o campo indicado e submeta de novo");
    }
    conferirAnexos(tipo, schema.arquivos, arquivos);
    const submeter = (ag: AgregadoDemanda) =>
      submeterEvidenciaDemanda(
        ag,
        { tipo, rodada_id, dados: lidos.data as EntradaEvidenciaDemanda["dados"] },
        autor,
        ctx.agora,
      );
    submeter(carregarDemanda(banco, id)); // recusa antes de guardar qualquer byte
    const guardados = arquivos.map((a) => ({ caminho: a.nome, mime: a.mime, ...guardarBytes(banco, a.conteudo) }));
    let avisos: string[] = [];
    const demanda = comDemanda(banco, id, submeter, () => {
      gravarAnexos(banco, { demanda_id: id, rodada_id, tipo }, guardados);
      if (tipo === "custos_realizados") ({ avisos } = registrarSessoesExternas(banco, id));
    });
    return { demanda, avisos };
  });
