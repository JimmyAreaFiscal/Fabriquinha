// Sobe o serviço da Fabriquinha para o e2e: `node e2e/servidor.ts <raiz>`, com a porta e o pi falso no
// ambiente. SIGTERM para o serviço, como o systemd faria: depois do `parar` o processo sai com `process.exit`, como o
// `fabriquinha servidor`.
import { iniciarServico } from "../src/execucao/servico.ts";

const [raiz = ""] = process.argv.slice(2);
const servico = await iniciarServico(raiz);
process.once("SIGTERM", () => {
  void servico.parar().then(() => process.exit(0));
});
