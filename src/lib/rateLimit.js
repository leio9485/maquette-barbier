// ---------------------------------------------------------------------------
// LIMITATION DES TENTATIVES
//
// Sans garde-fou, rien n'empeche un programme d'essayer des milliers de mots de
// passe a la suite jusqu'a tomber juste. On compte donc les echecs et on ferme
// la porte quelques minutes au-dela d'un certain nombre.
//
// Le compteur vit en memoire : il repart de zero au redemarrage du serveur, et
// chaque instance client a le sien. C'est suffisant ici — un seul serveur, un
// seul compte a proteger. Un site a fort trafic utiliserait un compteur partage.
//
// DEUX MECANIQUES, ET ELLES NE SE CONFONDENT PAS.
//
//   LES ECHECS (`recordFailure`) — pour un mot de passe. Chaque echec REPOUSSE
//   la fin du blocage : quelqu'un qui s'acharne reste dehors tant qu'il
//   s'acharne. C'est ce qu'on veut d'une porte d'entree.
//
//   LES PASSAGES (`noterPassage`) — pour une reservation. La fenetre est FIXE :
//   elle expire a heure dite, quoi qu'il arrive entre-temps. La difference
//   compte, et elle n'est pas theorique : une reservation qui aboutit n'est pas
//   une faute. Derriere le reseau mobile d'un operateur, des dizaines de
//   clients partagent une adresse ; avec une fenetre qui se repousse, le
//   premier script venu les enfermerait tous dehors indefiniment.
// ---------------------------------------------------------------------------

import { IS_PRODUCTION } from '../config.js';

const compteurs = new Map();

/** Les passages, comptes a part : leur fenetre ne se repousse pas. */
const passages = new Map();

/**
 * Les adresses de la machine elle-meme.
 *
 * Express renvoie `::1` en IPv6, `127.0.0.1` en IPv4, et
 * `::ffff:127.0.0.1` quand une adresse IPv4 arrive sur une prise IPv6.
 */
const LOCALES = new Set(['::1', '127.0.0.1', '::ffff:127.0.0.1']);

/**
 * Faut-il faire respecter les plafonds a cette adresse ?
 *
 * >>> NON, POUR LA MACHINE ELLE-MEME, ET SEULEMENT HORS PRODUCTION. <<<
 *
 * La raison est mesuree, pas supposee : `npm test` envoie quarante-trois
 * demandes de reservation en quinze secondes depuis la meme adresse. C'est
 * exactement le profil qu'un plafond existe pour arreter. Aucune valeur ne
 * laisse passer la suite tout en protegeant quoi que ce soit — il faudrait un
 * plafond superieur a quarante-trois par quart d'heure, c'est-a-dire aucun
 * plafond.
 *
 * ⚠️ CETTE EXEMPTION NE PEUT PAS AFFAIBLIR LA PRODUCTION, et c'est la seule
 *    chose a verifier ici. En production `IS_PRODUCTION` est vrai : la
 *    condition est fausse quoi qu'il arrive, meme pour une requete venue de la
 *    machine. Et le site y tourne derriere le relais de l'hebergeur avec
 *    `trust proxy` : `req.ip` porte l'adresse reelle du visiteur, jamais une
 *    adresse locale.
 *
 * Un test verifie les quatre combinaisons — c'est la decision la plus sensible
 * de ce fichier, et la seule qu'on puisse se tromper en la lisant vite.
 */
export function limiteApplicable(ip, { production = IS_PRODUCTION } = {}) {
  if (production) return true;
  return !LOCALES.has(String(ip ?? ''));
}

// Menage periodique : sans cela, la liste des adresses vues grossirait sans fin.
const MENAGE_MS = 10 * 60 * 1000;
let dernierMenage = Date.now();

function menage(maintenant) {
  if (maintenant - dernierMenage < MENAGE_MS) return;
  dernierMenage = maintenant;

  for (const table of [compteurs, passages]) {
    for (const [cle, entree] of table) {
      if (entree.resetAt <= maintenant) table.delete(cle);
    }
  }
}

/**
 * Indique si la cle est actuellement bloquee, sans rien enregistrer.
 * A appeler avant de verifier un mot de passe.
 */
export function isRateLimited(cle, { max }) {
  const maintenant = Date.now();
  menage(maintenant);

  const entree = compteurs.get(cle);
  if (!entree || entree.resetAt <= maintenant) return { bloque: false };

  if (entree.count >= max) {
    return { bloque: true, secondes: Math.ceil((entree.resetAt - maintenant) / 1000) };
  }
  return { bloque: false };
}

/** Enregistre un echec. Chaque echec repousse la fin de la periode de blocage. */
export function recordFailure(cle, { fenetreMs }) {
  const maintenant = Date.now();
  const entree = compteurs.get(cle);

  if (!entree || entree.resetAt <= maintenant) {
    compteurs.set(cle, { count: 1, resetAt: maintenant + fenetreMs });
    return;
  }

  entree.count += 1;
  entree.resetAt = maintenant + fenetreMs;
}

/** Efface le compteur : appele apres une connexion reussie. */
export function resetFailures(cle) {
  compteurs.delete(cle);
}

// --- Les passages : compter ce qui REUSSIT ---------------------------------

/**
 * Reste-t-il de la place sous le plafond ? Ne compte rien.
 *
 * >>> A APPELER AVANT D'AGIR, ET NON APRES. <<< Pour une reservation, la
 * difference est visible du client : compter d'abord et refuser ensuite
 * reviendrait a ecrire le rendez-vous en base puis a repondre « non ».
 *
 * Renvoie `{ bloque, secondes, restant }`. `secondes` est le temps qu'il reste
 * a attendre — on le dit au client plutot que de le laisser reessayer a
 * l'aveugle.
 */
export function passageDisponible(cle, { max }) {
  const maintenant = Date.now();
  menage(maintenant);

  const entree = passages.get(cle);
  if (!entree || entree.resetAt <= maintenant) return { bloque: false, restant: max };

  if (entree.count >= max) {
    return { bloque: true, secondes: Math.ceil((entree.resetAt - maintenant) / 1000), restant: 0 };
  }
  return { bloque: false, restant: max - entree.count };
}

/**
 * Enregistre un passage. A appeler APRES coup, quand l'action a reellement eu
 * lieu.
 *
 * ⚠️ LA FENETRE NE SE REPOUSSE PAS, contrairement a `recordFailure`. Elle est
 *    posee au premier passage et expire a heure dite. Voir l'en-tete du
 *    fichier : derriere le reseau mobile d'un operateur, des dizaines de
 *    clients partagent une adresse, et une fenetre qui se repousse les
 *    enfermerait tous dehors indefiniment.
 */
export function noterPassage(cle, { fenetreMs }) {
  const maintenant = Date.now();
  const entree = passages.get(cle);

  if (!entree || entree.resetAt <= maintenant) {
    passages.set(cle, { count: 1, resetAt: maintenant + fenetreMs });
    return;
  }

  entree.count += 1;
}

/** Efface un compteur de passages. Employe par les tests. */
export function oublierPassages(cle) {
  passages.delete(cle);
}
