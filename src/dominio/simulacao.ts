// Simulação (F8): o Usuário Simulado, o nome dos seus anexos, a Tarefa e o resultado das execuções. Sem I/O.
import { extname } from "node:path";
import { z } from "zod";
import { Id } from "./primitivos.ts";

/** Pessoa fictícia do projeto (F8 §2): o nome e a descrição do usuário e do seu conhecimento, que vão para a IA. */
export const NovoUsuarioSimulado = z.strictObject({
  nome: z.string().trim().min(1, "Nome obrigatório").max(80),
  descricao: z.string().trim().min(1, "Descrição obrigatória").max(4000),
});

/** Só PDF, texto e imagem: o que o pi lê como `@arquivo` (F8 §2). */
const FORMATOS = new Set([".pdf", ".txt", ".md", ".csv", ".png", ".jpg", ".jpeg", ".webp", ".gif"]);

/** O nome do anexo vira nome de arquivo na pasta da execução: sem `/` nem caractere de controle. */
export const NomeDoAnexo = z
  .string()
  .min(1)
  .max(200)
  .refine((nome) => !/[/\p{Cc}]/u.test(nome), "o nome do arquivo não pode ter / nem caracteres de controle")
  .refine((nome) => FORMATOS.has(extname(nome).toLowerCase()), "formato não suportado: envie PDF, texto ou imagem");

const N_INVALIDO = "N deve ser um inteiro maior que zero";

/** O que o usuário simulado deve tentar fazer, quantas vezes cada um o faz e quais usuários do projeto o fazem (F8 §3). */
export const NovaTarefa = z.strictObject({
  texto: z.string().trim().min(1, "Tarefa obrigatória").max(2000),
  n: z.number(N_INVALIDO).int(N_INVALIDO).min(1, N_INVALIDO).max(20, "N passa de 20"),
  usuarios: z.array(Id).min(1, "Aloque ao menos um usuário simulado"),
});

export type NovoUsuarioSimulado = z.infer<typeof NovoUsuarioSimulado>;

/** Onde está uma execução simulada (F8 §4): `na_fila` e `em_andamento` são as pendentes. */
export const StatusExecucaoSimulada = z.enum(["na_fila", "em_andamento", "concluida", "falhou"]);
export type StatusExecucaoSimulada = z.infer<typeof StatusExecucaoSimulada>;

const Achados = z.array(z.string().min(1).max(2000)).max(50);

/** O que o Usuário Simulado entrega ao terminar (`relatar`): os problemas de usabilidade e os bugs que achou. */
export const RelatorioSimulacao = z.object({ usabilidade: Achados, bugs: Achados });
export type RelatorioSimulacao = z.infer<typeof RelatorioSimulacao>;

export const SEM_LINK = "Informe o link do produto na Configuração do projeto";
export const LINK_FORA_DO_AR = "Não foi possível abrir o link do produto";
