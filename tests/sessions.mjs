// ---------------------------------------------------------------------------
// TESTS DES SESSIONS (lot E, point E1)
//
//     npm run test:sessions      (aucun serveur necessaire : elle lance le sien)
//
// >>> CE QUE L'AUDIT A VU, ET CE QUI SE PASSAIT VRAIMENT. <<<
//
// Constat : l'instance de demonstration s'endort, un appel la reveille, et la
// session ouverte est perdue — /api/admin/me repond 401. Conclusion tiree :
// « les sessions semblent tenues en memoire vive ».
//
// ELLES NE LE SONT PAS, ET NE L'ONT JAMAIS ETE. Chaque session est une ligne de
// la table `Session` (voir prisma/schema.prisma et src/lib/sessions.js), avec
// son jeton, son compte et sa date d'expiration. C'est ce qui permet deja de
// couper un acces a distance et de fermer les autres sessions au changement de
// mot de passe.
//
// Ce qui disparait au reveil, c'est LA BASE ENTIERE : l'offre gratuite de
// l'hebergeur n'a pas de disque persistant, le conteneur repart neuf, et la base
// est reconstruite depuis defaults.js (CLAUDE.md le dit pour les tarifs et les
// rendez-vous ; les sessions suivent le meme sort, et les comptes aussi). Le
// remede n'est pas de changer de mecanique de session — celle-ci est deja la
// bonne — c'est un disque, donc un plan payant.
//
// CETTE SUITE EPROUVE LA MECANIQUE, PAS L'HEBERGEUR : elle lance une instance,
// ouvre une session, TUE LE SERVEUR, le relance, et verifie que le meme cookie
// ouvre encore l'espace. Si un jour quelqu'un remplace ce magasin par une carte
// en memoire, cette suite passera au rouge le jour meme.
// ---------------------------------------------------------------------------

import { spawn } from 'node:child_process';
import { copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ICI = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.join(ICI, '..');

const PORT = 3198;
const BASE = `http://localhost:${PORT}`;

// Sa propre base, copiee depuis celle de developpement pour en reprendre le
// SCHEMA. Meme procede que tests/demonstration.mjs, et pour la meme raison :
// on ne touche jamais a la base de developpement, et on evite d'attendre
// `prisma migrate`.
const BASE_TEST = path.join(RACINE, 'data', 'sessions-test.db');
const BASE_SOURCE = path.join(RACINE, 'data', 'commerce.db');

// AVANT tout import de src/ : c'est cette ligne qui protege la base de
// developpement.
process.env.DATABASE_URL = `file:${BASE_TEST}`;

const { creerVerificateur } = await import('./helpers.mjs');
const { prisma } = await import('../src/db.js');
const { hashPassword } = await import('../src/lib/passwords.js');

const { verifie, bilan } = creerVerificateur();

const IDENTIFIANT = 'compte-de-test-sessions';
const MOT_DE_PASSE = 'mot-de-passe-de-test-jetable-3312';

let serveur = null;

/** Lance une instance sur la base de test, et attend qu'elle reponde. */
async function demarrerServeur({ production = false } = {}) {
  serveur = spawn(process.execPath, [path.join(RACINE, 'src', 'server.js')], {
    cwd: RACINE,
    env: {
      ...process.env,
      DATABASE_URL: `file:${BASE_TEST}`,
      PORT: String(PORT),
      // ⚠️ JAMAIS DEMO_MODE ICI : une partie de la suite verifie qu'une
      //    instance ordinaire n'en porte aucune trace, et le compte `demo`
      //    resterait en base (voir CLAUDE.md, « Les pieges »).
      DEMO_MODE: '',
      NODE_ENV: production ? 'production' : 'development',
    },
    stdio: process.env.SESSIONS_TEST_VERBEUX ? 'inherit' : 'ignore',
  });

  for (let essai = 0; essai < 300; essai++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return;
    } catch {
      // pas encore la
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("L'instance de test n'a pas demarre.");
}

function arreterServeur() {
  if (serveur && !serveur.killed) serveur.kill();
  serveur = null;
}

/** Attend que le port soit vraiment rendu : tuer n'est pas instantane. */
async function attendreArret() {
  for (let essai = 0; essai < 100; essai++) {
    try {
      await fetch(`${BASE}/api/health`);
    } catch {
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** Une connexion, et le cookie qu'elle rend. */
async function seConnecter() {
  const reponse = await fetch(`${BASE}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: IDENTIFIANT, password: MOT_DE_PASSE }),
  });

  const brut = (reponse.headers.getSetCookie?.() ?? []).find((c) => c.startsWith('sc_session='));
  return { status: reponse.status, brut, cookie: brut ? brut.split(';')[0] : '' };
}

const moi = (cookie) => fetch(`${BASE}/api/admin/me`, { headers: { Cookie: cookie } });

let code = 0;

try {
  await rm(BASE_TEST, { force: true });
  await copyFile(BASE_SOURCE, BASE_TEST);

  // Le compte de test, ecrit directement dans la base de test.
  await prisma.adminUser.deleteMany({ where: { username: IDENTIFIANT } });
  await prisma.adminUser.create({
    data: { username: IDENTIFIANT, passwordHash: await hashPassword(MOT_DE_PASSE) },
  });

  await demarrerServeur();

  // --- 1. Le cookie remis a la connexion -----------------------------------
  console.log('1. Le cookie de session');

  const premiere = await seConnecter();
  {
    verifie('la connexion aboutit', premiere.status === 200, premiere.status);
    verifie('un cookie de session est depose', Boolean(premiere.brut), premiere.brut);
    verifie('il est httpOnly', /httponly/i.test(premiere.brut ?? ''), premiere.brut);
    verifie('il est en SameSite=Lax', /samesite=lax/i.test(premiere.brut ?? ''), premiere.brut);
    verifie('il vaut pour tout le site', /path=\//i.test(premiere.brut ?? ''), premiere.brut);

    // Une expiration raisonnable : assez longue pour qu'un commercant ne
    // resaisisse pas son mot de passe chaque matin, assez courte pour qu'un
    // appareil oublie quelque part finisse par se fermer.
    const expire = /expires=([^;]+)/i.exec(premiere.brut ?? '');
    const jours = expire ? (Date.parse(expire[1]) - Date.now()) / 86400000 : null;
    verifie('il expire dans quelques jours, ni tout de suite ni jamais',
      jours !== null && jours > 1 && jours < 40, jours);
  }
  {
    const r = await moi(premiere.cookie);
    verifie('la session ouvre bien l\'espace', r.status === 200, r.status);
  }
  {
    // >>> ELLE EST EN BASE, PAS EN MEMOIRE. <<< C'est ce que la section
    //     suivante demontre par le comportement ; ici on le lit noir sur blanc.
    const lignes = await prisma.session.count();
    verifie('la session existe comme ligne de la base', lignes >= 1, lignes);
  }

  // --- 2. LE REDEMARRAGE ----------------------------------------------------
  //
  // C'est le test de ce lot. Chez un client, chaque mise en ligne redemarre le
  // serveur : si les sessions n'y survivaient pas, le commercant serait
  // deconnecte a chaque deploiement, eventuellement en pleine journee.
  console.log('\n2. Le serveur redemarre');
  {
    arreterServeur();
    await attendreArret();

    let injoignable = false;
    try {
      await fetch(`${BASE}/api/health`);
    } catch {
      injoignable = true;
    }
    verifie('le serveur est bien arrete', injoignable, 'il repond encore');

    await demarrerServeur();

    const r = await moi(premiere.cookie);
    verifie('>>> LE MEME COOKIE OUVRE ENCORE L\'ESPACE <<<', r.status === 200, r.status);

    const donnees = await r.json().catch(() => null);
    verifie('et c\'est bien le meme compte',
      donnees?.username === IDENTIFIANT, donnees?.username);
  }

  // --- 3. « Derniere connexion » -------------------------------------------
  //
  // L'audit l'a vue afficher « Première connexion » alors qu'il y en avait eu
  // plusieurs. C'est correct sur la demonstration — la base repart de zero a
  // chaque reveil, il n'y a donc jamais qu'une session. Sur une base qui dure,
  // la deuxieme connexion doit montrer la premiere.
  console.log('\n3. La derniere connexion');
  {
    const avant = await (await moi(premiere.cookie)).json();
    verifie('a la premiere session, il n\'y a rien a montrer',
      avant.lastLoginAt === null, avant.lastLoginAt);
    verifie('et aucun autre appareil n\'est signale',
      avant.otherSessions === 0, avant.otherSessions);

    // Une seconde connexion, comme depuis un autre appareil.
    await new Promise((r) => setTimeout(r, 1100));
    const seconde = await seConnecter();

    const apres = await (await moi(seconde.cookie)).json();
    verifie('>>> LA SECONDE SESSION VOIT LA PREMIERE <<<',
      typeof apres.lastLoginAt === 'string', apres.lastLoginAt);
    verifie('et compte l\'autre appareil encore ouvert',
      apres.otherSessions === 1, apres.otherSessions);

    // ⚠️ CE QUI NE DOIT PAS CASSER : le changement de mot de passe ferme les
    //    AUTRES sessions. C'est un comportement existant, et il repose sur le
    //    fait que les sessions sont en base — donc enumerables.
    const change = await fetch(`${BASE}/api/admin/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: seconde.cookie },
      body: JSON.stringify({
        currentPassword: MOT_DE_PASSE,
        newPassword: MOT_DE_PASSE + '-bis',
        confirmPassword: MOT_DE_PASSE + '-bis',
      }),
    });
    verifie('le mot de passe se change', change.status === 200, change.status);

    verifie('>>> TOUTES LES SESSIONS SONT FERMEES, Y COMPRIS CELLE-CI <<<',
      (await moi(premiere.cookie)).status === 401
      && (await moi(seconde.cookie)).status === 401, '');

    // ⚠️ MAIS CELUI QUI VIENT DE CHANGER SON MOT DE PASSE N'EST PAS MIS DEHORS :
    //    la reponse lui remet un cookie neuf. Sans lui, le commercant se
    //    retrouverait devant l'ecran de connexion juste apres avoir change son
    //    mot de passe — et se demanderait si le changement a bien eu lieu.
    const poses = (change.headers.getSetCookie?.() ?? [])
      .filter((c) => c.startsWith('sc_session='));

    verifie('un cookie neuf est remis dans la reponse', poses.length >= 1, poses);

    // ⚠️ UN SEUL, ET C'EST UN CORRECTIF. La reponse en portait DEUX : celui que
    //    `requireAdmin` repose en repoussant l'expiration, puis celui de la
    //    session neuve. Le premier designait une session que la route venait de
    //    detruire. Un navigateur applique le dernier et s'en sort ; tout ce qui
    //    lit `set-cookie` au singulier prend le premier, et deconnecte le
    //    commercant juste apres son changement de mot de passe.
    verifie('>>> ET IL N\'Y EN A QU\'UN <<<', poses.length === 1, poses);

    verifie('il ouvre l\'espace tout de suite',
      (await moi(poses[0].split(';')[0])).status === 200, '');
  }

  // --- 4. Le cookie en production ------------------------------------------
  //
  // `Secure` interdit au navigateur d'envoyer le cookie hors d'une liaison
  // chiffree. Il ne se pose qu'en production : en local, on travaille en http,
  // et le poser empecherait tout simplement de se connecter.
  console.log('\n4. Le cookie en production');
  {
    arreterServeur();
    await attendreArret();
    await demarrerServeur({ production: true });

    // Le mot de passe a change a la section precedente.
    const reponse = await fetch(`${BASE}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: IDENTIFIANT, password: MOT_DE_PASSE + '-bis' }),
    });
    const brut = (reponse.headers.getSetCookie?.() ?? []).find((c) => c.startsWith('sc_session='));

    verifie('la connexion aboutit', reponse.status === 200, reponse.status);
    verifie('>>> LE COOKIE EST MARQUE Secure <<<', /secure/i.test(brut ?? ''), brut);
    verifie('et il reste httpOnly et SameSite=Lax',
      /httponly/i.test(brut ?? '') && /samesite=lax/i.test(brut ?? ''), brut);
  }

  code = bilan();
} finally {
  arreterServeur();
  await prisma.$disconnect().catch(() => {});
  // La base de test s'efface : elle ne sert qu'a cette suite.
  await rm(BASE_TEST, { force: true }).catch(() => {});
  await rm(`${BASE_TEST}-journal`, { force: true }).catch(() => {});
}

process.exitCode = code;
