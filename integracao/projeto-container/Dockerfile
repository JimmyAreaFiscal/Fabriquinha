# Imagem do projeto de teste da rodada em container: node e git, nada além (a imagem completa do node já traz o git).
FROM node:22-bookworm
# A worktree montada tem dono diferente do usuário do container; sem isto o git recusa o repositório.
RUN git config --system --add safe.directory '*'
# Usuário não-root (docker:S6471); a imagem do node já traz o `node`, uid 1000.
USER node
