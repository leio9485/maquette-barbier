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

/**
 * Qui est connecte, depuis quand, et combien d'autres appareils sont ouverts.
 *
 * Sert au demarrage — une session encore valide rouvre l'espace — et a la
 * section « Compte » des reglages.
 */
function lireCompte() {
  return api('/api/admin/me');
}

/** Change le mot de passe, et ferme toutes les autres sessions au passage. */
function changerMotDePasse(actuel, nouveau, confirmation) {
  return api('/api/admin/password', {
    methode: 'PUT',
    corps: {
      currentPassword: actuel,
      newPassword: nouveau,
      confirmPassword: confirmation,
    },
  });
}

// --- LES PERSONNES AUTORISEES ----------------------------------------------
//
// Un acces par personne, plutot qu'un mot de passe partage ecrit pres de la
// caisse. Voir le commentaire en tete de la section dans src/routes/auth.js.

/** Qui a le droit d'entrer. Aucune empreinte de mot de passe n'en sort. */
function lireComptes() {
  return api('/api/admin/users');
}

/** Cree un acces. Le mot de passe initial se communique de vive voix. */
function creerCompte(identifiant, motDePasse) {
  return api('/api/admin/users', {
    methode: 'POST',
    corps: { username: identifiant, password: motDePasse },
  });
}

/**
 * Coupe un acces, et ferme les sessions de ce compte — celles-la seules.
 *
 * Le serveur refuse le dernier compte et le sien propre : l'ecran retire deja
 * le bouton dans ces deux cas, mais la regle est du cote du serveur, ou elle ne
 * depend pas de ce que la page a bien voulu dessiner.
 */
function revoquerCompte(id) {
  return api(`/api/admin/users/${encodeURIComponent(id)}`, { methode: 'DELETE' });
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

/**
 * Les creneaux vus par le commercant : sans delai minimum, pauses comprises.
 *
 * `exclure` retire un rendez-vous du calcul, et ne sert qu'au deplacement : sans
 * lui, le rendez-vous qu'on deplace s'affiche comme obstacle a lui-meme et son
 * heure actuelle sort de la liste, si bien qu'on ne peut plus changer la seule
 * personne ni la seule prestation.
 */
function lireCreneauxAdmin(date, serviceId, staffId, exclure) {
  const p = new URLSearchParams({ date, serviceId });
  if (staffId) p.set('staffId', staffId);
  if (exclure) p.set('exclude', exclure);
  return api(`/api/admin/slots?${p}`);
}

/**
 * Les premieres disponibilites REELLES, tous jours confondus.
 *
 * `lireCreneauxAdmin` ci-dessus ne repond que sur UNE journee, celle qu'on lui
 * nomme : sur un jour plein, elle rend trente creneaux tous pris et le
 * commercant doit changer de date a l'aveugle jusqu'a tomber sur quelque
 * chose. Le tunnel client, lui, ouvre le premier jour libre tout seul depuis le
 * debut — c'est cette avance-la qui manquait a l'espace.
 *
 * `exclure` a le meme role qu'au-dessus : un rendez-vous qu'on deplace ne doit
 * pas se voir lui-meme comme obstacle, sans quoi son heure actuelle ne figure
 * jamais parmi les propositions.
 */
function lireProchainesDispos(date, serviceId, staffId, exclure) {
  const p = new URLSearchParams({ date, serviceId });
  if (staffId) p.set('staffId', staffId);
  if (exclure) p.set('exclude', exclure);
  return api(`/api/admin/prochaines-dispos?${p}`);
}

function poserRendezVous(corps) {
  return api('/api/admin/bookings', { methode: 'POST', corps });
}

/**
 * DEPLACE UN RENDEZ-VOUS SANS LE RECREER.
 *
 * >>> C'EST LA DIFFERENCE ENTRE DEPLACER ET SUPPRIMER-PUIS-RE-NOTER. <<< Le
 * second etait le seul chemin possible avant que cet appel n'existe, et il
 * cassait tout ce qui tient a l'identite du rendez-vous : la reference que le
 * client a notee, son jeton d'annulation, le bandeau « Votre rendez-vous » sur
 * son telephone, et la provenance qui alimente le tableau de bord.
 *
 * Seules les cles envoyees changent : `{ staffId }` seul reattribue sans rien
 * decaler, `{ date, start }` decale sans toucher a qui s'en occupe.
 */
function deplacerRendezVous(id, corps) {
  return api(`/api/admin/bookings/${encodeURIComponent(id)}`, { methode: 'PATCH', corps });
}

function supprimerRendezVous(id) {
  return api(`/api/admin/bookings/${encodeURIComponent(id)}`, { methode: 'DELETE' });
}

/** Bloque une periode : une journee, des conges, ou l'absence d'une personne. */
function bloquerPeriode(corps) {
  return api('/api/admin/day-block', { methode: 'POST', corps });
}

/**
 * Un blocage, ET LA PERIODE A LAQUELLE IL TIENT.
 *
 * Un blocage est une ligne par jour en base ; le commercant, lui, a saisi
 * « du 12 au 22 aout ». C'est le serveur qui recompose la periode, parce que
 * c'est lui qui sait quels jours sont deja fermes et n'ont donc rien recu.
 */
function lireBlocage(id) {
  return api(`/api/admin/day-block/${encodeURIComponent(id)}`);
}

/**
 * Leve un blocage, ou toute la periode a laquelle il appartient.
 *
 * ⚠️ EN PARAMETRES D'ADRESSE, PAS EN CORPS DE REQUETE. Cette fonction envoyait
 *    un corps JSON a une route qui lit `req.query` : elle n'a jamais rien leve.
 *    Personne ne s'en est apercu parce qu'aucun ecran ne l'appelait — une
 *    periode bloquee ne pouvait pas se lever du tout (lot 1).
 */
function debloquerPeriode({ date, to, staffId } = {}) {
  const p = new URLSearchParams({ date });
  if (to) p.set('to', to);
  if (staffId) p.set('staffId', staffId);
  return api(`/api/admin/day-block?${p}`, { methode: 'DELETE' });
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
