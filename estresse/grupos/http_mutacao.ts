// Grupo do estresse das rotas POST e DELETE de `ROTAS`: uma ação por rota. Cada chamada age sobre um registro próprio do
// `Preparo`, já no estado que a rota exige (CA-2); a primeira chamada de uma ação prepara os registros de todas de uma vez,
// e o cronômetro só começa depois (a preparação fica fora do tempo medido). O tempo vai do envio do pedido ao fim do
// corpo. Toda resposta é lida em busca de SQLITE_BUSY / "database is locked" (CA-3), e o status e o efeito gravado são
// conferidos (CA-2, CA-4). O pi é o falso do ambiente ($FABRIQUINHA_PI): nenhuma rota aqui inicia o `pi` real (CA-6).
import { Buffer } from "node:buffer";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ROTAS } from "../../src/entrega/http/servidor.ts";
import { inserirAmbienteAlocado, liberarAmbiente, listarAmbientes } from "../../src/sandbox/armazenamento/ambientes.ts";
import { abrir } from "../../src/compartilhado/armazenamento/banco.ts";
import { carregarDemanda } from "../../src/sdlc/armazenamento/demandas.ts";
import { buscarProjeto } from "../../src/projeto/armazenamento/projetos.ts";
import { configuracao } from "../../src/compartilhado/armazenamento/servico.ts";
import { exigirGit } from "../../src/repositorio/infra/worktree/worktree.ts";
import { anexar } from "../../src/qualidade/armazenamento/simulacao.ts";
import { instalarDockerFalso } from "../../apoio-testes/docker_falso.ts";
import type { Ambiente } from "../instancia_descartavel.ts";
import { CHAMADAS } from "../medir.ts";
import { criarPreparo } from "./preparo_demandas.ts";
import { configuracaoDoAmbiente } from "../../src/sandbox/armazenamento/configuracao_do_ambiente.ts";

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
  // O DELETE de ambiente chama o `docker` do serviço: o falso entra à frente no PATH dele, que já traz `bin/`, e o estresse
  // nunca chama o Docker real.
  const dockerDir = join(amb.raiz, "docker-falso");
  const dockerFalso = instalarDockerFalso(dockerDir);
  const docker = join(amb.raiz, "bin", "docker");
  writeFileSync(docker, `#!/bin/sh\nFALSO_DOCKER_DIR='${dockerDir}' exec '${join(dockerDir, "bin", "docker")}' "$@"\n`);
  chmodSync(docker, 0o755);
  const banco = abrir(amb.raiz);
  // Cada chamada que fala com o pi deixa um pi falso vivo até a ociosidade: sem isto, o limite global de paralelismo (D04)
  // recusaria o "executar" com 409, e a medição seria a da fila, não a da rota.
  banco.prepare("UPDATE configuracao SET limite_paralelismo = 100000").run();
  const p = preparo.projeto;

  const estados = (id: string) => {
    const ag = carregarDemanda(banco, id);
    return {
      demanda: ag.demanda.estado,
      rodada: ag.rodadas[0]?.estado,
      ticket: ag.tickets.find((t) => t.ticket_id === 1),
    };
  };

  async function enviar(metodo: string, c: Chamada): Promise<number> {
    const inicio = performance.now();
    const corpo = Buffer.isBuffer(c.corpo) ? new Uint8Array(c.corpo) : JSON.stringify(c.corpo);
    const falhou = (e: unknown) =>
      new Error(`${metodo} ${c.url}: fetch falhou: ${e instanceof Error ? e.message : String(e)}`, { cause: e });
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
    }).catch((e: unknown) => {
      throw falhou(e);
    });
    const texto = await r.text().catch((e: unknown) => {
      throw falhou(e);
    });
    const tempo = performance.now() - inicio;
    if (TRAVA.test(texto)) throw new Error(`${metodo} ${c.url}: banco ocupado (HTTP ${String(r.status)}): ${texto}`);
    if (r.status !== c.status)
      throw new Error(`${metodo} ${c.url}: HTTP ${String(r.status)}, esperado ${String(c.status)}: ${texto}`);
    if (c.contem && !texto.includes(c.contem)) throw new Error(`${metodo} ${c.url}: a resposta não traz "${c.contem}"`);
    c.efeito?.();
    return tempo;
  }

  /** `preparar` roda uma vez por chamada, todas na primeira; `montar` descreve o pedido de cada registro. */
  function acao<T>(
    metodo: "POST" | "DELETE",
    caminho: string,
    orcamento: number,
    preparar: () => T | Promise<T>,
    montar: (registro: T) => Chamada,
  ): AcaoMutacao {
    let registros: Promise<T[]> | undefined;
    let proximo = 0;
    const prepararTodos = async () => {
      const lista: T[] = [];
      while (lista.length < CHAMADAS) lista.push(await preparar());
      return lista;
    };
    return {
      metodo,
      caminho,
      orcamento: Math.max(orcamento, PISO_ORCAMENTO),
      async chamar() {
        registros ??= prepararTodos();
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
    raiz_git: repo,
    branch_base: "main",
    preparacao: [],
    configuracoes: {},
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
  const raizDe = (nome: string) => buscarProjeto(banco, nome)?.raiz_git ?? "";

  return [
    acao(
      "POST",
      "/api/demandas/:id/decisao",
      90,
      () => preparo.demandaEnviada(),
      (id) => ({
        url: `${demanda(id)}/decisao`,
        corpo: { resultado: "aprovado" },
        status: 200,
        efeito: () => {
          conferir("planejar", estados(id).demanda, `estado de ${id}`);
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
        corpo: { resultado: "aprovado" },
        status: 200,
        efeito: () => {
          conferir("em_execucao", estados(id).demanda, `estado de ${id}`);
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
        corpo: { resultado: "aprovado", nota: 4 },
        status: 200,
        efeito: () => {
          conferir("concluida", estados(r.demanda).rodada, `estado da rodada ${r.rodada}`);
        },
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
          conferir("implementar", estados(ref.split(".")[0] ?? "").rodada, `estado da rodada ${ref}`);
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
          conferir("aberto", estados(ref.split(".")[0] ?? "").ticket?.estado, `status de ${ref}`);
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
          conferir("cancelada", estados(id).demanda, `estado de ${id}`);
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
          conferir("arquivada", estados(id).demanda, `estado de ${id}`);
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
            conferir(nome, buscarProjeto(banco, nome)?.nome, "projeto cadastrado");
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
          conferir(undefined, buscarProjeto(banco, nome), `projeto ${nome} removido`);
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
          verificacoes: {
            fitness: [{ nome: "f", comando: "true", descricao: "d" }],
            linguagens: [{ caminho: ".", linguagem: "ts", comando_teste: "true" }],
          },
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
    acao(
      "POST",
      "/api/ambiente",
      30,
      () => configuracaoDoAmbiente(banco),
      (atual) => ({
        url: "/api/ambiente",
        corpo: atual,
        status: 200,
      }),
    ),
    acao(
      "DELETE",
      "/api/ambiente/:id",
      250,
      () => {
        const id = `amb-estresse-${String(novo())}`;
        const container = dockerFalso.semearContainer({ rotulos: { "fabriquinha.ambiente": id } });
        inserirAmbienteAlocado(banco, {
          id,
          container_id: container.id,
          imagem: "alpine",
          criado_em: new Date().toISOString(),
          alocado_para: "espaco-estresse",
        });
        liberarAmbiente(banco, id, "livre", new Date().toISOString());
        return { id, container: container.id };
      },
      ({ id, container }) => ({
        url: `/api/ambiente/${id}`,
        status: 204,
        efeito: () => {
          conferir(
            false,
            listarAmbientes(banco).some((a) => a.id === id),
            `ambiente ${id} no banco`,
          );
          conferir(false, existsSync(join(dockerDir, "containers", container)), `container de ${id} no docker`);
        },
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
      () => preparo.sessaoParada(false),
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
        const sessao = await preparo.sessaoParada(false);
        return (
          banco.prepare("SELECT demanda_id FROM trabalho_agentico WHERE id = ?").get(sessao) as { demanda_id: string }
        ).demanda_id;
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
