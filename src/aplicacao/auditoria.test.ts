// O pi de conversa fora do agregado (auditoria.ts): a subida do serviço mata o pi que a instância anterior deixou. A
// condução (subir, retomar, recusar com o agente trabalhando) é exercitada pela avaliação (avaliacao.test.ts).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { abrirBancoTemporario } from "../../apoio-testes/banco_temporario.ts";
import { instalarPiFalso } from "../../apoio-testes/pi_falso.ts";
import { gravarGrupoDaAvaliacao } from "../armazenamento/avaliacoes.ts";
import { setTimeout as dormir } from "node:timers/promises";
import { encerrar, situacao } from "./gerente.ts";
import { causaDaFalha, enviarNaConversa, estadoDaAuditoria, recuperarAuditorias, subir } from "./auditoria.ts";

async function esperar(condicao: () => boolean) {
  for (let repeticao = 0; !condicao(); repeticao++) {
    assert.ok(repeticao < 500, "o estado da auditoria não mudou em 5 s");
    await dormir(10);
  }
}

test("condução: sobe, envia, recusa ocupada e parando, sincroniza e retoma na mesma conversa", async () => {
  const raiz = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-auditoria-")));
  const pasta = join(raiz, "avaliacoes", "s-conducao");
  mkdirSync(pasta, { recursive: true });
  const piFalso = instalarPiFalso(raiz).roteirizar([{ fimDoAgente: true }]);
  let sincronizacoes = 0;
  const grupos: (number | null)[] = [];
  const conduzir = () =>
    subir(
      raiz,
      "s-conducao",
      "analise",
      { ociosidadeMin: 1 },
      {
        pasta: "avaliacoes",
        extensoes: [],
        gravarGrupo: (grupo) => grupos.push(grupo),
        sincronizar: () => {
          sincronizacoes++;
        },
      },
    );
  try {
    assert.equal(estadoDaAuditoria("s-conducao"), "conversa");
    const fim = conduzir();
    assert.equal(estadoDaAuditoria("s-conducao"), "rodando");
    assert.throws(() => {
      enviarNaConversa("s-conducao", "outra", () => assert.fail());
    }, /trabalhando/);
    await esperar(() => situacao("s-conducao")?.ocupado === false);
    assert.equal(estadoDaAuditoria("s-conducao"), "conversa");
    enviarNaConversa("s-conducao", "confira", () => assert.fail("o pi vivo deve receber a mensagem"));
    await esperar(() => piFalso.prompts().length === 2 && situacao("s-conducao")?.ocupado === false);
    encerrar("s-conducao");
    assert.equal(estadoDaAuditoria("s-conducao"), "rodando");
    assert.throws(() => {
      enviarNaConversa("s-conducao", "cedo", () => assert.fail());
    }, /ainda está parando/);
    assert.equal(await fim, undefined);
    assert.ok(sincronizacoes >= 3);
    assert.equal(typeof grupos[0], "number");
    assert.equal(grupos.at(-1), null);
    let retomada = "";
    enviarNaConversa("s-conducao", "retome", (prompt) => {
      retomada = prompt;
    });
    assert.equal(retomada, "retome");
    piFalso.roteirizar([{ sai: { codigo: 7, stderr: "falhou o provedor" } }]);
    const falha = await subir(
      raiz,
      "s-conducao",
      "analise",
      { ociosidadeMin: 1, modelo: null },
      {
        pasta: "avaliacoes",
        extensoes: [],
        gravarGrupo: () => undefined,
        sincronizar: () => {
          throw new Error("banco indisponível");
        },
      },
    );
    assert.ok(falha);
    assert.match(falha, /código 7/);
    assert.match(causaDaFalha(pasta, falha), /código 7.*falhou o provedor/s);
    assert.match(readFileSync(join(pasta, "log"), "utf8"), /sincronização falhou: Error: banco indisponível/);
    writeFileSync(
      join(pasta, "log"),
      "\n2026 pi comando\n2026 o pi da auditoria parou\nprimeira\nsegunda\nterceira\nquarta\nquinta\nsexta\n",
    );
    assert.equal(causaDaFalha(pasta, "motivo; veja o log em /log"), "motivo: segunda: terceira: quarta: quinta: sexta");
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test("recuperarAuditorias: mata o grupo de cada avaliação com pi, zera a coluna e ignora a que não tem", async () => {
  const { banco, fechar } = abrirBancoTemporario();
  try {
    recuperarAuditorias(banco); // nenhuma avaliação
    banco.exec(`INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube) VALUES ('d', '/r', 'main', 'github', 'k');
      INSERT INTO avaliacao (id, projeto, de, ate, pedido, criada_em) VALUES
        ('sem-pi', 'd', '2026-01-01', '2026-01-02', '', 't'), ('com-pi', 'd', '2026-01-01', '2026-01-02', '', 't')`);
    const sleep = spawn("sleep", ["300"], { detached: true, stdio: "ignore" });
    const saiu = once(sleep, "exit");
    gravarGrupoDaAvaliacao(banco, "com-pi", sleep.pid ?? 0);
    recuperarAuditorias(banco);
    assert.deepEqual(await saiu, [null, "SIGKILL"]);
    assert.equal(banco.prepare("SELECT count(*) AS n FROM avaliacao WHERE grupo_processo IS NOT NULL").get()?.n, 0);
  } finally {
    fechar();
  }
});
