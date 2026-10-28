// O pi de conversa fora do agregado (auditoria.ts): a subida do serviço mata o pi que a instância anterior deixou. A
// condução (subir, retomar, recusar com o agente trabalhando) é exercitada pela avaliação (avaliacao.test.ts).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { recuperarAuditorias } from "./auditoria.ts";

test("recuperarAuditorias: mata o grupo de cada pgid, apaga o arquivo e ignora o que não tem pgid", async () => {
  const outra = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-avaliacoes-")));
  try {
    recuperarAuditorias(outra); // nem pasta de avaliações
    const sem = join(outra, "avaliacoes", "sem-pgid");
    const com = join(outra, "avaliacoes", "com-pgid");
    mkdirSync(sem, { recursive: true });
    mkdirSync(com, { recursive: true });
    const sleep = spawn("sleep", ["300"], { detached: true, stdio: "ignore" });
    const saiu = once(sleep, "exit");
    writeFileSync(join(com, "pgid"), String(sleep.pid));
    recuperarAuditorias(outra);
    assert.deepEqual(await saiu, [null, "SIGKILL"]);
    assert.deepEqual([existsSync(join(com, "pgid")), existsSync(sem)], [false, true]);
  } finally {
    rmSync(outra, { recursive: true, force: true });
  }
});
