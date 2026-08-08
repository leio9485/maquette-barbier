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

// --- Ce que l'espace commercant demande -------------------------------------

function seConnecter(identifiant, motDePasse) {
  return api('/api/admin/login', {
    methode: 'POST',
    corps: { username: identifiant, password: motDePasse },
  });
}

function seDeconnecterServeur() {
  return api('/api/admin/logout', { methode: 'POST' });
}

/** Qui est connecte. Sert au demarrage : une session encore valide rouvre l'espace. */
function lireCompte() {
  return api('/api/admin/me');
}

/** Les reglages complets, prestations en pause comprises. */
function lireReglages() {
  return api('/api/admin/settings');
}

function enregistrerReglages(config) {
  return api('/api/admin/settings', { methode: 'PUT', corps: config });
}

function reinitialiser() {
  return api('/api/admin/settings/reset', { methode: 'POST' });
}

/**
 * Remet TOUTE la demonstration dans son etat de depart : reglages, rendez-vous
 * d'exemple, photos. `reinitialiser()` ci-dessus ne touche que les reglages.
 *
 * N'existe que sur la demonstration — chez un client, le serveur repond 404.
 */
function reinitialiserDemo() {
  return api('/api/admin/demo/reset', { methode: 'POST' });
}

/** Les rendez-vous d'une periode, coordonnees comprises. Session exigee. */
function lireRendezVous(du, au) {
  const p = new URLSearchParams({ from: du, to: au });
  return api(`/api/admin/bookings?${p}`);
}

/** Les creneaux vus par le commercant : sans delai minimum, pauses comprises. */
function lireCreneauxAdmin(date, serviceId, staffId) {
  const p = new URLSearchParams({ date, serviceId });
  if (staffId) p.set('staffId', staffId);
  return api(`/api/admin/slots?${p}`);
}

function poserRendezVous(corps) {
  return api('/api/admin/bookings', { methode: 'POST', corps });
}

function supprimerRendezVous(id) {
  return api(`/api/admin/bookings/${encodeURIComponent(id)}`, { methode: 'DELETE' });
}

/** Bloque une periode : une journee, des conges, ou l'absence d'une personne. */
function bloquerPeriode(corps) {
  return api('/api/admin/day-block', { methode: 'POST', corps });
}

function debloquerPeriode(corps) {
  return api('/api/admin/day-block', { methode: 'DELETE', corps });
}

/** Depose ou remplace une photo de la vitrine. */
function envoyerPhoto(emplacement, dataUrl) {
  return api(`/api/admin/photos/${encodeURIComponent(emplacement)}`, {
    methode: 'PUT',
    corps: { image: dataUrl },
  });
}

function retirerPhoto(emplacement) {
  return api(`/api/admin/photos/${encodeURIComponent(emplacement)}`, { methode: 'DELETE' });
}

/** La liste des photos et de leurs legendes, cote vitrine comme cote reglages. */
function lirePhotos() {
  return api('/api/admin/photos');
}
