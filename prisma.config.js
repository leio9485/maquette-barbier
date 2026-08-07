// ---------------------------------------------------------------------------
// Configuration de Prisma, l'outil qui cree et fait evoluer la base de donnees.
//
// Depuis sa version 7, Prisma ne lit plus le fichier .env tout seul et l'adresse
// de la base ne figure plus dans le schema : c'est ce fichier qui les fournit.
// Il s'appuie sur src/config.js pour designer exactement le meme fichier de
// base de donnees que le serveur.
// ---------------------------------------------------------------------------

import path from 'node:path';
import { defineConfig } from 'prisma/config';
import { DATABASE_URL } from './src/config.js';

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),

  datasource: {
    url: DATABASE_URL,
  },

  migrations: {
    // Commande lancee pour remplir une base neuve avec les donnees de depart.
    seed: 'node prisma/seed.js',
  },
});
