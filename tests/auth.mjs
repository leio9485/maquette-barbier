// ---------------------------------------------------------------------------
// TESTS DE L'AUTHENTIFICATION
//
// Le serveur doit tourner AVANT de lancer ces tests. Dans deux terminaux :
//     npm start           (terminal 1, laisse ouvert)
//     npm run test:auth   (terminal 2)
//
// Le compte utilise est un compte jetable, cree puis supprime : le vrai compte
// du commercant n'est jamais touche et son mot de passe n'a pas a etre connu.
// ---------------------------------------------------------------------------

import { prisma } from '../src/db.js';
import { hashPassword } from '../src/lib/passwords.js';
import {
  creerClient,
  creerCompteDeTest,
  supprimerCompteDeTest,
  creerVerificateur,
} from './helpers.mjs';

const { verifie, bilan } = creerVerificateur();

const IDENTIFIANTS = await creerCompteDeTest();

try {
  // --- 1. Sans connexion, tout est ferme -----------------------------------
  console.log('1. Sans connexion');
  {
    const visiteur = creerClient();
    const r = await visiteur.appel('GET', '/api/admin/me');
    verifie('savoir qui est connecte : refuse', r.status === 401, r.status);
    verifie('la reponse le dit explicitement', r.donnees?.authenticated === false, r.donnees);
  }

  // --- 2. Refus des mauvaises identifications ------------------------------
  console.log('\n2. Refus des mauvaises identifications');

  let messageInconnu = null;
  let messageMauvaisMdp = null;

  {
    const client = creerClient();
    const r = await client.appel('POST', '/api/admin/login', {});
    verifie('identifiants absents : refuse', r.status === 400, r.status);
  }
  {
    const client = creerClient();
    const r = await client.appel('POST', '/api/admin/login', {
      username: 'quelqu-un-qui-n-existe-pas', password: 'peu-importe-du-tout',
    });
    verifie('identifiant inconnu : refuse', r.status === 401, r.status);
    messageInconnu = r.donnees?.error;
  }
  {
    const client = creerClient();
    const r = await client.appel('POST', '/api/admin/login', {
      username: IDENTIFIANTS.username, password: 'ce-n-est-pas-le-bon',
    });
    verifie('mot de passe faux : refuse', r.status === 401, r.status);
    messageMauvaisMdp = r.donnees?.error;
  }
  verifie('le message ne trahit pas quel identifiant existe',
    messageInconnu === messageMauvaisMdp, { messageInconnu, messageMauvaisMdp });

  {
    const client = creerClient();
    client.cookies.set('sc_session', 'jeton-fabrique-de-toutes-pieces');
    const r = await client.appel('GET', '/api/admin/me');
    verifie('un jeton de session invente : refuse', r.status === 401, r.status);
  }

  // --- 3. Connexion reussie ------------------------------------------------
  console.log('\n3. Connexion reussie');
  const salon = creerClient();
  {
    const r = await salon.appel('POST', '/api/admin/login', IDENTIFIANTS);
    verifie('la connexion aboutit', r.status === 200 && r.donnees?.authenticated === true, r);
    verifie("l'identifiant est renvoye", r.donnees?.username === IDENTIFIANTS.username, r.donnees?.username);

    const cookie = (r.cookiesRecus ?? []).find((c) => c.startsWith('sc_session='));
    verifie('un cookie de session est depose', Boolean(cookie));
    verifie('le cookie est httpOnly (illisible par le JavaScript de la page)',
      /httponly/i.test(cookie ?? ''), cookie);
    verifie('le cookie est en SameSite=Lax (protege des requetes venues d\'un autre site)',
      /samesite=lax/i.test(cookie ?? ''), cookie);
    verifie('le jeton depose n\'est pas le mot de passe',
      !(cookie ?? '').includes(IDENTIFIANTS.password));
  }
  {
    const r = await salon.appel('GET', '/api/admin/me');
    verifie('la session est reconnue ensuite', r.status === 200 && r.donnees?.authenticated === true, r);
  }
  {
    const r = await salon.appel('GET', '/api/admin/settings');
    verifie("l'espace commercant devient accessible", r.status === 200, r.status);
  }

  // --- 4. Le mot de passe n'est jamais enregistre en clair ------------------
  console.log('\n4. Enregistrement du mot de passe');
  {
    const compte = await prisma.adminUser.findUnique({ where: { username: IDENTIFIANTS.username } });
    verifie("le mot de passe n'apparait pas dans la base",
      !compte.passwordHash.includes(IDENTIFIANTS.password));
    verifie("c'est bien une empreinte scrypt", compte.passwordHash.startsWith('scrypt$'),
      compte.passwordHash.slice(0, 20));

    const memeCompte = await prisma.adminUser.findUnique({ where: { username: IDENTIFIANTS.username } });
    verifie("l'empreinte est stable entre deux lectures",
      compte.passwordHash === memeCompte.passwordHash);
  }

  // --- 5. Deconnexion ------------------------------------------------------
  console.log('\n5. Deconnexion');
  {
    const jetonAvant = salon.cookies.get('sc_session');
    const r = await salon.appel('POST', '/api/admin/logout');
    verifie('la deconnexion aboutit', r.status === 200, r.status);

    // Le jeton est rejoue de force : il ne doit plus rien ouvrir, meme si
    // quelqu'un l'avait intercepte avant la deconnexion.
    const rejoue = creerClient();
    rejoue.cookies.set('sc_session', jetonAvant);
    const apres = await rejoue.appel('GET', '/api/admin/me');
    verifie('le jeton ne fonctionne plus, meme rejoue', apres.status === 401, apres.status);
  }

  // --- 6. Changement de mot de passe ---------------------------------------
  console.log('\n6. Changement de mot de passe');
  const NOUVEAU = 'nouveau-mot-de-passe-de-test-8823';

  const session1 = creerClient();
  const session2 = creerClient();
  {
    await session1.appel('POST', '/api/admin/login', IDENTIFIANTS);
    await session2.appel('POST', '/api/admin/login', IDENTIFIANTS);

    const r = await session2.appel('GET', '/api/admin/me');
    verifie('deux sessions peuvent coexister', r.status === 200, r.status);
  }
  {
    const r = await session1.appel('PUT', '/api/admin/password', {
      currentPassword: 'mauvais-mot-de-passe-actuel', newPassword: NOUVEAU,
    });
    verifie('changer sans connaitre le mot de passe actuel : refuse', r.status === 401, r.status);
  }
  {
    const r = await session1.appel('PUT', '/api/admin/password', {
      currentPassword: IDENTIFIANTS.password, newPassword: 'court',
    });
    verifie('un nouveau mot de passe trop court : refuse', r.status === 400, r.donnees);
  }
  {
    const r = await session1.appel('PUT', '/api/admin/password', {
      currentPassword: IDENTIFIANTS.password, newPassword: NOUVEAU,
    });
    verifie('le changement aboutit', r.status === 200, r.donnees);
  }
  {
    const r = await session2.appel('GET', '/api/admin/me');
    verifie('les autres sessions sont fermees', r.status === 401, r.status);

    const encore = await session1.appel('GET', '/api/admin/me');
    verifie('celle qui a fait le changement reste ouverte', encore.status === 200, encore.status);
  }
  {
    const client = creerClient();
    const ancien = await client.appel('POST', '/api/admin/login', IDENTIFIANTS);
    verifie("l'ancien mot de passe ne fonctionne plus", ancien.status === 401, ancien.status);

    const nouveau = await client.appel('POST', '/api/admin/login', {
      username: IDENTIFIANTS.username, password: NOUVEAU,
    });
    verifie('le nouveau fonctionne', nouveau.status === 200, nouveau.status);
  }

  // --- 6 bis. Ce que la section « Compte » a besoin de lire ----------------
  //
  // >>> LE LOT 4 : le commercant ne pouvait pas changer son mot de passe. <<<
  //
  // La route existait, ecrite et testee ci-dessus ; il n'y avait simplement
  // aucun ecran pour l'appeler. La section « Compte » des reglages a besoin de
  // trois choses de plus, et les voici.
  console.log('\n6 bis. La section « Compte »');
  {
    const r = await session1.appel('GET', '/api/admin/me');

    verifie('l\'identifiant de connexion est lisible',
      r.donnees?.username === IDENTIFIANTS.username, r.donnees);
    verifie('la date de derniere connexion est renseignee',
      typeof r.donnees?.lastLoginAt === 'string' || r.donnees?.lastLoginAt === null, r.donnees);
    verifie('le nombre d\'autres appareils connectes est un nombre',
      Number.isInteger(r.donnees?.otherSessions), r.donnees);

    // Il COMPTE VRAIMENT : on en ouvre un de plus, et le nombre suit. Une
    // constante renvoyee au hasard passerait la verification precedente.
    const troisieme = creerClient();
    await troisieme.appel('POST', '/api/admin/login',
      { username: IDENTIFIANTS.username, password: NOUVEAU });

    const apres = await session1.appel('GET', '/api/admin/me');
    verifie('un appareil de plus, un de plus au compteur',
      apres.donnees?.otherSessions === r.donnees.otherSessions + 1,
      { avant: r.donnees?.otherSessions, apres: apres.donnees?.otherSessions });

    await troisieme.appel('POST', '/api/admin/logout');
  }
  {
    const r = await session1.appel('PUT', '/api/admin/password', {
      currentPassword: NOUVEAU,
      newPassword: 'un-autre-mot-de-passe-encore-9911',
      confirmPassword: 'pas-du-tout-le-meme-9911',
    });
    verifie('une confirmation qui ne correspond pas : refuse', r.status === 400, r.donnees);
    verifie('et la phrase le dit', /identiques/i.test(r.donnees?.error ?? ''), r.donnees?.error);
  }
  {
    const r = await session1.appel('PUT', '/api/admin/password', {
      currentPassword: NOUVEAU, newPassword: NOUVEAU, confirmPassword: NOUVEAU,
    });
    verifie('reprendre le meme mot de passe : refuse', r.status === 400, r.donnees);
  }
  {
    const r = await session1.appel('POST', '/api/admin/logout');
    verifie('le mot de passe n\'a pas bouge apres ces refus', r.status === 200, r.status);

    const client = creerClient();
    const encore = await client.appel('POST', '/api/admin/login', {
      username: IDENTIFIANTS.username, password: NOUVEAU,
    });
    verifie('le mot de passe precedent ouvre toujours', encore.status === 200, encore.status);
  }

  // --- 6 ter. Le changement de mot de passe est plafonne -------------------
  //
  // ⚠️ MENE SUR UN COMPTE JETABLE DEDIE, comme la section 7 plus bas. Le
  //    compteur porte sur (adresse, identifiant) et tient un quart d'heure :
  //    l'user sur le compte de test bloquerait deux `npm test` d'affilee, et
  //    l'echec ressemblerait a un bogue.
  console.log('\n6 ter. Le changement de mot de passe est plafonne');
  {
    const jetable = 'cible-du-test-de-plafond-motdepasse';
    const motDePasse = 'mot-de-passe-jetable-du-test-4471';

    await prisma.adminUser.upsert({
      where: { username: jetable },
      create: { username: jetable, passwordHash: await hashPassword(motDePasse) },
      update: { passwordHash: await hashPassword(motDePasse) },
    });

    try {
      const client = creerClient();
      const ouverte = await client.appel('POST', '/api/admin/login',
        { username: jetable, password: motDePasse });
      verifie('le compte jetable s\'ouvre', ouverte.status === 200, ouverte.status);

      let bloqueA = null;
      for (let essai = 1; essai <= 15 && bloqueA === null; essai++) {
        const r = await client.appel('PUT', '/api/admin/password', {
          currentPassword: `ce-n-est-pas-le-bon-${essai}`,
          newPassword: 'peu-importe-ce-mot-de-passe-la',
        });
        if (r.status === 429) bloqueA = essai;
      }

      verifie('>>> LES TENTATIVES REPETEES FINISSENT PAR ETRE BLOQUEES <<<',
        bloqueA !== null, bloqueA);
      verifie('le blocage survient apres une dizaine d\'essais',
        bloqueA !== null && bloqueA <= 12, bloqueA);
      console.log(`     bloque a la tentative n°${bloqueA}`);

      // La session, elle, reste valide : c'est un plafond sur une action, pas
      // une deconnexion.
      const encore = await client.appel('GET', '/api/admin/me');
      verifie('la session reste ouverte malgre le plafond', encore.status === 200, encore.status);
    } finally {
      await prisma.adminUser.deleteMany({ where: { username: jetable } });
    }
  }

  // --- 7. Limitation des tentatives ----------------------------------------
  // Menee sur un identifiant bidon dedie, pour ne pas bloquer le compte de test.
  console.log('\n7. Limitation des tentatives');
  {
    const client = creerClient();
    const cible = 'cible-du-test-de-blocage';
    let bloqueAu = null;

    for (let essai = 1; essai <= 14 && bloqueAu === null; essai++) {
      const r = await client.appel('POST', '/api/admin/login', {
        username: cible, password: `essai-numero-${essai}`,
      });
      if (r.status === 429) bloqueAu = essai;
    }

    verifie('les tentatives repetees finissent par etre bloquees', bloqueAu !== null, bloqueAu);
    verifie('le blocage survient apres une dizaine d\'essais',
      bloqueAu !== null && bloqueAu <= 12, bloqueAu);
    console.log(`     bloque a la tentative n°${bloqueAu}`);
  }
  {
    // Le blocage vise l'identifiant acharne, pas tout le serveur.
    const client = creerClient();
    const r = await client.appel('POST', '/api/admin/login', {
      username: IDENTIFIANTS.username, password: NOUVEAU,
    });
    verifie('le compte legitime reste accessible malgre ce blocage', r.status === 200, r.status);
  }
} finally {
  await supprimerCompteDeTest();
}

process.exitCode = bilan() === 0 ? 0 : 1;
