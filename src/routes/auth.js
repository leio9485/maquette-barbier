// ---------------------------------------------------------------------------
// CONNEXION A L'ESPACE COMMERCANT
//
//   POST /api/admin/login      ouvrir une session
//   POST /api/admin/logout     la fermer
//   GET  /api/admin/me         savoir si l'on est connecte
//   PUT  /api/admin/password   changer de mot de passe
//
// Remplace le code "1234" que le site verifiait lui-meme. La difference n'est
// pas la longueur du code : c'est que la verification a lieu sur le serveur.
// Auparavant, le code figurait en clair dans la page — il suffisait d'afficher
// le code source pour le lire, et rien n'empechait de contourner le test.
// ---------------------------------------------------------------------------

import express from 'express';
import { randomBytes } from 'node:crypto';

import { prisma } from '../db.js';
import { DEMO_MODE } from '../config.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import {
  hashPassword,
  verifyPassword,
  checkPasswordStrength,
} from '../lib/passwords.js';
import {
  COOKIE_NAME,
  readCookie,
  createSession,
  destroySession,
  destroyAllSessions,
  setSessionCookie,
  clearSessionCookie,
} from '../lib/sessions.js';
import { isRateLimited, recordFailure, resetFailures } from '../lib/rateLimit.js';

export const authRouter = express.Router();

// Deux compteurs se cumulent.
//   - par identifiant vise : bloque l'acharnement sur un compte precis ;
//   - par adresse, plus large : bloque celui qui essaie beaucoup d'identifiants
//     differents en esperant en trouver un qui existe.
const MAX_ECHECS_COMPTE = 10;
const MAX_ECHECS_ADRESSE = 50;
const FENETRE_MS = 15 * 60 * 1000;

/**
 * Empreinte d'un mot de passe qui n'existe pas.
 *
 * Quand l'identifiant saisi est inconnu, on verifie quand meme le mot de passe
 * contre celle-ci. Sans cette precaution, une reponse instantanee signalerait
 * "cet identifiant n'existe pas" et une reponse lente "il existe, mais le mot
 * de passe est faux" : on pourrait deviner l'identifiant a la montre.
 */
let empreinteFactice = null;
async function getEmpreinteFactice() {
  if (!empreinteFactice) {
    empreinteFactice = await hashPassword(randomBytes(32).toString('hex'));
  }
  return empreinteFactice;
}

/** POST /api/admin/login */
authRouter.post('/admin/login', async (req, res, next) => {
  try {
    const identifiant = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const motDePasse = typeof req.body?.password === 'string' ? req.body.password : '';

    const cleCompte = `login:${req.ip}:${identifiant.toLowerCase()}`;
    const cleAdresse = `login-adresse:${req.ip}`;

    const echec = (statut, message) => {
      recordFailure(cleCompte, { fenetreMs: FENETRE_MS });
      recordFailure(cleAdresse, { fenetreMs: FENETRE_MS });
      return res.status(statut).json({ error: message });
    };

    const limiteCompte = isRateLimited(cleCompte, { max: MAX_ECHECS_COMPTE });
    const limiteAdresse = isRateLimited(cleAdresse, { max: MAX_ECHECS_ADRESSE });
    const limite = limiteCompte.bloque ? limiteCompte : limiteAdresse;

    if (limite.bloque) {
      return res.status(429).json({
        error: `Trop de tentatives. Réessayez dans ${Math.ceil(limite.secondes / 60)} minutes.`,
      });
    }

    if (!identifiant || !motDePasse) {
      return echec(400, 'Identifiant et mot de passe sont obligatoires.');
    }

    const compte = await prisma.adminUser.findUnique({ where: { username: identifiant } });

    const correct = compte
      ? await verifyPassword(motDePasse, compte.passwordHash)
      : await verifyPassword(motDePasse, await getEmpreinteFactice());

    if (!compte || !correct) {
      // Message volontairement vague : ne pas indiquer lequel des deux est faux.
      return echec(401, 'Identifiant ou mot de passe incorrect.');
    }

    resetFailures(cleCompte);
    resetFailures(cleAdresse);

    const { jeton, expiresAt } = await createSession(compte.id);
    setSessionCookie(res, jeton, expiresAt);

    await prisma.adminUser.update({
      where: { id: compte.id },
      data: { lastLoginAt: new Date() },
    });

    res.json({ authenticated: true, username: compte.username });
  } catch (erreur) {
    next(erreur);
  }
});

/** POST /api/admin/logout */
authRouter.post('/admin/logout', async (req, res, next) => {
  try {
    await destroySession(readCookie(req, COOKIE_NAME));
    clearSessionCookie(res);
    res.json({ authenticated: false });
  } catch (erreur) {
    next(erreur);
  }
});

/**
 * GET /api/admin/me
 *
 * Permet au site de savoir, au chargement, s'il doit afficher l'ecran de
 * connexion ou directement l'agenda. Repond 401 si personne n'est connecte.
 */
authRouter.get('/admin/me', requireAdmin, async (req, res, next) => {
  try {
    // La DERNIERE CONNEXION en plus de l'identifiant : c'est la seule chose que
    // le commercant peut relire pour savoir si quelqu'un d'autre est entre. Sans
    // elle, la section « Compte » n'aurait rien a montrer entre deux changements
    // de mot de passe.
    //
    // ⚠️ C'est celle d'AVANT la connexion en cours, et c'est ce qui la rend
    //    utile : `POST /api/admin/login` ecrit `lastLoginAt` en se connectant.
    //    Renvoyer telle quelle, elle afficherait « votre derniere connexion :
    //    il y a deux secondes » a chaque ouverture, ce qui n'apprend rien.
    //    On renvoie donc la DEUXIEME session la plus recente.
    const [compte, sessions] = await Promise.all([
      prisma.adminUser.findUnique({ where: { id: req.admin.id } }),
      prisma.session.findMany({
        where: { adminUserId: req.admin.id },
        orderBy: { createdAt: 'desc' },
        select: { id: true, createdAt: true },
      }),
    ]);

    const precedente = sessions.find((s) => s.id !== req.sessionToken);

    res.json({
      authenticated: true,
      username: req.admin.username,
      createdAt: compte?.createdAt ?? null,
      lastLoginAt: precedente?.createdAt ?? null,
      // Combien d'autres appareils sont ouverts sur ce compte. « Se déconnecter
      // partout » n'a de sens que si l'on sait qu'il y a un « partout ».
      otherSessions: Math.max(sessions.length - 1, 0),
    });
  } catch (erreur) {
    next(erreur);
  }
});

/**
 * PUT /api/admin/password
 *
 * Le mot de passe actuel est redemande : si quelqu'un s'installait devant un
 * ordinateur reste connecte, il ne pourrait pas verrouiller le compte.
 * Toutes les autres sessions sont fermees au passage.
 */
authRouter.put('/admin/password', requireAdmin, async (req, res, next) => {
  try {
    // Sur la vitrine de demonstration, le formulaire reste visible — il fait
    // partie de ce qu'on montre — mais il n'agit pas : le premier visiteur qui
    // changerait le mot de passe fermerait la porte a tous les suivants.
    if (DEMO_MODE) {
      return res.status(403).json({
        error: 'Changement de mot de passe désactivé sur la démonstration. '
          + 'Sur votre site, ce formulaire fonctionne normalement.',
      });
    }

    const actuel = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
    const nouveau = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';
    const confirmation = typeof req.body?.confirmPassword === 'string' ? req.body.confirmPassword : null;

    // ⚠️ LE MEME COMPTEUR QUE LA CONNEXION, ET POUR LA MEME RAISON. Le mot de
    //    passe actuel est redemande ici : sans plafond, quelqu'un installe
    //    devant un ordinateur reste connecte pourrait l'essayer a la chaine
    //    depuis cette route, alors que la porte d'entree, elle, compte.
    const cleCompte = `motdepasse:${req.ip}:${req.admin.username.toLowerCase()}`;
    const cleAdresse = `motdepasse-adresse:${req.ip}`;

    const limiteCompte = isRateLimited(cleCompte, { max: MAX_ECHECS_COMPTE });
    const limiteAdresse = isRateLimited(cleAdresse, { max: MAX_ECHECS_ADRESSE });
    const limite = limiteCompte.bloque ? limiteCompte : limiteAdresse;

    if (limite.bloque) {
      return res.status(429).json({
        error: `Trop de tentatives. Réessayez dans ${Math.ceil(limite.secondes / 60)} minutes.`,
      });
    }

    const compte = await prisma.adminUser.findUnique({ where: { id: req.admin.id } });
    if (!compte) return res.status(401).json({ error: 'Compte introuvable.' });

    if (!(await verifyPassword(actuel, compte.passwordHash))) {
      recordFailure(cleCompte, { fenetreMs: FENETRE_MS });
      recordFailure(cleAdresse, { fenetreMs: FENETRE_MS });
      return res.status(401).json({ error: 'Le mot de passe actuel est incorrect.' });
    }

    resetFailures(cleCompte);
    resetFailures(cleAdresse);

    // La confirmation est verifiee ici AUSSI, et pas seulement dans le
    // formulaire : c'est la seule facon d'en faire une regle du produit plutot
    // qu'un confort de saisie, et donc de la tester.
    if (confirmation !== null && confirmation !== nouveau) {
      return res.status(400).json({
        error: 'Les deux nouveaux mots de passe ne sont pas identiques.',
      });
    }

    const faiblesse = checkPasswordStrength(nouveau);
    if (faiblesse) return res.status(400).json({ error: faiblesse });

    if (nouveau === actuel) {
      return res.status(400).json({ error: 'Le nouveau mot de passe est identique à l\'ancien.' });
    }

    await prisma.adminUser.update({
      where: { id: compte.id },
      data: { passwordHash: await hashPassword(nouveau) },
    });

    // Un changement de mot de passe doit couper les acces ouverts ailleurs :
    // c'est le geste a faire si l'on soupconne que quelqu'un s'est introduit.
    await destroyAllSessions(compte.id);

    const { jeton, expiresAt } = await createSession(compte.id);
    setSessionCookie(res, jeton, expiresAt);

    res.json({ ok: true, message: 'Mot de passe modifié. Les autres sessions ont été fermées.' });
  } catch (erreur) {
    next(erreur);
  }
});
// --- LES PERSONNES AUTORISEES ----------------------------------------------
//
// >>> UN SEUL MOT DE PASSE POUR TOUTE L'EQUIPE, C'ETAIT LE DEFAUT. <<<
//
// Le modele supportait plusieurs comptes depuis le premier jour (`username` est
// unique), mais la seule facon d'en creer un etait `npm run admin:create`, en
// ligne de commande, sur le serveur. Un salon de trois personnes se retrouvait
// donc avec un mot de passe partage ecrit pres de la caisse — et avec lui :
//
//   - aucune tracabilite : personne ne sait qui a supprime le rendez-vous ;
//   - couper l'acces de quelqu'un qui part oblige a changer LE mot de passe,
//     donc a deconnecter tout le monde et a redistribuer le nouveau ;
//   - un ancien employe garde l'acces a tout le fichier client.
//
// ⚠️ IL N'Y A PAS DE ROLES, ET C'EST UN CHOIX. Tous les comptes peuvent tout
//    faire, y compris changer les tarifs. Des roles demandent un ecran de
//    permissions que personne n'a demande ; la colonne `role` est en revanche
//    posee dans la base, vide, pour ne pas avoir a migrer une seconde fois chez
//    un client qui tourne (voir prisma/schema.prisma).

/** Un identifiant : ni vide, ni fantaisiste, et il se dicte au telephone. */
function validerIdentifiant(valeur) {
  const propre = typeof valeur === 'string' ? valeur.trim() : '';

  if (!propre) return { erreur: "L'identifiant est obligatoire." };
  if (propre.length < 3) return { erreur: "L'identifiant doit faire au moins 3 caractères." };
  if (propre.length > 40) return { erreur: "L'identifiant est trop long (40 caractères au maximum)." };

  // Lettres, chiffres, point, tiret, tiret bas. Pas d'espace ni d'accent : cet
  // identifiant se tape sur un clavier qu'on ne choisit pas, et se dicte au
  // telephone comme la reference d'un rendez-vous.
  if (!/^[A-Za-z0-9._-]+$/.test(propre)) {
    return { erreur: "L'identifiant ne prend que des lettres, des chiffres, un point, un tiret ou un tiret bas." };
  }

  return { valeur: propre };
}

/** Ce qu'un compte montre de lui. JAMAIS l'empreinte du mot de passe. */
function versApi(compte, { sessions = 0, moi = false } = {}) {
  return {
    id: compte.id,
    username: compte.username,
    createdAt: compte.createdAt,
    lastLoginAt: compte.lastLoginAt,
    // Combien d'appareils sont ouverts sur ce compte en ce moment. C'est le
    // seul signe qu'un compte SERT encore, et donc la seule facon de reperer
    // celui qu'on peut revoquer sans deranger personne.
    openSessions: sessions,
    // Le compte de la session en cours. L'ecran s'en sert pour retirer le
    // bouton « Révoquer » de sa propre ligne — le serveur le refuse de toute
    // facon, mais un bouton qui refuse toujours n'a rien a faire la.
    isSelf: moi,
  };
}

/**
 * Le plafond de la connexion, applique aussi ici.
 *
 * ⚠️ CES ROUTES CREENT ET DETRUISENT DES ACCES : elles valent la porte
 *    d'entree, et se protegent comme elle. Sans plafond, quelqu'un installe
 *    devant un poste reste connecte pourrait fabriquer des comptes a la chaine
 *    pendant que la page de connexion, elle, compte ses echecs.
 */
const cleDesComptes = (req) => `comptes-adresse:${req.ip}`;

function plafondDesComptes(req, res) {
  const limite = isRateLimited(cleDesComptes(req), { max: MAX_ECHECS_ADRESSE });

  if (limite.bloque) {
    res.status(429).json({
      error: `Trop de tentatives. Réessayez dans ${Math.ceil(limite.secondes / 60)} minutes.`,
    });
    return true;
  }

  return false;
}

/**
 * >>> ON COMPTE LES ECHECS, PAS LES PASSAGES. <<<
 *
 * ⚠️ CETTE FONCTION COMPTAIT TOUT, ET C'ETAIT UN DEFAUT. Le plafond etait
 *    consomme par les creations qui REUSSISSENT autant que par celles qui
 *    ratent : un commercant qui enregistre son equipe se serait vu refuser
 *    l'acces a sa propre section, sans avoir rien fait de mal.
 *
 *    Le defaut ne s'est pas vu a la premiere execution de la suite mais a la
 *    SECONDE, lancee dans le quart d'heure : les vingt operations de la
 *    premiere restaient au compteur. C'est exactement le piege deja connu du
 *    depot pour les references d'annulation (voir CLAUDE.md).
 *
 * `POST /api/admin/login` fait ce qu'il faut depuis toujours : `recordFailure`
 * dans la seule branche de refus, `resetFailures` au succes. Ces deux
 * fonctions-ci portent la meme regle aux routes de gestion des acces, qui
 * devaient s'aligner sur elle — c'est ce que l'audit demandait.
 */
function noterEchecCompte(req) {
  recordFailure(cleDesComptes(req), { fenetreMs: FENETRE_MS });
}

function oublierEchecsCompte(req) {
  resetFailures(cleDesComptes(req));
}

/** Un refus, compte comme tel. Rend la reponse, pour s'ecrire en une ligne. */
function refusCompte(req, res, statut, message) {
  noterEchecCompte(req);
  return res.status(statut).json({ error: message });
}

/**
 * Ce que la demonstration ne laisse pas faire.
 *
 * Meme raison que pour le changement de mot de passe : la section reste
 * visible — elle fait partie de ce qu'on montre — mais elle n'agit pas. Le
 * premier visiteur qui revoquerait le compte de demonstration fermerait la
 * porte a tous les suivants, et jusqu'a la remise a zero de 4 h.
 */
function refusDemo(res) {
  if (!DEMO_MODE) return false;

  res.status(403).json({
    error: 'Gestion des comptes désactivée sur la démonstration. '
      + 'Sur votre site, cette section fonctionne normalement.',
  });
  return true;
}

/**
 * GET /api/admin/users
 *
 * Qui a le droit d'entrer. Aucune empreinte de mot de passe n'en sort.
 */
authRouter.get('/admin/users', requireAdmin, async (req, res, next) => {
  try {
    const [comptes, sessions] = await Promise.all([
      prisma.adminUser.findMany({ orderBy: { createdAt: 'asc' } }),
      prisma.session.groupBy({
        by: ['adminUserId'],
        where: { expiresAt: { gt: new Date() } },
        _count: { _all: true },
      }),
    ]);

    const ouvertes = new Map(sessions.map((s) => [s.adminUserId, s._count._all]));

    res.json({
      users: comptes.map((c) => versApi(c, {
        sessions: ouvertes.get(c.id) ?? 0,
        moi: c.id === req.admin.id,
      })),
    });
  } catch (erreur) {
    next(erreur);
  }
});

/**
 * POST /api/admin/users  { username, password }
 *
 * Cree un acces. Le mot de passe initial est choisi par celui qui cree le
 * compte et communique de vive voix : il n'y a pas de courriel a envoyer, et
 * l'interesse le changera depuis « Mon compte ».
 */
authRouter.post('/admin/users', requireAdmin, async (req, res, next) => {
  try {
    if (refusDemo(res)) return;
    if (plafondDesComptes(req, res)) return;

    const verdict = validerIdentifiant(req.body?.username);
    if (verdict.erreur) return refusCompte(req, res, 400, verdict.erreur);

    const motDePasse = typeof req.body?.password === 'string' ? req.body.password : '';
    const faiblesse = checkPasswordStrength(motDePasse);
    if (faiblesse) return refusCompte(req, res, 400, faiblesse);

    // ⚠️ LE DOUBLON SE VERIFIE ICI *ET* SE RATTRAPE PLUS BAS. La contrainte
    //    d'unicite de la base est la seule qui ne mente jamais — entre cette
    //    lecture et l'ecriture, quelqu'un d'autre a pu prendre le nom. On lit
    //    d'abord pour donner un message juste, et on attrape P2002 pour le cas
    //    ou la course aurait ete perdue.
    const existe = await prisma.adminUser.findUnique({ where: { username: verdict.valeur } });
    if (existe) return refusCompte(req, res, 409, 'Cet identifiant est déjà pris.');

    let cree;
    try {
      cree = await prisma.adminUser.create({
        data: { username: verdict.valeur, passwordHash: await hashPassword(motDePasse) },
      });
    } catch (erreur) {
      if (erreur?.code === 'P2002') {
        return refusCompte(req, res, 409, 'Cet identifiant est déjà pris.');
      }
      throw erreur;
    }

    oublierEchecsCompte(req);
    res.status(201).json(versApi(cree));
  } catch (erreur) {
    next(erreur);
  }
});

/**
 * DELETE /api/admin/users/:id
 *
 * Coupe un acces, et FERME LES SESSIONS DE CE COMPTE — celles-la seules.
 *
 * C'est le geste qu'on fait le jour ou quelqu'un s'en va, et il doit prendre
 * effet tout de suite : un compte revoque dont la session reste ouverte sur le
 * telephone de l'interesse n'est pas revoque du tout. La suppression de la
 * ligne suffirait (les sessions tombent en cascade), mais l'appel est ecrit en
 * toutes lettres : c'est l'effet recherche, pas un effet de bord du schema.
 *
 * DEUX GARDE-FOUS, ET ILS NE SE RECOUVRENT PAS :
 *
 *   - PAS LE DERNIER COMPTE. Il ne resterait plus aucune facon d'entrer, et
 *     l'espace ne se rouvrirait qu'en ligne de commande sur le serveur — que le
 *     commercant n'a pas.
 *   - PAS LE SIEN. Se revoquer soi-meme est toujours un accident : on se
 *     deconnecte au milieu de son travail, et il faut quelqu'un d'autre pour
 *     rouvrir. « Se déconnecter » existe pour partir ; ce bouton-ci sert a
 *     faire partir quelqu'un d'autre.
 */
authRouter.delete('/admin/users/:id', requireAdmin, async (req, res, next) => {
  try {
    if (refusDemo(res)) return;
    if (plafondDesComptes(req, res)) return;

    const compte = await prisma.adminUser.findUnique({ where: { id: req.params.id } });
    if (!compte) return refusCompte(req, res, 404, 'Compte introuvable.');

    if (compte.id === req.admin.id) {
      return refusCompte(req, res, 409,
        'Vous ne pouvez pas révoquer votre propre accès. '
        + 'Demandez à quelqu\'un d\'autre, ou déconnectez-vous.');
    }

    const total = await prisma.adminUser.count();
    if (total <= 1) {
      return refusCompte(req, res, 409,
        'C\'est le dernier accès : le révoquer fermerait l\'espace pour tout le monde.');
    }

    await destroyAllSessions(compte.id);
    await prisma.adminUser.delete({ where: { id: compte.id } });

    oublierEchecsCompte(req);
    res.json({ ok: true, id: compte.id, username: compte.username });
  } catch (erreur) {
    next(erreur);
  }
});
