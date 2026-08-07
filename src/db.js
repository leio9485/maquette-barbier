// ---------------------------------------------------------------------------
// La connexion a la base de donnees.
//
// Tout le reste du projet passe par l'objet `prisma` exporte ici : c'est le
// seul point du code qui ouvre le fichier de base de donnees.
//
// `prisma.service.findMany()`, `prisma.booking.create()`... : ces methodes sont
// engendrees automatiquement a partir de prisma/schema.prisma. Ajouter un champ
// au schema puis relancer `npx prisma generate` les met a jour toutes seules.
// ---------------------------------------------------------------------------

import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from './generated/prisma/client.ts';
import { DATABASE_URL } from './config.js';

// L'"adaptateur" est la piece qui sait parler concretement a un fichier SQLite.
// Pour passer un jour a PostgreSQL, c'est cette ligne qui changerait.
const adapter = new PrismaBetterSqlite3({ url: DATABASE_URL });

export const prisma = new PrismaClient({ adapter });
