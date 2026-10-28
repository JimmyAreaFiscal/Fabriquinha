// Sobe o serviço da Fabriquinha para o e2e: `node e2e/servidor.ts <raiz>`, com a porta e o pi falso no
// ambiente. SIGTERM para o serviço, como o systemd faria: depois do `parar` o processo sai sozinho, quando nada o
// segura, como o `fabriquinha servidor`; um condutor que acorda depois do banco fechado derruba a saída.
import { iniciarServico } from "../src/execucao/servico.ts";

const [raiz = ""] = process.argv.slice(2);
const servico = await iniciarServico(raiz);
process.once("SIGTERM", () => {
  void servico.parar();
});
