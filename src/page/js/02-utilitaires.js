// ---------------------------------------------------------------------------
// LES OUTILS — echappement, ecriture des nombres, dates, raccourcis du DOM.
//
// Rien ici ne connait le site : ce sont des fonctions qu'on pourrait lire hors
// contexte. Tout ce qui sait quelque chose du barbier est dans les fichiers
// suivants.
// ---------------------------------------------------------------------------

/** Le premier element qui correspond, ou null. */
function $(selecteur, racine = document) {
  return racine.querySelector(selecteur);
}

/** Tous les elements qui correspondent, en vrai tableau. */
function $$(selecteur, racine = document) {
  return [...racine.querySelectorAll(selecteur)];
}

/**
 * Texte rendu inoffensif avant d'entrer dans du HTML.
 *
 * ⚠️ A APPELER SUR TOUTE VALEUR VENUE DE LA BASE, sans exception — un nom de
 * prestation, un prenom, une legende. Le commercant saisit ces textes lui-meme ;
 * il n'est pas malveillant, mais il peut coller un « & » ou un « < » sans y
 * penser, et une apostrophe typographique dans un attribut casserait la page.
 *
 * MEME REGLE QUE `esc()` COTE SERVEUR (src/lib/catalogue.js) : les deux
 * produisent le meme HTML, c'est ce qui permet a la page de reecrire une section
 * deja rendue sans que rien ne bouge a l'ecran.
 */
function esc(valeur) {
  return String(valeur ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** "18 €", "22,50 €". Meme ecriture que `fmtPrix()` cote serveur. */
function fmtPrix(n) {
  return (Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',')) + ' €';
}

/** "25 min", "1h", "1h30". Meme ecriture que `fmtDuree()` cote serveur. */
function fmtDuree(min) {
  if (min < 60) return `${min} min`;
  return min % 60 === 0 ? `${min / 60}h` : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
}

/** 570 -> "09:30". Les heures affichees en colonne gardent leur zero. */
function fmtHeure(minutes) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** "09:30" -> 570. */
function versMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm).trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

// --- Les dates -------------------------------------------------------------
//
// Une date s'ecrit "AAAA-MM-JJ" d'un bout a l'autre du site, serveur compris.
// Les objets Date ne servent qu'a calculer, jamais a transporter : ils portent
// une heure et un fuseau dont on n'a que faire, et c'est par la qu'arrivent les
// décalages d'un jour.

/** Un objet Date, a midi, depuis "AAAA-MM-JJ".
 *
 * MIDI ET NON MINUIT, ET C'EST LA RAISON D'ETRE DE CETTE FONCTION : au passage
 * a l'heure d'ete, minuit heure locale peut tomber la veille au soir une fois
 * converti, et toute la semaine affichee se decale d'un jour. A midi, aucun
 * changement d'heure ne fait franchir la limite du jour. */
function versDate(iso) {
  const [a, m, j] = String(iso).split('-').map(Number);
  return new Date(a, m - 1, j, 12, 0, 0, 0);
}

/** "AAAA-MM-JJ" depuis un objet Date, en heure locale. */
function versIso(date) {
  const a = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const j = String(date.getDate()).padStart(2, '0');
  return `${a}-${m}-${j}`;
}

/** La date d'aujourd'hui, en heure locale du visiteur. */
function aujourdhui() {
  return versIso(new Date());
}

/** La date obtenue en ajoutant (ou retirant) des jours. */
function plusDeJours(iso, nombre) {
  const d = versDate(iso);
  d.setDate(d.getDate() + nombre);
  return versIso(d);
}

/** 0 = dimanche ... 6 = samedi. */
function jourDeLaSemaine(iso) {
  return versDate(iso).getDay();
}

/** "jeudi 10 septembre". */
function dateLongue(iso) {
  const d = versDate(iso);
  return `${JOURS_LONGS[d.getDay()]} ${d.getDate()} ${MOIS_LONGS[d.getMonth()]}`;
}

/** "jeu. 10 sept." — pour les endroits ou la place manque. */
function dateCourte(iso) {
  const d = versDate(iso);
  const mois = MOIS_LONGS[d.getMonth()];
  const abrege = mois.length > 4 ? mois.slice(0, 4) + '.' : mois;
  return `${JOURS_COURTS[d.getDay()]} ${d.getDate()} ${abrege}`;
}

/** Le lundi de la semaine qui contient cette date. */
function lundiDe(iso) {
  const d = versDate(iso);
  const decalage = (d.getDay() + 6) % 7; // lundi = 0
  d.setDate(d.getDate() - decalage);
  return versIso(d);
}

// --- Le DOM ----------------------------------------------------------------

/** Ecrit du texte, jamais du HTML. A preferer partout ou c'est possible. */
function poserTexte(element, texte) {
  if (element) element.textContent = texte;
}

/** Montre ou masque, par l'attribut `hidden`. */
function montrer(element, visible = true) {
  if (element) element.hidden = !visible;
}

/**
 * Un message dans le flux, sur aplat plein.
 *
 * Jamais une bulle flottante : elle a besoin d'une ombre pour se detacher, elle
 * disparait souvent avant d'etre lue, et sur telephone elle recouvre ce qu'on
 * vient de saisir.
 *
 * ICI ET NON DANS LE TUNNEL, ou elle vivait : le tunnel, l'agenda, les
 * reglages, la connexion et la page d'annulation s'en servent tous. Depuis que
 * l'espace commercant est un document a part (lot 4), la laisser la-bas aurait
 * demande d'embarquer les vingt-deux kilo-octets du tunnel dans un document qui
 * n'a pas de tunnel.
 */
function afficherMessage(element, texte, ton = '') {
  if (!element) return;
  poserTexte(element, texte);
  if (ton) element.dataset.ton = ton; else delete element.dataset.ton;
  montrer(element, Boolean(texte));
}

/**
 * Les plages travaillees d'une journee, depuis un objet horaire des reglages.
 *
 * `null` = ferme. Une pause coupe la journee en deux plages. C'est la meme
 * lecture que `plagesDe()` cote serveur, et elle doit le rester : les deux
 * decrivent la meme chose a partir des memes reglages.
 */
function plagesDuJour(horaire) {
  if (!horaire) return [];
  const ouverture = versMinutes(horaire.open);
  const fermeture = versMinutes(horaire.close);
  if (ouverture === null || fermeture === null) return [];

  if (Array.isArray(horaire.pause) && horaire.pause.length === 2) {
    const debut = versMinutes(horaire.pause[0]);
    const fin = versMinutes(horaire.pause[1]);
    if (debut !== null && fin !== null) return [[ouverture, debut], [fin, fermeture]];
  }
  return [[ouverture, fermeture]];
}

/** "09:00 – 12:00 · 14:00 – 19:00", ou "Fermé". */
function texteHoraire(horaire) {
  const plages = plagesDuJour(horaire);
  if (!plages.length) return 'Fermé';
  return plages.map(([o, f]) => `${fmtHeure(o)} – ${fmtHeure(f)}`).join(' · ');
}
