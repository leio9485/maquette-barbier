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
authRouter.get('/admin/me', requireAdmin, (req, res) => {
  res.json({ authenticated: true, username: req.admin.username });
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

    const compte = await prisma.adminUser.findUnique({ where: { id: req.admin.id } });
    if (!compte) return res.status(401).json({ error: 'Compte introuvable.' });

    if (!(await verifyPassword(actuel, compte.passwordHash))) {
      return res.status(401).json({ error: 'Le mot de passe actuel est incorrect.' });
    }

    const faiblesse = checkPasswordStrength(nouveau);
    if (faiblesse) return res.status(400).json({ error: faiblesse });

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
