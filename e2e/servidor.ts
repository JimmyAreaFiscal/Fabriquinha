// Sobe o serviço da Fabriquinha para o e2e: `node e2e/servidor.ts <raiz> <pacote>`, com a porta e o pi falso no
// ambiente. SIGTERM para o serviço, como o systemd faria.
import { iniciarServico } from "../src/execucao/servico.ts";

const [raiz = "", pacote = ""] = process.argv.slice(2);
const servico = await iniciarServico(raiz, pacote);
process.once("SIGTERM", () => {
  void servico.parar().then(() => process.exit(0));
});
