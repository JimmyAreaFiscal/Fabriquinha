# Imagem do projeto de teste da rodada em container: node e git, nada além (a imagem completa do node já traz o git).
FROM node:22-bookworm
# A worktree montada tem dono diferente do usuário do container; sem isto o git recusa o repositório.
RUN git config --system --add safe.directory '*' \
    # O container não tem a configuração do git do host: o commit do ticket precisa de uma identidade.
    && git config --system user.name "Fabriquinha" \
    && git config --system user.email "fabriquinha@exemplo.com" \
    # Onde o AmbienteContainer grava o grupo de processos de cada comando.
    && mkdir -p /fabriquinha/pids \
    && chown node:node /fabriquinha/pids
# Usuário não-root (docker:S6471); a imagem do node já traz o `node`, uid 1000.
USER node
