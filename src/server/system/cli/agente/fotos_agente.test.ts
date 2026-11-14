// Fotos do CLI do agente da demanda, gravadas do código de antes da refatoração da I-282: stdout, stderr e código de
// saída byte a byte para projeto ver, demanda ver, ticket ver, ticket criar, revisao decidir, evidencia schema e
// evidencia add. Aqui rodam no cliente empacotado (pacote-pi/bin/fabriquinha) contra a API de verdade, com os mesmos
// valores esperados; só a execução inexistente vira token desconhecido, que é como o transporte novo a recusa.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { gravarTokenDaExecucao } from "../../../../../apoio-testes/cenarios/cenario_da_api_do_agente.ts";
import { fabricaDeBancosTemporarios } from "../../../../../apoio-testes/banco/banco_temporario.ts";
import { gravarAgregadoPronto } from "../../../../../apoio-testes/cenarios/cenarios_de_demanda.ts";
import { servir } from "../../../../../apoio-testes/servidor_web_de_teste.ts";
import type { AgregadoDemanda } from "../../../../../apoio-testes/ciclo_de_vida/ciclo_de_vida_internos.ts";

const abrirBancoTemporario = fabricaDeBancosTemporarios();

const em = "2026-01-01T00:00:00.000Z";

interface Saida {
  codigo: number;
  out: string;
  err: string;
}

const CLIENTE_EMPACOTADO = join(import.meta.dirname, "../../../../../pacote-pi/bin/fabriquinha");

function cli(env: NodeJS.ProcessEnv, args: string[]): Promise<Saida> {
  return new Promise((resolver) => {
    const filho = execFile(process.execPath, [CLIENTE_EMPACOTADO, ...args], { env }, (erro, out, err) => {
      resolver({ codigo: erro === null ? 0 : Number(erro.code), out, err });
    });
    filho.stdin?.end();
  });
}

const ticket = (ticket_id: number, etapa: string, estado: string, extra: object = {}) => ({
  demanda_id: "I-206",
  ticket_id,
  etapa,
  estado,
  estado_alterado_em: em,
  criado_por: { tipo: "fabriquinha" },
  ...extra,
});

/** Demanda I-206 do projeto `loja` em `estado` e a execução `exec-9` aberta no ticket T9 (de `etapa`). */
async function cenario(estado: string, rodadas: object[], tickets: object[]) {
  const { raiz, banco } = abrirBancoTemporario();
  banco.exec(`INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube)
    VALUES ('loja', '/repos/loja', 'main', 'github', 'k')`);
  gravarAgregadoPronto(banco, {
    demanda: {
      id: "I-206",
      projeto: "loja",
      titulo: "Busca",
      tipo: "funcionalidade",
      descricao: "d",
      estado,
      estado_alterado_em: em,
      criada_por: { tipo: "externo", ferramenta: "claude", sessao: "s1" },
      enviada: true,
      branch: "fabriquinha/I-206",
    },
    rodadas,
    dependencias_rodada: [],
    criterios_citados: [],
    tickets,
    tentativas: [],
    dependencias_ticket: [],
    caminhos_ticket: [],
    arquivos_previstos_rodada: [],
    arquivos_previstos_demanda: [],
    versoes_plano: [],
    decisoes: [],
    evidencias: [
      {
        demanda_id: "I-206",
        tipo: "criterios_aceite",
        autor: { tipo: "externo", ferramenta: "claude", sessao: "s1" },
        em,
        dados: { criterios: [{ id: "CA-1" }] },
      },
    ],
  } as unknown as AgregadoDemanda);
  abrirExecucao(banco, "exec-9", 9);
  gravarTokenDaExecucao(banco, "exec-9", "token-exec-9");
  const { porta } = await servir(banco);
  return { raiz, banco, env: { FABRIQUINHA_API: `127.0.0.1:${String(porta)}`, FABRIQUINHA_TOKEN: "token-exec-9" } };
}

function abrirExecucao(banco: ReturnType<typeof abrirBancoTemporario>["banco"], id: string, ticket_id: number): void {
  banco.exec(`INSERT INTO trabalho_agentico VALUES ('s-${id}', 'I-206', ${String(ticket_id)}, 'autonomo', 's-${id}');
    INSERT INTO processo_do_trabalho (id, trabalho_id, inicio, falha) VALUES ('${id}', 's-${id}', '${em}', 0)`);
}

const rodada = (estado: string) => ({
  demanda_id: "I-206",
  rodada_id: 2,
  titulo: "r2",
  estado,
  estado_alterado_em: em,
  e2e: false,
  branch: "fabriquinha/I-206-2",
});

/** O ticket T9 do agente na rodada 2, com o T3 de implementação ao lado. */
const naRodada = (fase: string, etapa: string) =>
  cenario(
    "em_execucao",
    [rodada(fase)],
    [ticket(3, "implementar", "concluido", { rodada_id: 2 }), ticket(9, etapa, "em_execucao", { rodada_id: 2 })],
  );

/** A saída é igual à gravada: stdout, stderr e código de saída. */
const foto = (s: Saida, esperado: Saida): void => {
  assert.deepEqual(s, esperado);
};

test("foto projeto ver: devolve o projeto da demanda; execução que não existe é recusada; argumento a mais é uso inválido", async () => {
  const { env } = await naRodada("revisar_rodada", "revisar_rodada");
  foto(await cli(env, ["projeto", "ver"]), {
    codigo: 0,
    out: '{"nome":"loja","raiz_git":"/repos/loja","branch_base":"main","hospedagem":"github","chave_sonarqube":"k","etapas":[],"verificacoes":{"preparacao":[],"fitness":[],"linguagens":[],"e2e":[],"globs":[]}}\n',
    err: "",
  });
  foto(await cli({ ...env, FABRIQUINHA_TOKEN: "token-x" }, ["projeto", "ver"]), {
    codigo: 1,
    out: "",
    err: "token ausente, desconhecido ou de execução encerrada (confira FABRIQUINHA_TOKEN)\n",
  });
  foto(await cli(env, ["projeto", "ver", "a-mais"]), {
    codigo: 2,
    out: "",
    err: "argumento a mais: a-mais\n\nUso:\n\nAgente de uma execução da demanda (tickets e rodadas pelo endereço, como I-206.T3 e I-206.R2):\n  fabriquinha projeto ver\n\nCom FABRIQUINHA_EXECUCAO, só os comandos do agente; sem ela, só servidor, abrir, demanda e --help.\nIDs aceitam I-12 ou 12; --descricao e --dados leem de um arquivo, ou do stdin com -.\n",
  });
});

test("foto demanda ver: a própria demanda; outra demanda é recusada", async () => {
  const { env } = await naRodada("revisar_rodada", "revisar_rodada");
  foto(await cli(env, ["demanda", "ver", "I-206"]), {
    codigo: 0,
    out: '{"demanda":{"id":"I-206","projeto":"loja","titulo":"Busca","tipo":"funcionalidade","descricao":"d","estado":"em_execucao","estado_alterado_em":"2026-01-01T00:00:00.000Z","origem_ferramenta":"claude","origem_sessao":"s1","enviada":true,"branch":"fabriquinha/I-206"},"rodadas":[{"rodada":"I-206.R2","titulo":"r2","estado":"revisar_rodada","estado_alterado_em":"2026-01-01T00:00:00.000Z","e2e":false,"branch":"fabriquinha/I-206-2"}],"decisoes":[],"tickets":[{"ticket":"I-206.T3","rodada":"I-206.R2","etapa":"implementar","estado":"concluido","estado_alterado_em":"2026-01-01T00:00:00.000Z"},{"ticket":"I-206.T9","rodada":"I-206.R2","etapa":"revisar_rodada","estado":"em_execucao","estado_alterado_em":"2026-01-01T00:00:00.000Z","evidencias":[]}]}\n',
    err: "",
  });
  foto(await cli(env, ["demanda", "ver", "I-999"]), {
    codigo: 1,
    out: "",
    err: "o agente só lê a própria demanda (leia I-206, a do seu ticket I-206.T9)\n",
  });
});

test("foto ticket ver: o próprio ticket; ticket de outro é recusado", async () => {
  const { env } = await naRodada("revisar_rodada", "revisar_rodada");
  foto(await cli(env, ["ticket", "ver", "I-206.T9"]), {
    codigo: 0,
    out: '{"ticket":"I-206.T9","rodada":"I-206.R2","etapa":"revisar_rodada","estado":"em_execucao","estado_alterado_em":"2026-01-01T00:00:00.000Z"}\n',
    err: "",
  });
  foto(await cli(env, ["ticket", "ver", "I-206.T3"]), {
    codigo: 1,
    out: "",
    err: "o agente só lê o próprio ticket (leia I-206.T9)\n",
  });
});

test("foto ticket criar: cria o corretivo na rodada; sem título é recusado", async () => {
  const { env } = await naRodada("ajustar_resultado", "ajustar_resultado");
  foto(await cli(env, ["ticket", "criar", "I-206.R2"]), {
    codigo: 1,
    out: "",
    err: "falta o título do ticket corretivo (passe --titulo <texto>)\n",
  });
  foto(await cli(env, ["ticket", "criar", "I-206.R2", "--titulo", "Corrigir"]), {
    codigo: 0,
    out: '{"rodada":"I-206.R2","tickets":["I-206.T10"]}\n',
    err: "",
  });
});

test("foto revisao decidir: veredito inválido é recusado; reprovar com correções registra a decisão", async () => {
  const { env } = await naRodada("revisar_rodada", "revisar_rodada");
  foto(await cli(env, ["revisao", "decidir", "I-206.T9", "talvez"]), {
    codigo: 1,
    out: "",
    err: 'veredito "talvez" inválido (use aprovar ou reprovar)\n',
  });
  const correcoes = JSON.stringify([{ titulo: "a", descricao: "b" }]);
  foto(await cli(env, ["revisao", "decidir", "I-206.T9", "reprovar", "--motivo", "falta", "--correcoes", correcoes]), {
    codigo: 0,
    out: '{"ticket":"I-206.T9","rodada":"I-206.R2","resultado":"reprovado"}\n',
    err: "",
  });
});

test("foto evidencia schema e add: schema do tipo; tipo desconhecido; dados inválidos não gravam; plano válido grava", async () => {
  const { raiz, env } = await cenario("planejar", [], [ticket(9, "planejar", "em_execucao")]);
  foto(await cli(env, ["evidencia", "schema", "testes_estresse"]), {
    codigo: 0,
    out: '{"dados":{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"aplicavel":{"type":"boolean"},"justificativa":{"description":"obrigatória se aplicavel é false","type":"string","minLength":1,"maxLength":2000},"cenarios":{"type":"array","items":{"type":"object","properties":{"nome":{"type":"string","minLength":1,"maxLength":120,"pattern":"^[^\\\\n]*$"},"objetivo":{"type":"string","minLength":1,"maxLength":2000},"comando":{"type":"string","minLength":1},"resultado":{"type":"string","enum":["passou","quebrou"]},"observado":{"type":"string","minLength":1,"maxLength":2000}},"required":["nome","objetivo","comando","resultado","observado"]}}},"required":["aplicavel","cenarios"]},"arquivos":{"classes":["texto"],"min":0}}\n',
    err: "",
  });
  foto(await cli(env, ["evidencia", "schema", "nada"]), {
    codigo: 1,
    out: "",
    err: "nada não é evidência que o agente submete (use um de plano, explicacao_fitness, comprovacao_criterios, mensagem_pr, aula_codigo, video_demonstracao, testes_estresse, analise_seguranca)\n",
  });
  const PLANO = {
    demanda_id: "I-206",
    criterios: ["CA-1"],
    rodadas: [{ demanda_id: "I-206", rodada_id: 1, titulo: "r1", e2e: false, criterios: ["CA-1"], depende: [] }],
    tickets: [
      { demanda_id: "I-206", ticket_id: 1, rodada_id: 1, titulo: "t", descricao: "d", caminhos: [], depende: [] },
    ],
  };
  const arquivoDeDados = (conteudo: object, nome: string) => {
    const caminho = join(raiz, nome);
    writeFileSync(caminho, JSON.stringify(conteudo));
    return caminho;
  };
  const invalido = arquivoDeDados({ ...PLANO, criterios: "CA-1" }, "invalido.json");
  foto(await cli(env, ["evidencia", "add", "I-206.T9", "plano", "--dados", invalido]), {
    codigo: 1,
    out: "",
    err: "✖ Entrada inválida: esperava um vetor, recebeu um texto → at dados.criterios\n",
  });
  const valido = arquivoDeDados(PLANO, "valido.json");
  foto(await cli(env, ["evidencia", "add", "I-206.T9", "plano", "--dados", valido]), {
    codigo: 0,
    out: '{"ticket":"I-206.T9","tipo":"plano"}\n',
    err: "",
  });
});
