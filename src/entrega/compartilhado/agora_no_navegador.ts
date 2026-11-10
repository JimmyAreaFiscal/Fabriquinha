// O único ponto em que o cliente web lê a hora: as telas recebem o instante daqui, e o resto do cliente só converte
// instantes ISO que vieram da API. Roda no navegador: módulo puro, sem imports.

/** @testes as telas da R11 passam a ler o agora daqui; os testes das telas passam o instante como argumento */
export const agoraNoNavegador = (): number => Date.now();
