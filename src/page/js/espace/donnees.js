// ---------------------------------------------------------------------------
// LES ECHANGES RESERVES AU COMMERCANT
//
// Toutes ces adresses exigent une session valide (`requireAdmin` cote serveur).
//
// >>> ELLES ETAIENT DANS js/03-donnees.js, ET PARTAIENT DONC DANS LA VITRINE. <<<
//
// Ce n'etait pas une faille — le serveur refuse, session ou pas — mais c'etait
// trois kilo-octets de code mort chez chaque visiteur, et surtout la liste
// complete de l'API d'administration offerte a la lecture. Un test du lot 4
// verifie desormais qu'aucune de ces chaines ne figure dans la page publique.
//
// `api()` reste dans js/03-donnees.js : les deux documents s'en servent, et il
// n'y a qu'une facon de parler au serveur dans ce projet.
// ---------------------------------------------------------------------------


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

/**
 * Depose ou remplace une photo de la vitrine, et ses variantes eventuelles
 * (largeurs reduites, WebP — voir produireVariantes() et src/lib/photos.js).
 *
 * ⚠️ LA CLE EST `data`, PAS `image`. Elle envoyait `{ image: dataUrl }` alors
 *    que le serveur lit `req.body?.data` (src/routes/settings.js) : chaque
 *    depot de photo depuis l'ecran des reglages echouait en silence, avec
 *    « Aucune image reçue. » — jamais vu par les tests, qui appellent l'API
 *    directement avec le bon nom de champ. Trouve en verifiant ce lot a
 *    l'ecran, pas par un test.
 */
function envoyerPhoto(emplacement, dataUrl, variantes) {
  return api(`/api/admin/photos/${encodeURIComponent(emplacement)}`, {
    methode: 'PUT',
    corps: { data: dataUrl, variantes },
  });
}

function retirerPhoto(emplacement) {
  return api(`/api/admin/photos/${encodeURIComponent(emplacement)}`, { methode: 'DELETE' });
}

/** La legende affichee SOUS une photo de la galerie. */
function ecrireLegendePhoto(emplacement, texte) {
  return api(`/api/admin/photos/${encodeURIComponent(emplacement)}/legende`, {
    methode: 'PUT',
    corps: { texte },
  });
}

/**
 * La description lue A LA PLACE d'une photo — l'attribut `alt`.
 *
 * Ce n'est pas la legende, et les deux adresses sont distinctes pour que la
 * confusion soit impossible : celle-ci accepte le visuel d'accueil, qui refuse
 * une legende.
 */
function ecrireDescriptionPhoto(emplacement, texte) {
  return api(`/api/admin/photos/${encodeURIComponent(emplacement)}/description`, {
    methode: 'PUT',
    corps: { texte },
  });
}

/** La liste des photos et de leurs legendes, cote vitrine comme cote reglages. */
function lirePhotos() {
  return api('/api/admin/photos');
}

/** Les nombres du volet « Chiffres », tous calcules par le serveur. */
function lireChiffres() {
  return api('/api/admin/chiffres');
}

/** Combien d'absences par numero, pour le marqueur discret de l'agenda. */
function lireAbsences() {
  return api('/api/admin/absences');
}

/** « Venu », « pas venu », ou rien (`null`) pour revenir en arriere. */
function pointerPresence(id, presence) {
  return api(`/api/admin/bookings/${encodeURIComponent(id)}/presence`, {
    methode: 'PUT',
    corps: { presence },
  });
}

/** Le SMS tout pret pour demander un avis, compose par le serveur. */
function lireMessageAvis() {
  return api('/api/admin/message-avis');
}
