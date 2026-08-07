# ---------------------------------------------------------------------------
# Image de deploiement.
#
# Elle sert a mettre le site en ligne sans dependre d'un hebergeur en
# particulier : la meme image tourne sur Fly.io, Render, Koyeb, Railway ou un
# petit serveur a soi. Changer d'hebergeur ne demande donc pas de tout refaire —
# ce qui compte quand on commence par une offre gratuite.
#
# Deux choix a ne pas defaire :
#
#   - "slim" et non "alpine". Alpine utilise une autre bibliotheque systeme, pour
#     laquelle better-sqlite3 ne fournit pas de binaire tout pret : il faudrait
#     le compiler depuis les sources, donc installer Python et un compilateur
#     C++, pour une image finalement plus grosse et plus longue a construire.
#
#   - les dependances de developpement sont conservees. Le client Prisma est
#     engendre par la commande `prisma generate`, qui en fait partie, et les
#     migrations sont appliquees au demarrage par `prisma migrate deploy`.
# ---------------------------------------------------------------------------

FROM node:24-slim

WORKDIR /app

# Les dependances d'abord, le code ensuite : tant que package.json ne change
# pas, Docker reutilise l'installation deja faite au lieu de tout recommencer.
COPY package.json package-lock.json prisma.config.js ./
COPY prisma ./prisma

# Un seul fichier du code est copie avant l'installation, et il le faut :
# `npm ci` lance `prisma generate` (postinstall), qui lit prisma.config.js, qui
# demande a src/config.js ou se trouve la base. Sans lui, l'installation
# s'arrete sur "Cannot find module './src/config.js'".
#
# Ce fichier-la seulement, et non tout src/ : le reste du code change a chaque
# retouche du site, et Docker refarait alors l'installation complete des
# dependances a chaque fois.
COPY src/config.js ./src/config.js

RUN npm ci

COPY src ./src
COPY public ./public
COPY scripts ./scripts

# Emplacement de la base. Sur un hebergement sans disque persistant, ce dossier
# repart vide a chaque redemarrage : c'est sans consequence pour la
# demonstration, qui se reconstruit toute seule (voir src/lib/demo.js). Pour un
# vrai client, monter ici un volume — c'est tout ce qu'il y a a sauvegarder.
RUN mkdir -p /app/data
ENV DATABASE_URL="file:/app/data/commerce.db"

# Base creee ici, pendant la construction de l'image, et non au demarrage.
#
# Pourquoi : sur une offre gratuite, le serveur s'endort faute de visites et se
# rallume a la visite suivante — c'est-a-dire qu'il repart d'une image neuve.
# Tout ce qu'on lui fait faire au demarrage, le premier visiteur l'attend. Or
# `prisma migrate deploy` lance l'outil Prisma en entier : plusieurs secondes
# sur une petite machine, a chaque reveil. En construisant la base maintenant,
# le demarrage n'a plus qu'a lancer le serveur.
#
# `migrate deploy` applique les migrations manquantes et ne touche a rien
# d'autre — contrairement a `migrate dev`, fait pour le developpement, qui peut
# proposer de reconstruire la base.
RUN npx prisma migrate deploy

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Deux demarrages, selon l'instance.
#
#   - Demonstration : la base de l'image est deja a la bonne version (juste au-
#     dessus) et se remplit toute seule au premier appel. On demarre directement.
#   - Vrai client : la base vit sur un volume et peut dater d'une version
#     precedente du site. Les migrations manquantes doivent donc etre appliquees
#     a chaque demarrage, avant d'ouvrir le service.
CMD ["sh", "-c", "if [ \"$DEMO_MODE\" = \"true\" ]; then exec node src/server.js; else npx prisma migrate deploy && exec node src/server.js; fi"]
