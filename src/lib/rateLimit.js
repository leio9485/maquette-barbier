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
// ---------------------------------------------------------------------------

const compteurs = new Map();

// Menage periodique : sans cela, la liste des adresses vues grossirait sans fin.
const MENAGE_MS = 10 * 60 * 1000;
let dernierMenage = Date.now();

function menage(maintenant) {
  if (maintenant - dernierMenage < MENAGE_MS) return;
  dernierMenage = maintenant;

  for (const [cle, entree] of compteurs) {
    if (entree.resetAt <= maintenant) compteurs.delete(cle);
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
