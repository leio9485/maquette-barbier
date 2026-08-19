// ---------------------------------------------------------------------------
// LE RAPPEL DU RENDEZ-VOUS PRIS, GARDE DANS LE NAVIGATEUR.
//
// La seule chose que ce site ecrive sur la machine du visiteur, et seulement
// apres une reservation. Ni cookie, ni identifiant de visite, ni mesure
// d'audience : la page de confidentialite dit exactement ce qui est garde, et
// ce fichier est ce qui rend la phrase vraie.
//
// POURQUOI L'ECRIRE. Sans lui, un client qui reserve, ferme l'onglet et revient
// n'a plus qu'une reference de six caracteres a ressaisir — s'il l'a notee.
// Avec lui, il retrouve son rendez-vous en arrivant sur le site, et le lien
// « annuler » marche d'un clic.
//
// CE QU'ON NE GARDE PAS : ni nom, ni telephone, ni courriel. Ce qui est ecrit
// ici suffit a reconnaitre le rendez-vous et a en parler ; rien de plus. Le
// jeton, lui, est deja le secret que le client a recu, et il ne quitte pas sa
// machine.
//
// ⚠️ CE QUI EST ECRIT ICI N'EST PAS UNE SOURCE DE VERITE. Le salon a pu annuler
//    le rendez-vous par telephone, la base a pu etre remise a zero. Tout ce qui
//    l'affiche doit le REVALIDER aupres du serveur, en silence, et se taire si
//    la reponse ne vient pas. Voir js/11-mon-rendez-vous.js.
//
// Partage par les deux documents du site — la vitrine et la page d'annulation —
// parce qu'ils ecrivent et lisent le meme tiroir. Deux formats de stockage
// finiraient par diverger, et le symptome serait un bandeau qui ne disparait
// plus.
//
// Ce fichier est recolle AVANT js/02-utilitaires.js, dont il appelle
// `aujourdhui()`. C'est sans consequence : tout le code du site partage une
// seule portee, et une fonction declaree y est visible avant sa ligne. Il est
// place ici parce qu'il ne depend de rien du site — ni de CONFIG, ni du DOM.
// ---------------------------------------------------------------------------

const CLE_MEMOIRE = 'letabli.rdv';

/**
 * Le contenu du tiroir, toujours un tableau.
 *
 * Tout echec renvoie une liste vide : navigation privee, stockage refuse par le
 * navigateur, contenu abime par une version anterieure. Aucun de ces cas ne
 * justifie d'arreter la page — le rappel est un confort, pas une fonction.
 */
function lireMemoire() {
  try {
    const brut = localStorage.getItem(CLE_MEMOIRE);
    if (!brut) return [];
    const lu = JSON.parse(brut);
    return Array.isArray(lu) ? lu.filter((r) => r && r.reference && r.date) : [];
  } catch {
    return [];
  }
}

function ecrireMemoire(liste) {
  try {
    if (liste.length) localStorage.setItem(CLE_MEMOIRE, JSON.stringify(liste));
    else localStorage.removeItem(CLE_MEMOIRE);
  } catch {
    // Rien a faire, et rien a dire au visiteur : il n'a pas demande ce tiroir.
  }
}

/**
 * Les rendez-vous encore a venir, les perimes ecartes ET effaces.
 *
 * LE MENAGE SE FAIT A LA LECTURE, et non par une minuterie : c'est le seul
 * moment ou l'on est sur que quelqu'un est la. Un rendez-vous passe hier n'a
 * plus a etre garde, et le retirer est aussi ce que la page de confidentialite
 * annonce — on ne conserve pas ce qui ne sert plus.
 */
function rendezVousRetenus() {
  const aujourdHui = aujourdhui();
  const liste = lireMemoire();
  const vivants = liste.filter((r) => r.date >= aujourdHui);

  if (vivants.length !== liste.length) ecrireMemoire(vivants);

  return vivants.sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
}

/**
 * Retient un rendez-vous qui vient d'etre pris, ou met a jour celui qui porte
 * deja cette reference (un deplacement change le jour et l'heure, pas la
 * reference).
 */
function retenirRendezVous(rdv) {
  if (!rdv?.reference || !rdv?.date) return;

  const liste = lireMemoire();
  const ancien = liste.find((r) => r.reference === rdv.reference) ?? null;

  const garde = {
    reference: rdv.reference,
    // >>> UN JETON ABSENT N'EFFACE PAS CELUI QU'ON AVAIT. <<<
    //
    // Le cas est reel et il se voyait : un client qui deplace son rendez-vous
    // depuis /annuler s'est authentifie avec sa reference et quatre chiffres,
    // pas avec son jeton. Le serveur, lui, ne renvoie jamais le jeton a qui a
    // prouve de cette facon-la (voir `pourLeClient()`, src/routes/rendezvous.js
    // — et c'est une bonne regle). L'ecriture qui suivait le deplacement posait
    // donc `jeton: ''` par-dessus le jeton que la reservation avait laisse la,
    // et le bouton « Annuler ce rendez-vous » disparaissait de l'ecran de
    // confirmation. Le rendez-vous restait annulable depuis /annuler : ce
    // n'etait pas une impasse, c'etait une regression silencieuse.
    jeton: rdv.cancelToken || rdv.jeton || ancien?.jeton || '',
    date: rdv.date,
    start: rdv.start,
    // Meme regle pour ce qui n'est pas renvoye par tous les chemins : un
    // deplacement decrit le nouveau creneau, il ne redit pas la prestation.
    duration: rdv.duration ?? ancien?.duration ?? null,
    serviceName: rdv.serviceName || ancien?.serviceName || '',
    staffName: rdv.staffName || ancien?.staffName || '',
  };
  ecrireMemoire([...liste.filter((r) => r.reference !== garde.reference), garde]);
}

/** Retire un rendez-vous du tiroir : il vient d'etre annule, ou il n'existe plus. */
function oublierRendezVous(reference) {
  if (!reference) return;
  ecrireMemoire(lireMemoire().filter((r) => r.reference !== reference));
}
