// ---------------------------------------------------------------------------
// SESSIONS
//
// Le commercant ne saisit son mot de passe qu'une fois. Le serveur lui remet
// alors un jeton tire au hasard, que le navigateur renvoie a chaque requete
// suivante dans un cookie. Le mot de passe, lui, ne circule plus.
//
// Les jetons sont enregistres en base, et non seulement dans le navigateur.
// Deux consequences utiles : se deconnecter annule vraiment la session (et pas
// seulement du cote du visiteur), et on peut couper un acces a distance en
// supprimant la ligne correspondante.
//
// Le cookie porte trois protections :
//   httpOnly  le JavaScript de la page ne peut pas le lire — un script
//             malveillant injecte dans le site ne peut donc pas le voler ;
//   sameSite  le navigateur ne l'envoie pas lorsqu'une requete part d'un autre
//             site, ce qui empeche un site tiers d'agir a la place du
//             commercant sans qu'il s'en apercoive ;
//   secure    (en production) il ne circule que sur une liaison chiffree.
// ---------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import { prisma } from '../db.js';
import { IS_PRODUCTION } from '../config.js';

export const COOKIE_NAME = 'sc_session';

/** Duree de vie d'une session sans reconnexion. */
const DUREE_JOURS = 7;
const DUREE_MS = DUREE_JOURS * 24 * 60 * 60 * 1000;

/** En deca de ce delai, on ne reecrit pas la session a chaque requete. */
const RAFRAICHIR_APRES_MS = 60 * 60 * 1000;

/** Ouvre une session pour un compte donne. */
export async function createSession(adminUserId) {
  // 32 octets tires au hasard : deviner un jeton valide est hors de portee.
  const jeton = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + DUREE_MS);

  await prisma.session.create({ data: { id: jeton, adminUserId, expiresAt } });
  return { jeton, expiresAt };
}

/**
 * Retrouve la session correspondant a un jeton, si elle est toujours valable.
 * Renvoie null dans tous les autres cas (jeton inconnu, session expiree).
 */
export async function findValidSession(jeton) {
  if (typeof jeton !== 'string' || !jeton) return null;

  const session = await prisma.session.findUnique({
    where: { id: jeton },
    include: { admin: true },
  });
  if (!session) return null;

  if (session.expiresAt.getTime() <= Date.now()) {
    // Session perimee : on en profite pour faire le menage.
    await prisma.session.delete({ where: { id: jeton } }).catch(() => {});
    return null;
  }

  return session;
}

/**
 * Repousse l'expiration d'une session encore active, pour qu'un commercant qui
 * se sert du site tous les jours ne soit pas deconnecte chaque semaine.
 * L'ecriture n'a lieu qu'une fois par heure au plus.
 */
export async function touchSession(session) {
  if (Date.now() - session.lastSeenAt.getTime() < RAFRAICHIR_APRES_MS) return session.expiresAt;

  const expiresAt = new Date(Date.now() + DUREE_MS);
  await prisma.session
    .update({ where: { id: session.id }, data: { lastSeenAt: new Date(), expiresAt } })
    .catch(() => {});
  return expiresAt;
}

/** Ferme une session precise. */
export async function destroySession(jeton) {
  if (!jeton) return;
  await prisma.session.delete({ where: { id: jeton } }).catch(() => {});
}

/** Ferme toutes les sessions d'un compte (utile apres un changement de mot de passe). */
export async function destroyAllSessions(adminUserId) {
  await prisma.session.deleteMany({ where: { adminUserId } });
}

/** Supprime les sessions perimees. Appele au demarrage du serveur. */
export async function purgeExpiredSessions() {
  const { count } = await prisma.session.deleteMany({
    where: { expiresAt: { lte: new Date() } },
  });
  return count;
}

// --- Cookies ---------------------------------------------------------------

/**
 * Lit un cookie dans l'en-tete de la requete.
 *
 * Express sait poser des cookies mais pas les relire ; plutot que d'ajouter une
 * brique pour trois lignes, on decoupe l'en-tete nous-memes.
 */
export function readCookie(req, nom) {
  const entete = req.headers?.cookie;
  if (!entete) return null;

  for (const morceau of entete.split(';')) {
    const separateur = morceau.indexOf('=');
    if (separateur === -1) continue;

    if (morceau.slice(0, separateur).trim() === nom) {
      return decodeURIComponent(morceau.slice(separateur + 1).trim());
    }
  }
  return null;
}

function optionsCookie(expiresAt) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: IS_PRODUCTION,
    path: '/',
    expires: expiresAt,
  };
}

export function setSessionCookie(res, jeton, expiresAt) {
  res.cookie(COOKIE_NAME, jeton, optionsCookie(expiresAt));
}

export function refreshSessionCookie(res, jeton, expiresAt) {
  res.cookie(COOKIE_NAME, jeton, optionsCookie(expiresAt));
}

export function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, sameSite: 'lax', secure: IS_PRODUCTION, path: '/' });
}
