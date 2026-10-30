// Grupo do estresse das rotas POST e DELETE de `ROTAS`: uma ação por rota. Cada chamada age sobre um registro próprio do
// `Preparo`, já na fase que a rota exige (CA-2); a primeira chamada de uma ação prepara os registros das 200 de uma vez,
// e o cronômetro só começa depois (a preparação fica fora do tempo medido). O tempo vai do envio do pedido ao fim do
// corpo. Toda resposta é lida em busca de SQLITE_BUSY / "database is locked" (CA-3), e o status e o efeito gravado são
// conferidos (CA-2, CA-4). O pi é o falso do ambiente ($FABRIQUINHA_PI): nenhuma rota aqui inicia o `pi` real (CA-6).
import { Buffer } from "node:buffer";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ROTAS } from "../../src/web/servidor.ts";
import { abrir } from "../../src/persistencia/banco.ts";
import { carregarDemanda } from "../../src/persistencia/demandas.ts";
import { projeto } from "../../src/persistencia/projetos.ts";
import { alterarLimiteParalelismo, configuracao } from "../../src/persistencia/servico.ts";
import { exigirGit } from "../../src/repositorio/worktree.ts";
import { anexar } from "../../src/persistencia/simulacao.ts";
import type { Ambiente } from "../ambiente.ts";
import { criarPreparo } from "./preparo_demandas.ts";

/** Uma rota POST ou DELETE medida: `chamar` faz uma chamada e devolve o tempo em ms, ou lança quando o resultado é inesperado. */
export interface AcaoMutacao {
  metodo: "POST" | "DELETE";
  /** O padrão de `ROTAS`, que é o nome da ação na tabela. */
  caminho: string;
  /** Orçamento de p95 em ms: 3× o maior p95 medido em quatro execuções completas do grupo nesta máquina (Linux, Node 22, SQLite local), com o piso `PISO_ORCAMENTO`, para não virar teste instável. */
  orcamento: number;
  chamar(): Promise<number>;
}

/** Piso do orçamento em ms: rotas de poucas dezenas de ms variam além de 3× com a carga de fundo da máquina (pi falsos vivos, outros agentes). */
const PISO_ORCAMENTO = 250;

/** Os registros preparados por ação: tantos quantas as chamadas de `estresse.ts`. */
const CHAMADAS = 200;
const TRAVA = /SQLITE_BUSY|database is locked/i;
const DE = "2026-01-01";
const ATE = "2026-12-31";

/** O que uma chamada envia e o que espera de volta. */
interface Chamada {
  url: string;
  /** JSON, ou os bytes do anexo. */
  corpo?: unknown;
  status: number;
  /** Trecho que o corpo da resposta deve ter. */
  contem?: string;
  /** Confere o que ficou gravado; lança se for outro. */
  efeito?(): void;
}

function conferir(esperado: unknown, atual: unknown, oQue: string): void {
  if (esperado !== atual) throw new Error(`${oQue}: esperado ${String(esperado)}, gravado ${String(atual)}`);
}

/** Semeia o ambiente e devolve uma ação por rota POST e DELETE. O orçamento de cada uma fica ao lado dela. */
export async function acoesHttpMutacao(amb: Ambiente): Promise<AcaoMutacao[]> {
  const preparo = await criarPreparo(amb);
  // O cadastro confere `gh auth status`, que o gh falso da hospedagem não conhece: autenticado, como o do ambiente.
  const gh = join(amb.raiz, "bin", "gh");
  writeFileSync(
    gh,
    readFileSync(gh, "utf8").replace(/\n/, () => '\n[ "$1" = auth ] && exit 0\n'),
  );
  const banco = abrir(amb.raiz);
  // Cada chamada que fala com o pi deixa um pi falso vivo até a ociosidade: sem isto, o limite global de paralelismo (D04)
  // recusaria o "executar" com 409, e a medição seria a da fila, não a da rota.
  alterarLimiteParalelismo(banco, 100_000);
  const p = preparo.projeto;

  const fases = (id: string) => {
    const ag = carregarDemanda(banco, id);
    return { demanda: ag.demanda.fase, rodada: ag.rodadas[0]?.fase, ticket: ag.tickets.find((t) => t.ticket_id === 1) };
  };

  async function enviar(metodo: string, c: Chamada): Promise<number> {
    const inicio = performance.now();
    const corpo = Buffer.isBuffer(c.corpo) ? new Uint8Array(c.corpo) : JSON.stringify(c.corpo);
    const r = await fetch(`${amb.base}${c.url}`, {
      method: metodo,
      headers: {
        cookie: amb.cookie,
        "sec-fetch-site": "same-origin",
        ...(c.corpo !== undefined && {
          "content-type": Buffer.isBuffer(c.corpo) ? "application/octet-stream" : "application/json",
        }),
      },
      body: c.corpo === undefined ? undefined : corpo,
    });
    const texto = await r.text();
    const tempo = performance.now() - inicio;
    if (TRAVA.test(texto)) throw new Error(`${metodo} ${c.url}: banco ocupado (HTTP ${String(r.status)}): ${texto}`);
    if (r.status !== c.status)
      throw new Error(`${metodo} ${c.url}: HTTP ${String(r.status)}, esperado ${String(c.status)}: ${texto}`);
    if (c.contem && !texto.includes(c.contem)) throw new Error(`${metodo} ${c.url}: a resposta não traz "${c.contem}"`);
    c.efeito?.();
    return tempo;
  }

  /** `preparar` roda 200 vezes na primeira chamada; `montar` descreve o pedido de cada registro. */
  function acao<T>(
    metodo: "POST" | "DELETE",
    caminho: string,
    orcamento: number,
    preparar: () => T | Promise<T>,
    montar: (registro: T) => Chamada,
  ): AcaoMutacao {
    let registros: Promise<T[]> | undefined;
    let proximo = 0;
    const preparar200 = async () => {
      const lista: T[] = [];
      while (lista.length < CHAMADAS) lista.push(await preparar());
      return lista;
    };
    return {
      metodo,
      caminho,
      orcamento: Math.max(orcamento, PISO_ORCAMENTO),
      async chamar() {
        registros ??= preparar200();
        const registro = (await registros)[proximo++];
        if (registro === undefined) throw new Error(`${metodo} ${caminho}: sem registro preparado`);
        return enviar(metodo, montar(registro));
      },
    };
  }

  const demanda = (id: string) => `/api/demandas/${id}`;
  const rodada = (ref: string) => `/api/demandas/rodadas/${ref}`;
  const novo = (() => {
    let n = 0;
    return () => ++n;
  })();
  const formulario = (nome: string, repo: string) => ({
    nome,
    repo,
    branchBase: "main",
    preparacao: [],
    modelos: {},
    efforts: {},
  });
  /**
   * O cadastro e a edição conferem o `origin` (só GitHub ou Azure DevOps): aponta-o para um endereço do GitHub que o
   * `insteadOf` devolve ao bare local, então o `ls-remote` não sai para a rede.
   */
  const comOriginGitHub = async (repo: string): Promise<string> => {
    const url = `https://github.com/org/${String(novo())}`;
    await exigirGit(repo, "remote", "set-url", "origin", url);
    await exigirGit(repo, "config", `url.${join(dirname(repo), "origin.git")}.insteadOf`, url);
    return repo;
  };
  const raizDe = (nome: string) => projeto(banco, nome)?.repo ?? "";

  return [
    acao(
      "POST",
      "/api/demandas/:id/decisao",
      90,
      () => preparo.demandaEnviada(),
      (id) => ({
        url: `${demanda(id)}/decisao`,
        corpo: { aprovado: true },
        status: 200,
        efeito: () => {
          conferir("planejamento", fases(id).demanda, `fase de ${id}`);
        },
      }),
    ),
    acao(
      "POST",
      "/api/demandas/:id/planejamento/decisao",
      22800,
      () => preparo.planejamentoPronto(),
      (id) => ({
        url: `${demanda(id)}/planejamento/decisao`,
        corpo: { aprovado: true },
        status: 200,
        efeito: () => {
          conferir("execucao", fases(id).demanda, `fase de ${id}`);
        },
      }),
    ),
    acao(
      "POST",
      "/api/demandas/rodadas/:ref/pr",
      7070,
      () => preparo.rodadaComPR(),
      (r) => ({
        url: `${rodada(r.rodada)}/pr`,
        corpo: { aprovado: true, nota: 4 },
        status: 200,
        efeito: () => {
          conferir("concluida", fases(r.demanda).rodada, `fase da rodada ${r.rodada}`);
        },
      }),
    ),
    acao(
      "POST",
      "/api/demandas/rodadas/:ref/ajustes/mensagens",
      180,
      () => preparo.rodadaEmAjustes(),
      (ref) => ({
        url: `${rodada(ref)}/ajustes/mensagens`,
        corpo: { texto: "ajuste" },
        status: 204,
      }),
    ),
    acao(
      "POST",
      "/api/demandas/rodadas/:ref/ajustes/concluir",
      1600,
      () => preparo.rodadaEmAjustes(true),
      (ref) => ({
        url: `${rodada(ref)}/ajustes/concluir`,
        status: 200,
        efeito: () => {
          conferir("desenvolvimento", fases(ref.split(".")[0] ?? "").rodada, `fase da rodada ${ref}`);
        },
      }),
    ),
    acao(
      "POST",
      "/api/demandas/tickets/:ref/reabrir",
      90,
      () => preparo.ticketFalho(),
      (ref) => ({
        url: `/api/demandas/tickets/${ref}/reabrir`,
        corpo: { instrucao: "tente de novo" },
        status: 200,
        efeito: () => {
          conferir("aberto", fases(ref.split(".")[0] ?? "").ticket?.status, `status de ${ref}`);
        },
      }),
    ),
    acao(
      "POST",
      "/api/demandas/tickets/:ref/executar",
      20170,
      () => preparo.ticketAberto(),
      (ref) => ({
        url: `/api/demandas/tickets/${ref}/executar`,
        status: 204,
      }),
    ),
    acao(
      "POST",
      "/api/demandas/:id/cancelar",
      230,
      () => preparo.demandaEnviada(),
      (id) => ({
        url: `${demanda(id)}/cancelar`,
        status: 200,
        efeito: () => {
          conferir("cancelada", fases(id).demanda, `fase de ${id}`);
        },
      }),
    ),
    acao(
      "POST",
      "/api/demandas/:id/arquivar",
      60,
      () => preparo.demandaConcluida(),
      (id) => ({
        url: `${demanda(id)}/arquivar`,
        status: 200,
        efeito: () => {
          conferir("arquivada", fases(id).demanda, `fase de ${id}`);
        },
      }),
    ),
    acao(
      "POST",
      "/api/projetos/:nome/arquivar",
      60,
      () => preparo.projetoProprio(),
      (nome) => ({
        url: `/api/projetos/${nome}/arquivar`,
        status: 200,
        contem: '"arquivadas":0',
      }),
    ),
    acao(
      "POST",
      "/api/projetos",
      2920,
      async () => comOriginGitHub(await preparo.repositorioNovo()),
      (repo) => {
        const nome = `novo-${String(novo())}`;
        return {
          url: "/api/projetos",
          corpo: formulario(nome, repo),
          status: 200,
          efeito: () => {
            conferir(nome, projeto(banco, nome)?.nome, "projeto cadastrado");
          },
        };
      },
    ),
    acao(
      "POST",
      "/api/projetos/:nome",
      2150,
      async () => {
        const nome = await preparo.projetoProprio();
        await comOriginGitHub(raizDe(nome));
        return nome;
      },
      (nome) => ({
        url: `/api/projetos/${nome}`,
        corpo: formulario(nome, raizDe(nome)),
        status: 200,
      }),
    ),
    acao(
      "DELETE",
      "/api/projetos/:nome",
      1410,
      () => preparo.projetoProprio(),
      (nome) => ({
        url: `/api/projetos/${nome}`,
        status: 200,
        efeito: () => {
          conferir(undefined, projeto(banco, nome), `projeto ${nome} removido`);
        },
      }),
    ),
    acao(
      "POST",
      "/api/projetos/:nome/configuracao-sdlc",
      450,
      () => preparo.projetoProprio(),
      (nome) => ({
        url: `/api/projetos/${nome}/configuracao-sdlc`,
        corpo: {
          branch_base: "main",
          chave_sonarqube: nome,
          raiz_git: raizDe(nome),
          hospedagem: "github",
          etapas: [],
          fitness: [{ nome: "f", comando: "true", descricao: "d" }],
          linguagens: [{ caminho: ".", linguagem: "ts", comando_teste: "true" }],
        },
        status: 200,
      }),
    ),
    acao(
      "POST",
      "/api/configuracao",
      30,
      () => configuracao(banco),
      (atual) => ({
        url: "/api/configuracao",
        corpo: atual,
        status: 200,
      }),
    ),
    acao("POST", "/api/projetos/:nome/usuarios-simulados", 50, novo, (n) => ({
      url: `/api/projetos/${p}/usuarios-simulados`,
      corpo: { nome: `usuario-${String(n)}`, descricao: "d" },
      status: 200,
    })),
    acao(
      "POST",
      "/api/usuarios-simulados/:id/anexos",
      330,
      () => preparo.usuarioSimulado(),
      (id) => ({
        url: `/api/usuarios-simulados/${String(id)}/anexos?nome=a.txt`,
        corpo: Buffer.from("x"),
        status: 200,
      }),
    ),
    acao(
      "DELETE",
      "/api/usuarios-simulados/:id/anexos/:nome",
      50,
      () => {
        const id = preparo.usuarioSimulado();
        anexar(banco, id, "a.txt", Buffer.from("x"));
        return id;
      },
      (id) => ({ url: `/api/usuarios-simulados/${String(id)}/anexos/a.txt`, status: 204 }),
    ),
    acao(
      "POST",
      "/api/projetos/:nome/tarefas",
      100,
      () => preparo.usuarioSimulado(),
      (usuario) => ({
        url: `/api/projetos/${p}/tarefas`,
        corpo: { texto: "t", n: 1, usuarios: [usuario] },
        status: 200,
      }),
    ),
    acao(
      "POST",
      "/api/tarefas/:id/executar",
      460,
      () => preparo.tarefa(),
      (id) => ({
        url: `/api/tarefas/${String(id)}/executar`,
        status: 204,
      }),
    ),
    acao(
      "POST",
      "/api/sessoes/:sessao/mensagens",
      200,
      () => preparo.sessaoParada(),
      (sessao) => ({
        url: `/api/sessoes/${sessao}/mensagens`,
        corpo: { texto: "oi", modo: "prompt" },
        status: 204,
      }),
    ),
    // shortcut: sem pi vivo por chamada (200 pi ao mesmo tempo pesam demais), mede o caminho até a recusa 409 "não tem pi rodando"; upgrade: abrir o diálogo num pi falso vivo.
    acao(
      "POST",
      "/api/sessoes/:sessao/dialogos/:id",
      130,
      () => preparo.sessaoParada(),
      (sessao) => ({
        url: `/api/sessoes/${sessao}/dialogos/d1`,
        corpo: { confirmado: true },
        status: 409,
        contem: "pi rodando",
      }),
    ),
    // A avaliação precisa de uma demanda com sessão no período: cada chamada avalia a sua, para o pi falso não ler as 800 do banco.
    acao(
      "POST",
      "/api/avaliacoes",
      1000,
      async () => {
        const sessao = await preparo.sessaoParada();
        return (banco.prepare("SELECT demanda_id FROM sessao WHERE id = ?").get(sessao) as { demanda_id: string })
          .demanda_id;
      },
      (demanda) => ({
        url: "/api/avaliacoes",
        corpo: { projeto: p, de: DE, ate: ATE, demandas: [demanda] },
        status: 200,
      }),
    ),
    acao(
      "POST",
      "/api/avaliacoes/:id/mensagens",
      970,
      () => preparo.avaliacao(),
      (id) => ({
        url: `/api/avaliacoes/${id}/mensagens`,
        corpo: { texto: "oi" },
        status: 204,
      }),
    ),
    // shortcut: sem pi vivo por chamada, mede o caminho até a recusa 409; upgrade: como o diálogo acima.
    acao(
      "POST",
      "/api/avaliacoes/:id/abortar",
      30,
      () => preparo.avaliacao(),
      (id) => ({
        url: `/api/avaliacoes/${id}/abortar`,
        status: 409,
        contem: "pi rodando",
      }),
    ),
    acao(
      "POST",
      "/api/avaliacoes/:id/achados/:n/encaminhar",
      60,
      () => preparo.avaliacao(true),
      (id) => ({
        url: `/api/avaliacoes/${id}/achados/1/encaminhar`,
        status: 200,
      }),
    ),
    acao(
      "POST",
      "/api/sessoes/:sessao/abortar",
      290,
      () => preparo.sessaoRodando(),
      (sessao) => ({
        url: `/api/sessoes/${sessao}/abortar`,
        status: 204,
      }),
    ),
  ];
}

/** As rotas POST e DELETE de `ROTAS` que nenhuma ação mede, como `POST /caminho`; vazio quando a cobertura está completa. */
export function semMedicao(acoes: readonly Pick<AcaoMutacao, "metodo" | "caminho">[]): string[] {
  const medidas = new Set(acoes.map((a) => `${a.metodo} ${a.caminho}`));
  return ROTAS.filter((r) => r.metodo !== "GET")
    .map((r) => `${r.metodo} ${r.caminho}`)
    .filter((rota) => !medidas.has(rota));
}
