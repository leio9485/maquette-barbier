// ---------------------------------------------------------------------------
// LE VERROU DE L'ESPACE COMMERCANT
//
// Toutes les routes /api/admin/... passent par ici. Sans session valable, la
// requete est refusee avant meme d'atteindre le code qui lit ou modifie les
// donnees : il n'y a donc pas une route a securiser, mais une seule porte.
//
// Ce fichier remplace le code "1234" qui etait verifie dans le navigateur, et
// donc lisible par quiconque affichait le code source de la page.
// ---------------------------------------------------------------------------

import {
  COOKIE_NAME,
  readCookie,
  findValidSession,
  touchSession,
  refreshSessionCookie,
} from '../lib/sessions.js';

export async function requireAdmin(req, res, next) {
  try {
    const jeton = readCookie(req, COOKIE_NAME);
    const session = await findValidSession(jeton);

    if (!session) {
      return res.status(401).json({
        error: 'Connexion requise.',
        authenticated: false,
      });
    }

    // La session est vivante : on repousse son expiration.
    const expiresAt = await touchSession(session);
    refreshSessionCookie(res, session.id, expiresAt);

    req.admin = { id: session.admin.id, username: session.admin.username };
    req.sessionToken = session.id;

    next();
  } catch (erreur) {
    next(erreur);
  }
}
