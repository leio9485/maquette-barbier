// ---------------------------------------------------------------------------
// LE PLAFOND DES ECRITURES DE L'ESPACE COMMERCANT
//
// >>> AUCUN 429 NE SE DECLENCHAIT SUR /api/admin/…, quelle que soit la
//     cadence. <<< Mesure sur l'instance en ligne. Une session volee, un
//     script laisse en boucle ou un ecran qui se met a repeter son
//     enregistrement pouvaient donc ecrire sans fin : chaque appel ouvre la
//     base, et plusieurs en reecrivent la totalite des reglages.
//
// TROIS DECISIONS, ET AUCUNE N'EST NEUTRE.
//
//   1. SEULES LES ECRITURES SONT COMPTEES (POST, PUT, PATCH, DELETE).
//      L'agenda, les creneaux et les chiffres se relisent a chaque clic — un
//      commercant qui parcourt sa semaine en fait des dizaines par minute, et
//      les brider casserait l'ecran qu'on vend.
//
//   2. LE PLAFOND EST LARGE (cent vingt par minute, soit deux par seconde en
//      continu). CLAUDE.md porte la trace de la faute inverse : un plafond qui
//      comptait les passages sur la creation de comptes se refermait sur le
//      commercant en train d'enregistrer sa propre equipe. Un plafond qui gene
//      son proprietaire ne protege de rien et empeche de travailler.
//
//   3. LA MEME EXEMPTION QUE LES RESERVATIONS (`limiteApplicable`) : la
//      machine elle-meme, et seulement hors production. La suite de tests
//      ecrit des centaines de fois en quelques secondes depuis l'adresse
//      locale ; en production, l'exemption n'existe pour personne, et le site
//      tourne derriere un relais avec `trust proxy`, si bien que `req.ip`
//      porte l'adresse reelle du visiteur.
//
// ⚠️ CE PLAFOND NE REMPLACE PAS `requireAdmin`. Il compte, il ne verifie
//    rien : ce qui protege l'agenda, c'est la session. Celui-ci ne fait que
//    borner ce qu'une session valide peut faire en une minute.
// ---------------------------------------------------------------------------

import { ADMIN_ECRITURES_MAX, ADMIN_ECRITURES_MS } from '../config.js';
import { limiteApplicable, passageDisponible, noterPassage } from '../lib/rateLimit.js';

const ECRITURES = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function plafondEcrituresAdmin(req, res, next) {
  if (!ECRITURES.has(req.method)) return next();
  if (!limiteApplicable(req.ip)) return next();

  const cle = `admin:ecritures:${req.ip}`;

  // On CONSULTE avant d'agir, puis on note : une requete refusee ici ne doit
  // rien ecrire du tout, et une requete qui passe doit compter meme si la
  // route repond ensuite 400. C'est la cadence qu'on borne, pas le succes.
  const verdict = passageDisponible(cle, { max: ADMIN_ECRITURES_MAX });

  if (verdict.bloque) {
    const secondes = Math.max(1, Math.ceil(verdict.secondes ?? 60));
    res.setHeader('Retry-After', String(secondes));
    return res.status(429).json({
      error: 'Trop de modifications en peu de temps. Réessayez dans une minute.',
    });
  }

  noterPassage(cle, { fenetreMs: ADMIN_ECRITURES_MS });
  next();
}
