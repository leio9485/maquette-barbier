// ---------------------------------------------------------------------------
// LES ECHANGES AVEC LE SERVEUR
//
// Un seul chemin pour toutes les requetes : c'est ici qu'on decide ce qu'est une
// erreur, comment on la nomme, et ce que recoit l'appelant.
//
// LE PRINCIPE : `api()` LEVE, ET CE QU'ELLE LEVE EST LISIBLE.
//
// Le serveur repond ses refus en francais, dans un champ `error` (« Ce créneau
// vient d'être pris. »). On les remonte tels quels : ce sont eux qui
// s'afficheront, et ils sont ecrits pour etre lus par un client, pas par un
// developpeur. Ce qui n'a pas de message — panne reseau, reponse illisible —
// recoit une phrase de repli, une seule, ecrite ici.
//
// Aucun `console.error` en dehors de ce fichier : une erreur qui compte se
// montre a l'ecran, une erreur qui ne compte pas ne se montre pas du tout.
// ---------------------------------------------------------------------------

/** Ce qu'on dit quand le serveur n'a rien dit d'utilisable. */
const PANNE = "La connexion a échoué. Réessayez dans un instant.";

/**
 * Un appel a l'API.
 *
 * `credentials: 'same-origin'` : le cookie de session part avec les requetes de
 * l'espace commercant. C'est le defaut des navigateurs recents, ecrit ici parce
 * qu'une valeur de securite qui depend d'un defaut est une valeur qu'on relira.
 */
async function api(chemin, options = {}) {
  let reponse;

  try {
    reponse = await fetch(chemin, {
      credentials: 'same-origin',
      headers: options.corps ? { 'Content-Type': 'application/json' } : undefined,
      method: options.methode || 'GET',
      body: options.corps ? JSON.stringify(options.corps) : undefined,
    });
  } catch {
    // Reseau coupe, serveur injoignable : il n'y a pas de reponse a lire.
    throw new Error(PANNE);
  }

  // 204 : la requete a reussi et il n'y a rien a lire (une suppression).
  if (reponse.status === 204) return null;

  let donnees = null;
  try {
    donnees = await reponse.json();
  } catch {
    // Reponse vide ou illisible. Si le code HTTP dit que tout va bien, on
    // n'invente pas d'erreur pour autant.
    if (reponse.ok) return null;
    throw new Error(PANNE);
  }

  if (!reponse.ok) {
    const erreur = new Error(donnees?.error || PANNE);
    // Le code HTTP sert a distinguer les refus qui demandent une reaction
    // particuliere : 409 sur un creneau pris, 401 sur une session expiree.
    erreur.code = reponse.status;
    // Le CORPS du refus, quand il en dit plus que sa phrase. Un blocage de
    // periode refuse joint la liste des rendez-vous qu'il aurait recouverts,
    // et c'est cette liste que le commercant doit lire avant de decider.
    erreur.donnees = donnees;
    throw erreur;
  }

  return donnees;
}

// --- Ce que le site public demande ------------------------------------------

/** Les reglages du commerce : coordonnees, horaires, prestations, equipe, avis. */
function lireConfig() {
  return api('/api/config');
}

/** L'etat du moment, deja mis en phrases par le serveur (voir src/lib/etat.js). */
function lireEtat() {
  return api('/api/status');
}

/** Les creneaux d'une journee pour une prestation. */
function lireCreneaux(date, serviceId, staffId) {
  const p = new URLSearchParams({ date, serviceId });
  if (staffId) p.set('staffId', staffId);
  return api(`/api/slots?${p}`);
}

/** L'etat de chaque journee d'une periode : ouvert, complet, ou fermé. */
function lireJours(du, au, serviceId, staffId) {
  const p = new URLSearchParams({ from: du, to: au, serviceId });
  if (staffId) p.set('staffId', staffId);
  return api(`/api/days?${p}`);
}

/** Prend un rendez-vous. Le serveur revalide tout : rien de ce qui part d'ici n'est cru. */
function poserReservation(corps) {
  return api('/api/bookings', { methode: 'POST', corps });
}

/** Annule un rendez-vous, avec le jeton remis a la confirmation. */
function annulerReservation(id, jeton) {
  return api(`/api/bookings/${encodeURIComponent(id)}?token=${encodeURIComponent(jeton)}`, {
    methode: 'DELETE',
  });
}

/** Retrouve un rendez-vous depuis sa reference. Sert au rappel et au deplacement. */
function retrouverRendezVous(preuve) {
  return api('/api/rendez-vous/retrouver', { methode: 'POST', corps: preuve });
}

/**
 * Deplace un rendez-vous existant.
 *
 * ⚠️ CE N'EST PAS « ANNULER PUIS RESERVER ». Le serveur fait les deux d'un seul
 *    bloc : le client ne peut donc jamais se retrouver sans rien parce que la
 *    seconde moitie a echoue. Voir src/routes/rendezvous.js.
 */
function deplacerRendezVous(corps) {
  return api('/api/rendez-vous/deplacer', { methode: 'POST', corps });
}

/**
 * Annule un rendez-vous a partir de sa REFERENCE, et de la preuve qui va avec
 * (le jeton, ou les quatre derniers chiffres du telephone).
 *
 * A cote de `annulerReservation()`, qui part de l'identifiant interne : celui-la
 * n'est connu que de la reponse a une reservation. Apres un deplacement, le
 * client n'a que sa reference — c'est par ici que passe alors le bouton
 * « Annuler ce rendez-vous ».
 */
function annulerParReference(preuve) {
  const corps = { reference: preuve.reference };
  if (preuve.jeton) corps.jeton = preuve.jeton;
  else corps.telephone = preuve.telephone;

  return api('/api/rendez-vous/annuler', { methode: 'POST', corps });
}
