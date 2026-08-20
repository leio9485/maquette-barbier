// ---------------------------------------------------------------------------
// L'AGENDA
//
// L'ecran que le commercant ouvre vingt fois par jour.
//
// ⚠️ UNE LISTE DE RENDEZ-VOUS, PLUS UNE GRILLE HORAIRE.
//
// C'etait une grille : une colonne par personne, une case cliquable toutes les
// demi-heures de l'ouverture a la fermeture, les rendez-vous poses dessus en
// position absolue. Un samedi de 8h30 a 17h faisait dix-sept cases par
// personne, cinquante et une en tout — pour trois rendez-vous. Le commercant
// ouvrait son agenda et voyait du vide quadrille.
//
// Une journee de barbier n'est pas un emploi du temps a remplir : c'est une
// liste de gens qui passent. On affiche donc les rendez-vous, dans l'ordre, et
// rien d'autre. Le vide ne se dessine pas — il se dit en une ligne.
//
// Ce qui a ete conserve : « Noter un rendez-vous » est un bouton en tete plutot
// qu'un clic dans une case vide, et il ouvre le meme formulaire.
// ---------------------------------------------------------------------------

/** Les rendez-vous de la periode affichee, ranges par jour. */
let AGENDA = new Map();

/**
 * Les numeros qui cumulent au moins deux absences, et combien.
 *
 * Charge une fois avec l'agenda plutot qu'interroge rendez-vous par
 * rendez-vous : la solution naive ferait cinquante allers-retours pour une
 * semaine. Le serveur ne renvoie QUE ceux qui atteignent le seuil — envoyer la
 * liste entiere reviendrait a exporter le repertoire du commerce a chaque
 * ouverture de l'agenda.
 */
let ABSENCES = { seuil: 2, absences: {} };

/**
 * Le meme calcul de cle que le serveur (src/lib/statistiques.js).
 *
 * ⚠️ LES DEUX DOIVENT RESTER IDENTIQUES. Si l'un normalise « +33 6 39… » et pas
 *    l'autre, le marqueur ne s'affichera jamais pour les numeros ecrits au
 *    format international — sans que rien ne le signale.
 */
function clePhone(telephone) {
  if (typeof telephone !== 'string') return '';
  let chiffres = telephone.replace(/\D/g, '');
  if (chiffres.startsWith('33') && chiffres.length === 11) chiffres = '0' + chiffres.slice(2);
  return chiffres;
}

/** Les personnes actives, pour nommer qui prend le rendez-vous. */
function equipeActive() {
  return (CONFIG?.staff ?? []).filter((p) => p.active !== false);
}

/** Les jours affiches, selon la vue. */
function joursAffiches() {
  if (ESPACE.vue === 'jour') return [ESPACE.date];
  const lundi = lundiDe(ESPACE.date);
  return [0, 1, 2, 3, 4, 5, 6].map((n) => plusDeJours(lundi, n));
}

// --- Le chargement ----------------------------------------------------------

/**
 * Faut-il descendre jusqu'a « maintenant » a la prochaine peinte ?
 *
 * >>> UNE SEULE FOIS, A L'OUVERTURE DU VOLET. <<< L'agenda se repeint a chaque
 * pointage, a chaque fin de creneau, a chaque retour de la liste des absences —
 * defiler a chacune de ces occasions arracherait la page des mains du
 * commercant en train de lire une autre heure. Le drapeau est donc pose par
 * `ouvrirVolet('agenda')` et consomme par la premiere peinte qui suit.
 */
let DEFILER_VERS_MAINTENANT = false;

/** Appele a l'ouverture du volet Agenda. */
function demanderLeDefilementVersMaintenant() {
  DEFILER_VERS_MAINTENANT = true;
}

/**
 * Descend jusqu'au repere « maintenant », s'il y en a un a l'ecran.
 *
 * >>> ON ARRIVE SUR LE MATIN D'UNE JOURNEE QU'ON A DEJA FAITE. <<< A 16 h, le
 * volet s'ouvrait sur 09:00 et il fallait faire defiler vingt lignes pour
 * arriver a ce qui reste — tous les jours, plusieurs fois par jour.
 *
 * ⚠️ `block: 'center'` ET NON `'start'` : le repere se calerait sinon sous
 *    l'en-tete de journee colle en haut, et on atterrirait sur le rendez-vous
 *    qui SUIT sans voir celui qui vient de finir. Au centre, on voit les deux.
 *
 * ⚠️ AUCUN FOCUS N'EST DEPLACE. Le motif est celui de `repeindreLePointage()`
 *    juste plus bas : `peindreAgenda()` remplace tout le contenu, et rendre le
 *    focus a un element repeint le retirerait de la ou le commercant l'avait
 *    mis. On deplace le regard, pas le clavier.
 */
function defilerVersMaintenant() {
  if (!DEFILER_VERS_MAINTENANT) return;

  const repere = $('.agenda-repere[data-repere="maintenant"]');
  if (!repere) return;

  DEFILER_VERS_MAINTENANT = false;
  repere.scrollIntoView({ block: 'center', behavior: 'auto' });
}

async function chargerAgenda() {
  const jours = joursAffiches();
  const du = jours[0];
  const au = jours[jours.length - 1];

  poserTexte($('#agendaPeriode'), ESPACE.vue === 'jour'
    ? dateLongue(du)
    : `${dateCourte(du)} – ${dateCourte(au)}`);

  try {
    const reponse = await lireRendezVous(du, au);

    // Les absences en meme temps que l'agenda, et sans le retenir : leur echec
    // ne doit pas empecher la journee de s'afficher. Sans elles, le marqueur ne
    // s'affiche pas — c'est tout.
    lireAbsences()
      .then((liste) => { ABSENCES = liste; peindreAgenda(); })
      .catch(() => { /* le marqueur est un confort, pas une fonction */ });

    AGENDA = new Map();
    for (const rdv of reponse.bookings ?? reponse) {
      if (!AGENDA.has(rdv.date)) AGENDA.set(rdv.date, []);
      AGENDA.get(rdv.date).push(rdv);
    }

    afficherMessage($('#messageAgenda'), '');
    peindreAgenda();
  } catch (erreur) {
    // Session expiree : on renvoie a la connexion plutot que d'afficher un
    // agenda vide qui ferait croire a une journee sans rendez-vous.
    if (erreur.code === 401) return exigerConnexion();
    afficherMessage($('#messageAgenda'), erreur.message);
  }
}

// --- Le dessin --------------------------------------------------------------

/**
 * L'ECRAN A-T-IL LA PLACE DES COLONNES PAR PERSONNE ?
 *
 * ⚠️ LE CHOIX SE FAIT EN JAVASCRIPT, ET IL NE POUVAIT PAS SE FAIRE EN CSS.
 *    Les deux formes ne rangent pas les mêmes lignes dans le même ordre : la
 *    liste est chronologique, les colonnes sont groupées par personne. Aucune
 *    règle de style ne réordonne un contenu ; il faut redessiner. C'est
 *    pourquoi ce media query est écouté ici plutôt que posé dans la feuille.
 */
const ECRAN_LARGE = window.matchMedia('(min-width: 900px)');

/**
 * Faut-il RANGER PAR PERSONNE plutot que par heure ?
 *
 * >>> LA VUE JOUR N'AVAIT PAS LES COLONNES QUE LA SEMAINE AVAIT, ET C'ETAIT LA
 *     HIERARCHIE INVERSE DE L'USAGE. <<<
 *
 * L'agenda est le volet par defaut « parce que c'est ce qu'on regarde vingt
 * fois par jour » (voir espace-commercant.html) — et c'est cette vue-la qui
 * rendait une liste plate de trente-trois lignes ou trois barbiers sont
 * melanges dans l'ordre chronologique. A 14:15 il y a deux rendez-vous en meme
 * temps, l'un pour Remi l'autre pour Yanis : en liste plate, savoir qui est
 * libre demandait de lire le prenom a droite de chaque ligne et de reconstruire
 * trois plannings de tete.
 *
 * Sans equipe enregistree il n'y a personne a grouper, et la liste
 * chronologique reste la bonne reponse — c'est l'agenda unique, celui du
 * commerce qui travaille seul.
 *
 * ⚠️ LA JOURNEE SE GROUPE A TOUTES LES LARGEURS, LA SEMAINE NON. Ce n'est pas
 *    une exception : sur un telephone, trois colonnes cote a cote ne tiennent
 *    pas, mais trois GROUPES empiles, si — et sept journees de trois groupes
 *    empiles ne se lisent plus du tout. Le repli de la journee est donc « la
 *    meme chose, en pile » ; celui de la semaine reste la liste chronologique.
 */
function grouperParPersonne() {
  if (!equipeActive().length) return false;
  if (ESPACE.vue === 'jour') return true;
  return ECRAN_LARGE.matches;
}

/**
 * Le rangement par personne se dessine-t-il en colonnes COTE A COTE ?
 *
 * C'est la seule chose que la largeur decide encore : l'ORDRE des lignes est
 * deja fixe par `grouperParPersonne()`, et un empilement de groupes n'a besoin
 * d'aucun JavaScript — la feuille s'en charge. `data-colonnes` ne dit donc plus
 * « range par personne », il dit « et mets-les cote a cote ».
 */
function enColonnes() {
  return grouperParPersonne() && ECRAN_LARGE.matches;
}

/**
 * LA HAUTEUR DE L'EN-TETE DE JOURNEE, PUBLIEE EN JETON CSS.
 *
 * >>> A QUOI ELLE SERT. <<< Le nom de la personne se colle en tete de sa
 * colonne (styles/15-agenda.css), et il doit se caler SOUS l'en-tete de
 * journee, lui-meme colle sous la barre du haut. Trois barres empilees, donc
 * deux hauteurs a connaitre — et celle-ci n'est pas plus decidable d'avance que
 * `--h-barre` : elle depend du nom du jour (« Mercredi 20 aout » contre « Lundi
 * 1er »), de la police une fois chargee, et de la largeur.
 *
 * ⚠️ MESUREE APRES LA PEINTE, ET A CHAQUE PEINTE. Un `ResizeObserver` serait
 *    plus elegant et ne marcherait pas : ses rappels sont livres pendant les
 *    etapes de rendu, et un onglet qui ne rend pas n'en recoit aucun — le motif
 *    complet est dans js/espace/demarrage.js, qui a fait le meme choix pour la
 *    barre du haut.
 *
 * ⚠️ ZERO VEUT DIRE « RIEN A L'ECRAN », PAS « PLUS RIEN A DECALER ». On garde
 *    alors la derniere hauteur connue, plutot que de coller les prenoms sous la
 *    barre du haut.
 */
function mesurerTeteDeJournee() {
  const tete = $('.agenda-jour-tete');
  if (!tete) return;

  const hauteur = Math.round(tete.getBoundingClientRect().height);
  if (hauteur > 0) document.documentElement.style.setProperty('--h-tete-jour', `${hauteur}px`);
}

function peindreAgenda() {
  const cible = $('#agenda');
  if (!cible || !CONFIG) return;

  cible.dataset.vue = ESPACE.vue;

  // Le CSS ne redecide rien : il applique le dessin que celui-ci a choisi.
  //
  // ⚠️ DEUX MARQUEURS, ET ILS NE DISENT PAS LA MEME CHOSE. `data-groupe` dit
  //    que les lignes sont rangees par personne — c'est le JavaScript qui l'a
  //    fait, aucune regle de style ne reordonne un contenu. `data-colonnes` dit
  //    seulement de poser ces groupes COTE A COTE plutot qu'en pile, et cela,
  //    la feuille sait le faire seule.
  if (grouperParPersonne()) cible.dataset.groupe = 'personnes';
  else delete cible.dataset.groupe;

  if (enColonnes()) cible.dataset.colonnes = 'personnes';
  else delete cible.dataset.colonnes;

  cible.innerHTML = joursAffiches().map(peindreJour).join('');

  mesurerTeteDeJournee();
  defilerVersMaintenant();
  programmerLeProchainPointage();
}

/**
 * Les rendez-vous d'un jour, dans l'ordre, blocages compris.
 *
 * ⚠️ LES BLOCAGES PASSENT DEVANT, A HEURE EGALE. Un blocage couvre la journee
 *    entiere : il commence donc a l'ouverture, c'est-a-dire souvent a la meme
 *    minute que le premier rendez-vous, et il se retrouvait range au hasard au
 *    milieu de la liste. « Le commerce est ferme ce jour-la » est la premiere
 *    chose a lire d'une journee, pas la troisieme.
 */
function rdvTriesDe(iso) {
  const rang = (r) => (r.type === 'block' ? 0 : 1);
  return [...(AGENDA.get(iso) ?? [])]
    .sort((a, b) => a.start - b.start || rang(a) - rang(b));
}

/** « 3 rendez-vous », « 1 rendez-vous », « — ». */
function compteDe(liste) {
  const vrais = liste.filter((r) => r.type !== 'block').length;
  if (!vrais) return '';
  return vrais > 1 ? `${vrais} rendez-vous` : '1 rendez-vous';
}

// --- LES REPERES DE LECTURE D'UNE JOURNEE -----------------------------------
//
// Deux manques, mineurs separement, agacants ensemble sur trente-trois lignes.
//
//   - LA LISTE PASSAIT DE 11:45 A 14:00 SANS RIEN INDIQUER. La pause du midi
//     n'etait marquee nulle part : on lisait un trou de deux heures et on
//     croyait a un creux de reservations, c'est-a-dire a du travail perdu. Or
//     c'est l'inverse — le commerce est ferme, il n'avait rien a vendre, et
//     c'est deja la lecture que le taux de remplissage applique
//     (src/lib/statistiques.js).
//   - RIEN NE MARQUAIT L'HEURE COURANTE. Sur l'ecran qu'on laisse ouvert toute
//     la journee, retrouver « ou on en est » demandait de lire les heures une
//     par une.

/**
 * La pause declaree et l'heure courante, sous forme de lignes a inserer.
 *
 * ⚠️ EN VUE JOUR SEULEMENT. La semaine est une vue d'ensemble : sept lignes
 *    « Fermé 12:00 – 14:00 » y ajouteraient une hauteur d'ecran pour redire
 *    sept fois la meme chose, et le trou qu'elles expliquent ne se lit de toute
 *    facon pas dans une journee resserree.
 */
function reperesDuJour(iso) {
  if (ESPACE.vue !== 'jour') return [];

  const reperes = [];
  const plages = plagesDuJour(CONFIG?.hours?.[jourDeLaSemaine(iso)]);

  // UNE PAUSE EST UN TROU ENTRE DEUX PLAGES, et c'est la seule definition juste :
  // elle vient des horaires, jamais d'une heure ecrite en dur. Un commerce en
  // journee continue n'en a aucune, et n'aura donc aucune ligne.
  for (let i = 1; i < plages.length; i++) {
    const debut = plages[i - 1][1];
    const fin = plages[i][0];
    if (fin > debut) {
      reperes.push({
        genre: 'pause', start: debut, fin,
        texte: `Fermé ${fmtHeure(debut)} – ${fmtHeure(fin)}`,
      });
    }
  }

  // >>> « MAINTENANT » N'EXISTE QUE SUR LA JOURNEE DU JOUR. <<< Le poser sur
  //     demain n'aurait aucun sens, et sur hier il mentirait.
  //
  // ⚠️ ET SEULEMENT DANS LES HEURES D'OUVERTURE. A 23 h, la ligne se poserait
  //    sous le dernier rendez-vous et dirait seulement « la journee est finie »
  //    — ce que la journee finie disait deja.
  if (iso === aujourdhui() && plages.length) {
    const t = Math.floor(minutesEcoulees());
    if (t >= plages[0][0] && t <= plages[plages.length - 1][1]) {
      reperes.push({ genre: 'maintenant', start: t, texte: 'Maintenant' });
    }
  }

  return reperes;
}

/**
 * Une liste de rendez-vous, avec ses reperes inseres au bon endroit.
 *
 * ⚠️ ON N'ARRETE PAS DE TRIER LA LISTE, ON GLISSE DEDANS. `rdvTriesDe()` range
 *    deja les blocages avant les rendez-vous a heure egale ; refaire un tri ici
 *    avec les reperes melanges perdrait cette regle sans que rien ne le signale.
 *
 * ⚠️ UNE PAUSE NE S'AFFICHE QUE SI ELLE EXPLIQUE UN TROU. C'est tout son objet :
 *    sans rien apres elle, il n'y a pas de trou a expliquer, et la ligne
 *    deviendrait un « Fermé 12:00 – 14:00 » posé en bas d'une matinee — une
 *    information vraie, au seul endroit ou personne ne se la posait.
 */
function listeAvecReperes(liste, reperes, iso) {
  const utiles = reperes.filter((m) => m.genre !== 'pause'
    || (liste.some((r) => r.start < m.start) && liste.some((r) => r.start >= m.fin)));

  const restants = [...utiles].sort((a, b) => a.start - b.start);
  const morceaux = [];

  for (const rdv of liste) {
    while (restants.length && restants[0].start <= rdv.start) {
      morceaux.push(htmlRepere(restants.shift()));
    }
    morceaux.push(ligneRdv(rdv, iso));
  }
  for (const m of restants) morceaux.push(htmlRepere(m));

  return `<ul class="agenda-liste">${morceaux.join('')}</ul>`;
}

/**
 * Un repere : un filet, un mot, rien d'autre.
 *
 * `data-repere` porte le genre : la feuille distingue la pause (en retrait, en
 * gris) de « maintenant » (le seul trait vert de l'ecran). Aucune forme
 * dessinee, aucun ornement — c'est le vocabulaire du reste du site.
 *
 * ⚠️ PAS D'`id` SUR « MAINTENANT ». Il y a un repere PAR GROUPE — trois
 *    colonnes, trois lignes « Maintenant » a la meme hauteur — et trois
 *    elements portant le meme identifiant sont un document invalide. Le
 *    defilement vise donc `[data-repere="maintenant"]`, dont il prend le
 *    premier.
 */
function htmlRepere(m) {
  return `<li class="agenda-repere" data-repere="${esc(m.genre)}">`
    + `<span>${esc(m.texte)}</span></li>`;
}

/**
 * Une journee.
 *
 * En vue jour comme en vue semaine : meme forme, meme balisage. C'est ce qui
 * fait que la semaine n'est pas un second dessin a maintenir — c'est sept fois
 * la journee, en plus resserre (voir 15-agenda.css).
 */
function peindreJour(iso) {
  const liste = rdvTriesDe(iso);
  const ouvert = plagesDuJour(CONFIG?.hours[jourDeLaSemaine(iso)]).length > 0;

  const nom = dateLongue(iso);
  const compte = compteDe(liste);

  const tete = `<div class="agenda-jour-tete"${iso === aujourdhui() ? ' data-aujourdhui' : ''}>`
    + `<p class="agenda-jour-nom">${esc(nom.charAt(0).toUpperCase() + nom.slice(1))}`
      + (iso === aujourdhui() ? ' <span class="agenda-marque">Aujourd\'hui</span>' : '')
    + '</p>'
    + `<p class="agenda-jour-compte donnee">${esc(compte || (ouvert ? 'Rien de prévu' : 'Fermé'))}</p>`
    + '</div>';

  // Un jour ferme SANS rendez-vous ne montre rien de plus. Un jour ferme AVEC
  // un rendez-vous, si : c'est une exception qu'il faut voir, pas cacher.
  //
  // ⚠️ CELA VAUT AUSSI EN COLONNES, ET C'EST VOLONTAIRE. Une journee vide
  //    pourrait s'y dessiner en trois colonnes « Libre », ce qui repondrait a
  //    la question — mais ce serait du vide quadrillé, en plus petit : le
  //    defaut meme que l'agenda a corrige en cessant d'etre une grille (voir
  //    l'en-tete de ce fichier). « Rien de prevu » dans la tete de journee le
  //    dit deja, en une ligne au lieu de trois colonnes.
  if (!liste.length) {
    return `<section class="agenda-jour">${tete}</section>`;
  }

  const reperes = reperesDuJour(iso);

  if (grouperParPersonne()) return jourParPersonne(iso, tete, liste, reperes);

  return `<section class="agenda-jour">${tete}`
    + listeAvecReperes(liste, reperes, iso)
    + '</section>';
}

/**
 * UNE JOURNEE RANGEE PAR PERSONNE : un groupe chacun.
 *
 * >>> A QUOI CE RANGEMENT REPOND, ET QUE LA LISTE NE FAISAIT PAS. <<< « Qui est
 * libre jeudi apres-midi ? » En liste chronologique, il faut lire la journee
 * entiere et tenir de tete qui apparait et qui manque. Range par personne, la
 * reponse est le groupe le plus court.
 *
 * ⚠️ LE MEME BALISAGE SERT AUX DEUX FORMES, et c'est ce qui evite un second
 *    dessin a maintenir. Cote a cote sur un ecran large, empiles en dessous :
 *    l'ORDRE des lignes est le meme dans les deux cas, seule la mise en page
 *    change, et une mise en page, la feuille sait la faire seule (voir
 *    `enColonnes()`).
 *
 * ⚠️ CE N'EST PAS LE RETOUR DE LA GRILLE. L'agenda a cesse d'etre une grille
 *    parce qu'il dessinait cinquante et une cases vides pour trois rendez-vous.
 *    Ici, un groupe ne contient QUE des rendez-vous reels : aucune case a
 *    l'heure, aucun quadrillage, et une seule ligne quand il n'y a rien.
 *
 * ⚠️ CE QUI N'APPARTIENT A PERSONNE PASSE AU-DESSUS, PLEINE LARGEUR. Un
 *    blocage du commerce entier et un rendez-vous non attribue occupent TOUT LE
 *    MONDE (voir prisma/schema.prisma) : les ranger dans un groupe les ferait
 *    passer pour l'affaire d'une seule personne, et laisserait croire les
 *    autres disponibles.
 */
function jourParPersonne(iso, tete, liste, reperes = []) {
  const colonnes = equipeActive();

  // Le bandeau du haut ne porte PAS les reperes : ils appartiennent aux listes
  // ou le trou se voit, c'est-a-dire aux groupes. Les poser aussi ici les
  // ferait apparaitre une fois de trop, au-dessus de tout le monde.
  const communs = liste.filter((r) => !r.staffId);
  const bandeau = communs.length
    ? `<ul class="agenda-liste">${communs.map((r) => ligneRdv(r, iso)).join('')}</ul>`
    : '';

  const cellules = colonnes.map((personne) => {
    const siens = liste.filter((r) => r.staffId === personne.id);

    // >>> « LIBRE » ET « NE TRAVAILLE PAS » NE SONT PAS LA MEME REPONSE. <<<
    //     Les confondre ferait proposer quelqu'un qui ne vient pas ce
    //     jour-la, ce qui est exactement la faute que cette vue existe pour
    //     eviter.
    const corps = siens.length
      ? listeAvecReperes(siens, reperes, iso)
      : `<p class="agenda-colonne-vide">${travailleLe(personne, iso) ? 'Libre' : 'Ne travaille pas'}</p>`;

    return '<div class="agenda-colonne">'
      + `<p class="agenda-colonne-nom etiquette">${esc(personne.name)}</p>`
      + corps
      + '</div>';
  }).join('');

  return `<section class="agenda-jour">${tete}${bandeau}`
    + `<div class="agenda-colonnes" style="--colonnes:${colonnes.length}">${cellules}</div>`
    + '</section>';
}

/**
 * Cette personne travaille-t-elle ce jour-la ?
 *
 * Trois cas, et ils viennent du schema (voir StaffHours) :
 *   - le commerce est ferme    : personne ne travaille ;
 *   - `hours` vaut null        : elle SUIT les horaires du commerce, donc oui ;
 *   - `hours[jour]` vaut null  : c'est son jour de repos.
 */
function travailleLe(personne, iso) {
  const jour = jourDeLaSemaine(iso);
  if (!plagesDuJour(CONFIG?.hours?.[jour]).length) return false;
  if (!personne.hours) return true;
  return plagesDuJour(personne.hours[jour]).length > 0;
}

/**
 * Une ligne de rendez-vous, dans la langue du site : l'heure en chasse fixe a
 * gauche, le nom, la prestation, la personne.
 *
 * La couleur de la personne tient dans un filet de 3 px a gauche, et son PRENOM
 * est ecrit a cote : une information portee par la seule couleur est une
 * information perdue pour qui ne la distingue pas — et le commercant qui
 * imprime sa journee en noir et blanc est dans ce cas.
 */
/**
 * Le telephone d'une ligne d'agenda : masque, revele, ou absent.
 *
 * >>> UN ECRAN D'AGENDA EST SOUVENT VISIBLE DEPUIS LA SALLE. <<< Trente numeros
 * complets s'affichaient en clair : en arriere-boutique c'est ce qu'on veut,
 * sur le comptoir c'est la donnee personnelle de trente clients exposee a tous
 * ceux qui attendent. Le reglage vit dans Reglages > Compte, il vaut « masque »
 * par defaut, et il est propre a l'appareil — voir js/espace/etat.js.
 *
 * ⚠️ MASQUER, C'EST ECRIRE AUTRE CHOSE, PAS ECRIRE MOINS. Retirer la ligne
 *    ferait sauter la colonne de droite d'un rendez-vous a l'autre selon qu'un
 *    numero est note ou non, et le commercant ne saurait plus si le numero
 *    manque ou s'il est cache. Les quatre derniers chiffres restent : ce sont
 *    eux qui servent a reconnaitre un client au telephone, et c'est deja le
 *    second facteur de /annuler.
 *
 * ⚠️ C'EST UN BOUTON DANS UN BOUTON, ET IL FAUT LES DEUX. La ligne entiere ouvre
 *    la fiche ; le numero masque, lui, se revele sur place. Un `<button>`
 *    imbrique est un balisage invalide — d'ou le `<span role="button">` avec son
 *    `tabindex` : il prend le focus, s'annonce comme un bouton, et le clic est
 *    arrete avant d'atteindre la ligne (voir le branchement en bas de fichier).
 */
function telephoneDeLaLigne(rdv) {
  if (!rdv.phone) return '';

  const revele = !masquerLesTelephones() || ESPACE.telephonesReveles.has(rdv.id);
  if (revele) return `<span class="agenda-tel">${esc(rdv.phone)}</span>`;

  // Les quatre derniers chiffres, et un point median pour ce qui manque.
  const chiffres = rdv.phone.replace(/\D/g, '');
  const fin = chiffres.slice(-4);

  return '<span class="agenda-tel" data-telephone-masque'
    + ` role="button" tabindex="0" data-devoiler="${esc(rdv.id)}"`
    + ` aria-label="Numéro masqué, finit par ${esc(fin.split('').join(' '))}. Afficher.">`
    + `<span aria-hidden="true">•• •• •• ${esc(fin.slice(0, 2))} ${esc(fin.slice(2))}</span>`
    + '</span>';
}

function ligneRdv(rdv, iso) {
  const fin = fmtHeure(rdv.start + rdv.duration);

  // ⚠️ UNE PERIODE BLOQUEE EST UN BOUTON, comme un rendez-vous.
  //
  // C'etait un `<li>` inerte : aucun bouton, aucun `data-`, aucune action. Un
  // barbier qui se trompait d'une semaine en posant ses conges fermait sa
  // boutique en ligne SANS AUCUN RECOURS, et devait appeler l'editeur. Creer un
  // blocage demandait un formulaire complet, le lever etait impossible.
  //
  // La personne concernee est ecrite a cote, comme pour un rendez-vous : le
  // commercant doit voir d'un coup d'oeil si c'est le commerce entier qui ferme
  // ou une seule personne qui s'absente.
  if (rdv.type === 'block') {
    const absent = CONFIG.staff.find((s) => s.id === rdv.staffId);

    return '<li class="agenda-ligne">'
      + `<button type="button" class="agenda-bloc" data-bloc="${esc(rdv.id)}">`
        + `<span class="agenda-heure donnee">${fmtHeure(rdv.start)}<span class="agenda-fin"> → ${fin}</span></span>`
        + '<span class="agenda-corps">'
          + `<span class="agenda-nom">${esc(rdv.notes || 'Bloqué')}</span>`
          + '<span class="agenda-quoi">Période bloquée</span>'
        + '</span>'
        + '<span class="agenda-cote donnee">'
          + `<span class="agenda-qui">${esc(absent ? absent.name : 'Tout le commerce')}</span>`
        + '</span>'
      + '</button>'
      + '</li>';
  }

  const prestation = CONFIG.services.find((s) => s.id === rdv.serviceId);
  const personne = CONFIG.staff.find((s) => s.id === rdv.staffId);

  const detail = [prestation?.name, fmtDuree(rdv.duration)].filter(Boolean).join(' · ');

  // Un rendez-vous que le CLIENT a annule reste affiche, barre. Le faire
  // disparaitre priverait le commercant de la seule chose qu'il a a en
  // apprendre : un creneau s'est libere sans qu'il y soit pour rien.
  const annule = Boolean(rdv.cancelledAt);

  // Le marqueur d'absences : discret, cote commercant seulement, JAMAIS de
  // conséquence automatique. C'est une information, le patron décide.
  const absences = ABSENCES.absences?.[clePhone(rdv.phone)] ?? 0;
  const marque = absences >= (ABSENCES.seuil ?? 2)
    ? `<span class="agenda-absences" title="${esc(absences)} absences constatées">${esc(absences)} abs.</span>`
    : '';

  return `<li class="agenda-ligne"${annule ? ' data-annule' : ''}>`
    + `<button type="button" class="agenda-rdv" data-rdv="${esc(rdv.id)}" data-source="${esc(rdv.source || '')}"`
      + (personne ? ` style="--teinte:${esc(personne.color || '#24405C')}"` : '')
      + `>`
      + `<span class="agenda-heure donnee">${fmtHeure(rdv.start)}<span class="agenda-fin"> → ${fin}</span></span>`
      + '<span class="agenda-corps">'
        + `<span class="agenda-nom">${esc(rdv.name)}${marque}</span>`
        + `<span class="agenda-quoi">${esc(detail)}${annule ? ' · annulé par le client' : ''}</span>`
      + '</span>'
      + '<span class="agenda-cote donnee">'
        + (personne ? `<span class="agenda-qui">${esc(personne.name)}</span>` : '')
        + telephoneDeLaLigne(rdv)
      + '</span>'
    + '</button>'
    + pointage(rdv, iso, annule)
    + '</li>';
}

/**
 * LES MINUTES ECOULEES DEPUIS MINUIT, PARTIE FRACTIONNAIRE COMPRISE.
 *
 * C'est la meme horloge que `start` — un nombre de minutes depuis minuit, et
 * NON un horodatage — en plus fin. Les secondes ne servent pas a comparer un
 * rendez-vous, elles servent a poser la minuterie sur la bonne seconde plutot
 * que jusqu'a cinquante-neuf secondes trop tard.
 */
function minutesEcoulees() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60;
}

/**
 * CE RENDEZ-VOUS EST-IL TERMINE ?
 *
 * >>> LA COMPARAISON PORTAIT SUR DES DATES, JAMAIS SUR DES HEURES. <<<
 *
 * C'etait `iso >= aujourdhui()`, ce qui est vrai de TOUTE la journee en cours :
 * celui de 9 h comme celui de 18 h. Un barbier ne pouvait donc pointer sa
 * matinee que le lendemain — alors que le pointage se fait dans la foulee, en
 * rendant la monnaie. L'intention du filtre etait juste (ne pas encombrer une
 * journee a venir), la comparaison etait trop grossiere d'un cran.
 *
 * ⚠️ SUR LA FIN, ET NON SUR LE DEBUT. A l'heure pile de l'arrivee, « pas venu »
 *    est un verdict premature : le client peut avoir trois minutes de retard.
 *    Quand le creneau est ecoule, la question est tranchee.
 */
function estTermine(rdv, iso) {
  const jour = aujourdhui();
  if (iso < jour) return true;
  if (iso > jour) return false;
  return rdv.start + rdv.duration <= minutesEcoulees();
}

/**
 * LE BOUTON « PAS VENU », SUR LES RENDEZ-VOUS TERMINES. UN SEUL.
 *
 * >>> VENU EST L'ETAT PAR DEFAUT : ON NE SIGNALE QUE L'EXCEPTION. <<<
 *
 * Ils etaient deux, et c'etait quarante-deux clics par jour pour repeter ce qui
 * arrive quarante fois sur quarante-deux — le client est venu. La regle
 * complete est en tete de `absences()`, src/lib/statistiques.js : un rendez-vous
 * passe est venu tant qu'il n'est pas marque « absent ».
 *
 * ⚠️ « VENU » NE PEUT PLUS ETRE UN BOUTON, et pas par economie de place. Il
 *    serait enfonce d'entree, et le cliquer ne pourrait que ramener a `null` —
 *    c'est-a-dire a « venu » de nouveau. Un bouton dont le clic ne change rien
 *    de visible est pire qu'un bouton absent : on le presse deux fois, puis on
 *    doute de tout l'ecran.
 *
 * Ils n'apparaissent pas avant la fin du creneau : pointer un rendez-vous de la
 * semaine prochaine n'a aucun sens, et un bouton de plus sur chaque ligne d'une
 * journee a venir encombrerait l'ecran qu'on ouvre vingt fois par jour.
 *
 * Un rendez-vous annule n'a personne a pointer.
 *
 * ⚠️ ON PEUT REVENIR EN ARRIERE : recliquer le bouton enfonce le relache, et le
 *    rendez-vous redevient venu. Le cas le plus frequent d'un pointage est le
 *    clic a cote, et un etat qu'on ne peut pas defaire ferait hesiter avant
 *    chacun.
 */
function pointage(rdv, iso, annule) {
  if (annule || !estTermine(rdv, iso)) return '';

  const absent = rdv.presence === 'absent';

  return '<span class="agenda-pointages">'
    + `<button type="button" class="agenda-pointage" data-pointage="${esc(rdv.id)}"`
      + ` data-valeur="absent" aria-pressed="${absent ? 'true' : 'false'}">`
      + 'Pas venu</button>'
    + '</span>';
}

// --- LES BOUTONS APPARAISSENT SANS QU'ON RECHARGE LA PAGE -------------------
//
// Le seuil de `estTermine()` depend de l'heure qu'il est. Sans rien de plus, les
// boutons du rendez-vous de 10h25 n'apparaitraient qu'au prochain chargement —
// et l'agenda du jour est justement l'ecran qu'on laisse ouvert toute la
// journee.
//
// ⚠️ UNE MINUTERIE POSEE SUR LA PROCHAINE FIN, ET NON UN REVEIL CHAQUE MINUTE.
//    Il n'y a rien a recalculer entre deux fins de creneau : une horloge qui
//    bat toutes les soixante secondes ferait quatre cents repeintes inutiles
//    dans une journee de barbier pour les trente qui changent quelque chose.

/** La minuterie en cours, s'il y en a une. Une seule a la fois. */
let minuterieDuPointage = null;

/**
 * Repeindre juste apres la prochaine fin de creneau du jour.
 *
 * Rappelee a chaque peinte, elle se re-arme donc d'elle-meme : chaque repeinte
 * pose la minuterie suivante, et la journee se pointe toute seule au fil des
 * heures. Quand il ne reste plus de creneau a finir, aucune minuterie n'est
 * posee — et si la periode affichee ne contient pas aujourd'hui, `AGENDA` n'a
 * rien a cette date et il n'y a rien a programmer.
 */
function programmerLeProchainPointage() {
  clearTimeout(minuterieDuPointage);
  minuterieDuPointage = null;

  const maintenant = minutesEcoulees();

  // Un blocage n'a personne a pointer, un rendez-vous annule non plus : ni l'un
  // ni l'autre ne fera apparaitre quoi que ce soit en se terminant.
  const fins = (AGENDA.get(aujourdhui()) ?? [])
    .filter((r) => r.type !== 'block' && !r.cancelledAt)
    .map((r) => r.start + r.duration)
    .filter((fin) => fin > maintenant);

  if (!fins.length) return;

  // Une demi-seconde apres la fin, pour ne pas tomber pile sur la limite et
  // repartir pour un tour sans que rien n'ait change.
  const delai = (Math.min(...fins) - maintenant) * 60000 + 500;
  minuterieDuPointage = setTimeout(repeindreLePointage, delai);
}

/**
 * ⚠️ ON NE REPEINT JAMAIS SOUS LES DOIGTS DE QUELQU'UN.
 *
 * `peindreAgenda()` remplace TOUT le contenu de l'agenda : si le commercant est
 * en train de parcourir sa journee au clavier, le focus retomberait sur le
 * document et il repartirait du haut de la page. C'est supportable apres un
 * clic qu'il vient de faire ; ca ne l'est pas quand c'est une minuterie qui le
 * decide, sans qu'il ait rien demande.
 *
 * On attend donc qu'il ait quitte l'agenda. Le rendez-vous de 10h25 gagnera ses
 * boutons trente secondes plus tard, ce qui n'a aucune importance — il vient
 * d'attendre son creneau entier.
 */
function repeindreLePointage() {
  if ($('#agenda')?.contains(document.activeElement)) {
    minuterieDuPointage = setTimeout(repeindreLePointage, 30000);
    return;
  }

  peindreAgenda();
}

/** Enregistre le pointage, ou l'annule si on reclique le meme. */
async function pointer(id, valeur) {
  const rdv = [...AGENDA.values()].flat().find((r) => r.id === id);
  if (!rdv) return;

  const nouvelle = rdv.presence === valeur ? null : valeur;

  try {
    await pointerPresence(id, nouvelle);
    rdv.presence = nouvelle;

    // Le nombre d'absences a pu changer : on relit, puis on repeint une fois.
    try { ABSENCES = await lireAbsences(); } catch { /* sans consequence */ }
    peindreAgenda();
  } catch (erreur) {
    if (erreur.code === 401) return exigerConnexion();
    afficherMessage($('#messageAgenda'), erreur.message);
  }
}

// --- LE FORMULAIRE DE RENDEZ-VOUS, DANS SES DEUX EMPLOIS --------------------
//
// Il NOTE un rendez-vous, et il en DEPLACE un. Les deux posent exactement les
// memes questions — quelle prestation, avec qui, quel jour, quelle heure — et
// en tenir deux d'accord aurait ete deux dessins a maintenir pour le meme
// travail. C'est la meme fenetre, et `MODE_RDV` dit lequel des deux emplois est
// en cours.
//
// Trois choses changent entre les deux, et rien d'autre : le titre, le libelle
// du bouton, et les deux champs de coordonnees — qui disparaissent au
// deplacement, puisqu'on ne change pas de client en decalant son rendez-vous.

/** `{ genre: 'ajout' }`, ou `{ genre: 'deplacement', rdv }`. */
let MODE_RDV = { genre: 'ajout' };

/**
 * Remplit les deux listes deroulantes, et y retrouve la valeur voulue.
 *
 * ⚠️ UNE VALEUR ABSENTE DE LA LISTE Y EST AJOUTEE. Une prestation retiree du
 *    site ou une personne en pause ne figure pas dans ce que la vitrine
 *    propose ; le rendez-vous qu'on deplace, lui, peut parfaitement etre l'un
 *    ou l'autre. Sans ce rattrapage, `select.value = …` ne trouve rien, retombe
 *    en silence sur la premiere ligne, et le deplacement changerait la
 *    prestation ou rendrait le rendez-vous a quelqu'un d'autre SANS QUE
 *    PERSONNE NE L'AIT DEMANDE.
 */
function garnirFormulaireRdv({ serviceId = '', qui = '' } = {}) {
  const choixPrestation = $('#rdvPrestation');
  if (choixPrestation && CONFIG) {
    const prestations = [...(CONFIG.services ?? [])];
    if (serviceId && !prestations.some((s) => s.id === serviceId)) {
      const perdue = { id: serviceId, name: 'Prestation retirée', duration: 0 };
      prestations.unshift(perdue);
    }

    choixPrestation.innerHTML = prestations
      .map((s) => `<option value="${esc(s.id)}">${esc(s.name)} — ${fmtDuree(s.duration)}</option>`)
      .join('');
    if (serviceId) choixPrestation.value = serviceId;
  }

  const colonnes = [...equipeActive()];
  if (qui && !colonnes.some((p) => p.id === qui)) {
    const enPause = (CONFIG?.staff ?? []).find((p) => p.id === qui);
    if (enPause) colonnes.unshift(enPause);
  }

  const choixQui = $('#rdvQui');
  montrer($('#champRdvQui'), colonnes.length > 0);
  if (choixQui && colonnes.length) {
    choixQui.innerHTML = '<option value="">Peu importe</option>'
      + colonnes.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
    choixQui.value = qui;
  }
}

/** Ouvre le formulaire de rendez-vous, pre-rempli si on vient d'une case. */
function ouvrirAjout({ date = ESPACE.date, heure = null, qui = '' } = {}) {
  MODE_RDV = { genre: 'ajout' };

  poserTexte($('#titreRdv'), 'Noter un rendez-vous');
  poserTexte($('#rdvValider'), 'Noter ce rendez-vous');
  montrer($('#rdvIntro'), false);
  montrer($('#champRdvNom'), true);
  montrer($('#champRdvTel'), true);

  garnirFormulaireRdv({ qui });
  poserJourRdv(date);

  afficherMessage($('#messageRdv'), '');
  chargerHeuresRdv(heure);

  ouvrirSurimpression('surimpressionRdv');
}

/**
 * Ouvre le meme formulaire pour DEPLACER un rendez-vous existant.
 *
 * Il s'ouvre sur les valeurs actuelles — meme prestation, meme personne, meme
 * jour, meme heure — et non sur un formulaire vide : deplacer, c'est presque
 * toujours ne changer qu'une seule de ces quatre reponses.
 */
function ouvrirDeplacement(rdv) {
  MODE_RDV = { genre: 'deplacement', rdv };

  poserTexte($('#titreRdv'), 'Déplacer le rendez-vous');
  poserTexte($('#rdvValider'), 'Déplacer ce rendez-vous');

  // On rappelle DE QUI il s'agit, parce que les deux champs qui le disaient
  // viennent de disparaitre.
  poserTexte($('#rdvIntro'), `${rdv.name || 'Rendez-vous'} — actuellement le `
    + `${dateCourte(rdv.date)} à ${fmtHeure(rdv.start)}.`);
  montrer($('#rdvIntro'), true);

  // Le nom et le telephone ne se changent pas ici : ce sont les coordonnees du
  // client, pas des proprietes du creneau. Les laisser aurait fait croire qu'un
  // deplacement peut aussi corriger un numero, ce que l'adresse ne fait pas.
  montrer($('#champRdvNom'), false);
  montrer($('#champRdvTel'), false);

  garnirFormulaireRdv({ serviceId: rdv.serviceId ?? '', qui: rdv.staffId ?? '' });
  poserJourRdv(rdv.date);

  afficherMessage($('#messageRdv'), '');
  chargerHeuresRdv(rdv.start);

  ouvrirSurimpression('surimpressionRdv');
}

/**
 * Les heures proposees au commercant : sans delai minimum, pauses comprises.
 *
 * ⚠️ AU DEPLACEMENT, LE RENDEZ-VOUS EST RETIRE DU CALCUL (`exclude`). Sans
 *    cela, il se verrait lui-meme comme obstacle : son heure actuelle
 *    reviendrait « prise », desactivee, et il deviendrait impossible de ne
 *    changer QUE la personne ou QUE la prestation en gardant l'heure. C'est le
 *    pendant, cote liste, de l'auto-collision que la transaction du serveur
 *    ecarte deja.
 */
async function chargerHeuresRdv(heureVoulue = null) {
  const choix = $('#rdvHeures');
  const date = $('#rdvDate')?.value;
  const serviceId = $('#rdvPrestation')?.value;
  if (!choix || !date || !serviceId) return;

  const exclure = MODE_RDV.genre === 'deplacement' ? MODE_RDV.rdv.id : '';

  // Les propositions multi-jours partent EN MEME TEMPS que la journee affichee.
  // Deux appels de lecture, jamais plafonnes (voir CLAUDE.md) ; les enchainer
  // ferait attendre la grille pour rien.
  chargerProchainesDispos(date, serviceId, exclure);

  try {
    const reponse = await lireCreneauxAdmin(date, serviceId, $('#rdvQui')?.value || '', exclure);
    peindreHeuresRdv(choix, reponse.slots ?? [], heureVoulue);
  } catch (erreur) {
    // >>> LA SESSION EXPIREE RENVOIE A LA CONNEXION, ELLE NE SE COMMENTE PAS. <<<
    //
    // Elle affichait « Connexion requise. » sous une liste d'heures vide, et
    // rien d'autre : le formulaire restait ouvert, son bouton actif, et chaque
    // clic reposait la meme question. Le seul geste utile — se reconnecter —
    // n'etait proposé nulle part. C'est le traitement que le reste du fichier
    // applique deja (`pointer`, `agirDepuisFiche`) ; il manquait ici.
    if (erreur.code === 401) return exigerConnexion();

    choix.innerHTML = '';
    verrouillerEnvoiRdv(true);
    afficherMessage($('#messageRdv'), erreur.message);
  }
}

/** La coupure matin / apres-midi, en minutes depuis minuit.
 *
 * ⚠️ `start` EST UN NOMBRE DE MINUTES DEPUIS MINUIT, pas un horodatage. 510
 *    vaut 8h30, 990 vaut 16h30. Le passer a `new Date()` donne le 1er janvier
 *    1970 a 1h du matin pour toutes les valeurs, et range la journee entiere
 *    dans « Matin » — le piege est raconte en tete de js/07-tunnel.js, ou la
 *    meme coupure existe pour le client.
 *
 * 13h et non midi : chez un barbier la pause de midi est dans le creux, et
 * « 12h45 » appartient a la matinee pour qui reserve. La valeur est redite ici
 * parce que le tunnel ne voyage pas dans ce document (voir tests/portees.mjs). */
const MINUTES_MIDI_AGENDA = 13 * 60;

/** Un creneau de la grille, dans le vocabulaire du tunnel client.
 *
 * ⚠️ MEME BALISAGE ET MEME CLASSE QUE `htmlCreneau()` (js/07-tunnel.js), a
 *    dessein. Le commercant vend le site en montrant sa vitrine puis son
 *    agenda : une heure libre qui ne se dessine pas pareil des deux cotes se
 *    remarque tout de suite. Le style est commun (styles/05-controles.css).
 *
 * L'`aria-label` porte « — déjà pris » : c'est lui qui dit l'indisponibilite a
 * qui n'a pas la couleur, depuis que le barre a ete retire. */
function htmlCreneauRdv(c, choisi) {
  const etiquette = c.free ? c.label : `${c.label} — déjà pris`;
  return `<button type="button" class="creneau" data-heure="${c.start}"`
    + ` aria-pressed="${c.start === choisi}" aria-label="${esc(etiquette)}"`
    // `data-pris` MARQUE, `disabled` INTERDIT, et les deux ne se confondent pas :
    // cocher « Forcer ce créneau » rend les heures prises cliquables sans leur
    // retirer ce qu'elles sont. `appliquerForcageAuxCreneaux()` ne bascule que
    // le second.
    + (c.free ? '' : ' data-pris disabled')
    + `>${esc(c.label)}</button>`;
}

/**
 * La case « Forcer » ouvre les créneaux pris, ou les referme.
 *
 * >>> SANS ELLE, LA CASE NE SERVIRAIT A RIEN. <<< On propose de doubler une
 * heure occupee, et la seule facon de designer une heure est de cliquer dans la
 * grille — ou toutes les heures occupees sont justement `disabled`. Il faut
 * donc les rouvrir en meme temps qu'on coche.
 *
 * ⚠️ DECOCHER RELACHE LE CHOIX QUAND IL PORTAIT SUR UNE HEURE PRISE. Le laisser
 *    en place enverrait un creneau occupe SANS `force` : un 409 certain, pour
 *    une case qu'on venait de decocher.
 */
function appliquerForcageAuxCreneaux() {
  const forcer = forcageDemande();

  for (const bouton of $$('#rdvHeures .creneau[data-pris]')) {
    bouton.disabled = !forcer;
  }

  const choisi = heureRetenue();
  const prise = $(`#rdvHeures .creneau[data-pris][data-heure="${choisi}"]`);

  if (!forcer && prise) {
    const libre = $('#rdvHeures .creneau:not([data-pris])');
    retenirHeure(libre ? Number(libre.dataset.heure) : null);
  }

  // Une journee entierement prise redevient utilisable des qu'on force : c'est
  // le seul cas ou l'ecran doit changer d'avis sur son propre message.
  const heures = $$('#rdvHeures .creneau');
  if (heures.length && !$('#rdvHeures .creneau:not([data-pris])')) {
    verrouillerEnvoiRdv(!forcer);
    if (forcer) afficherMessage($('#messageRdv'), '');
  }
}

/** L'heure retenue, ou `null`. */
function heureRetenue() {
  const brut = $('#rdvHeure')?.value;
  return brut === '' || brut === undefined ? null : Number(brut);
}

/** Retient une heure et marque le bouton correspondant. */
function retenirHeure(start) {
  const champ = $('#rdvHeure');
  if (champ) champ.value = start === null ? '' : String(start);

  for (const bouton of $$('#rdvHeures .creneau, #rdvDisposGrille .creneau')) {
    bouton.setAttribute('aria-pressed', String(Number(bouton.dataset.heure) === start));
  }

  marquerRefus($('#champRdvHeure'), false);
}

/**
 * Les heures proposees, rangees par demi-journee, EN GRILLE.
 *
 * >>> C'ETAIT UNE LISTE DEROULANTE, ET ELLE NE SERVAIT A RIEN SUR UNE JOURNEE
 *     CHARGEE. <<< Mesure : 28 entrees dont 27 « — pris » et desactivees, la
 *     seule selectionnable etant l'heure actuelle du rendez-vous. Le commercant
 *     deroulait trente lignes mortes pour decouvrir qu'il n'y avait rien, puis
 *     changeait de date et recommencait — au telephone, avec un client en
 *     ligne.
 *
 * Une grille montre les trente d'un coup, et le traitement du lot 4 fait
 * ressortir les libres : sur la meme journee, on voit « il reste 18:15 et
 * 18:30 » sans rien derouler.
 *
 * Deux groupes nommes plutot qu'un seul bloc : une journee de 8h30 a 21h en
 * donne trente-trois, et c'est la meme coupure que le tunnel client applique
 * a ses creneaux.
 */
function peindreHeuresRdv(grille, creneaux, heureVoulue = null) {
  const libres = creneaux.filter((c) => c.free);

  // >>> UNE JOURNEE SANS CRENEAU LE DIT. <<< La liste se vidait sans un mot :
  //     un jour de fermeture et un jour complet donnaient le meme ecran vide,
  //     avec un bouton actif qui repondait « Choisissez une heure » — alors
  //     qu'il n'y en avait aucune a choisir. Le message nomme les trois sorties,
  //     qui sont les trois autres champs du formulaire.
  //
  // ⚠️ LA GRILLE RESTE PEINTE, MEME COMPLETE. C'est la difference avec la liste
  //    deroulante qu'elle remplace : voir « 09:00 … 18:30 » tous eteints dit
  //    « c'est plein », un cadre vide dit « c'est cassé ». Et c'est aussi ce
  //    qu'il faut a l'ecran pour que « Forcer ce créneau » ait un sens : on
  //    force une heure qu'on voit.
  const groupes = [
    { nom: 'Matin', liste: creneaux.filter((c) => c.start < MINUTES_MIDI_AGENDA) },
    { nom: 'Après-midi', liste: creneaux.filter((c) => c.start >= MINUTES_MIDI_AGENDA) },
  ].filter((g) => g.liste.length > 0);

  // L'heure voulue si elle est encore libre, et A DEFAUT LA PREMIERE LIBRE.
  //
  // ⚠️ SANS CE REPLI, LE FORMULAIRE S'OUVRAIT SUR UN CRENEAU PRIS. La liste
  //    deroulante selectionnait sa premiere option, desactivee ou non : sur une
  //    journee qui commence par un rendez-vous, l'envoi partait vers un 409
  //    certain, pour un choix que personne n'avait fait.
  const voulue = heureVoulue !== null && libres.some((c) => c.start === heureVoulue)
    ? heureVoulue
    : (libres[0]?.start ?? null);

  grille.innerHTML = groupes
    .map((g) => '<div class="creneaux-groupe">'
      + `<h4 class="etiquette creneaux-moment">${esc(g.nom)}</h4>`
      + `<div class="creneaux-grille donnee">${g.liste.map((c) => htmlCreneauRdv(c, voulue)).join('')}</div>`
      + '</div>')
    .join('');

  retenirHeure(voulue);

  if (!libres.length) {
    verrouillerEnvoiRdv(true);
    afficherMessage($('#messageRdv'), creneaux.length
      ? "Plus aucun créneau libre ce jour-là. Changez de jour, de personne ou de prestation — ou cochez « Forcer ce créneau » pour doubler une heure prise."
      : "Le commerce est fermé ce jour-là. Choisissez un autre jour.");
  } else {
    verrouillerEnvoiRdv(false);
    afficherMessage($('#messageRdv'), '');
  }

  // La grille vient d'etre refaite : si la case est cochee, les creneaux pris
  // doivent redevenir cliquables tout de suite. L'oublier ferait qu'un
  // changement de jour, case cochee, rendait une grille verrouillee.
  appliquerForcageAuxCreneaux();
}

// --- LES PROCHAINES DISPONIBILITES ------------------------------------------
//
// >>> C'EST LA MOITIE DU CORRECTIF, ET LA PLUS UTILE. <<<
//
// Une grille de creneaux repond bien a « que reste-t-il CE JOUR-LA ? ». Elle ne
// repond pas a la question qu'on pose au telephone, qui est « quand pouvez-vous
// me prendre ? ». Sur une journee pleine, la grille est entierement eteinte et
// le commercant doit changer de date a l'aveugle, jour apres jour, jusqu'a
// tomber sur quelque chose.
//
// Le tunnel client, lui, ouvre le premier jour libre tout seul depuis le
// debut : le commercant avait moins que ses propres clients. Ces trois boutons
// sont calcules sur trente jours par le serveur (GET /api/admin/prochaines-
// dispos), portent leur date, et un clic suffit — il pose la date ET l'heure.

/** Les trois prochaines disponibilites reelles, tous jours confondus. */
async function chargerProchainesDispos(date, serviceId, exclure) {
  const bloc = $('#rdvDispos');
  const grille = $('#rdvDisposGrille');
  if (!bloc || !grille) return;

  try {
    const reponse = await lireProchainesDispos(date, serviceId, $('#rdvQui')?.value || '', exclure);
    peindreProchainesDispos(reponse.slots ?? []);
  } catch (erreur) {
    // ⚠️ UN ECHEC ICI NE DIT RIEN ET N'ARRETE RIEN. Ces trois boutons sont un
    //    raccourci, pas un passage oblige : la grille du jour, elle, est
    //    arrivee ou a deja affiche son propre message. Poser une seconde erreur
    //    a cote de la premiere ferait croire a deux pannes. La session expiree
    //    n'est pas traitee ici pour la meme raison — `chargerHeuresRdv()` la
    //    voit dans le meme souffle et renvoie a la connexion.
    montrer(bloc, false);
  }
}

function peindreProchainesDispos(creneaux) {
  const bloc = $('#rdvDispos');
  const grille = $('#rdvDisposGrille');

  // Rien a proposer sur trente jours : le bloc disparait plutot que d'afficher
  // un cadre vide. Le message du jour, lui, a deja dit ce qu'il fallait.
  montrer(bloc, creneaux.length > 0);
  if (!creneaux.length) {
    grille.innerHTML = '';
    return;
  }

  const choisi = heureRetenue();
  const jourAffiche = $('#rdvDate')?.value;

  grille.innerHTML = creneaux.map((c) => {
    // La date est ECRITE SUR LE BOUTON des qu'elle sort du jour affiche : sans
    // elle, « 09:00 » proposerait une heure d'un jour qu'on ne voit pas, et le
    // clic ferait changer la date sans prevenir.
    const memeJour = c.date === jourAffiche;
    const libelle = memeJour ? c.label : `${dateCourte(c.date)} ${c.label}`;
    const marque = memeJour && c.start === choisi;

    return `<button type="button" class="creneau" data-heure="${c.start}" data-jour="${esc(c.date)}"`
      + ` aria-pressed="${marque}"`
      + ` aria-label="${esc(`${dateLongue(c.date)} à ${c.label}`)}">${esc(libelle)}</button>`;
  }).join('');
}

/** Un clic sur une proposition : elle pose LA DATE ET L'HEURE. */
async function choisirProchaineDispo(bouton) {
  const jour = bouton.dataset.jour;
  const heure = Number(bouton.dataset.heure);

  // Deja sur le bon jour : rien a recharger, on retient l'heure et c'est tout.
  if (jour === $('#rdvDate')?.value) {
    retenirHeure(heure);
    return;
  }

  poserJourRdv(jour);
  await chargerHeuresRdv(heure);
}

/**
 * Revele le numero d'une ligne, pour la duree de la visite.
 *
 * >>> ON NE REPEINT QUE CE QU'IL FAUT. <<< `peindreAgenda()` remplace tout le
 * contenu : l'appeler ici ferait perdre le defilement au milieu d'une journee
 * de trente lignes, et retirerait le focus du clavier de la ou il etait — pour
 * afficher dix chiffres. On remplace donc le seul element concerne.
 *
 * ⚠️ LE FOCUS SUIT LE REMPLACEMENT. L'element qui portait le focus vient d'etre
 *    retire du document ; sans cette reprise, le clavier retomberait sur le
 *    document entier et la tabulation suivante repartirait du haut de la page.
 *    C'est le meme soin que le tunnel prend a chaque changement d'etape.
 *
 * Le choix est retenu dans `ESPACE` et non dans le stockage : c'est un geste,
 * pas un reglage. Il se perd au rechargement, et c'est ce qu'on veut — sinon
 * un ecran de comptoir finirait par tout afficher, une ligne a la fois.
 */
function devoilerLeTelephone(id) {
  if (!id) return;
  ESPACE.telephonesReveles.add(id);

  const rdv = [...AGENDA.values()].flat().find((r) => r.id === id);
  if (!rdv) return;

  const avaitLeFocus = document.activeElement?.dataset?.devoiler === id;

  for (const masque of $$(`[data-devoiler="${CSS.escape(id)}"]`)) {
    const remplacant = document.createElement('span');
    remplacant.className = 'agenda-tel';
    remplacant.textContent = rdv.phone;
    masque.replaceWith(remplacant);
    if (avaitLeFocus) {
      remplacant.setAttribute('tabindex', '-1');
      remplacant.focus({ preventScroll: true });
    }
  }
}

/** Le bouton d'envoi, eteint quand il n'y a rien a envoyer. */
function verrouillerEnvoiRdv(verrouille) {
  const bouton = $('#rdvValider');
  if (bouton) bouton.disabled = verrouille;
}

/**
 * Le jour du formulaire, et LA BORNE DU SELECTEUR DE DATE.
 *
 * `min` vaut aujourd'hui : le calendrier du navigateur grise alors tout le
 * passe. C'est un refus que le serveur oppose de toute facon — un rendez-vous
 * ne se deplace pas vers hier, cela fausserait le taux de remplissage comme le
 * pointage — mais il arrivait APRES la confirmation, une fois la question posee
 * et le formulaire referme. Le dire avant coute un attribut.
 */
function poserJourRdv(iso) {
  const champ = $('#rdvDate');
  if (!champ) return;

  champ.value = iso;
  champ.min = aujourdhui();
}

async function envoyerRdv(evenement) {
  evenement.preventDefault();

  if (MODE_RDV.genre === 'deplacement') return envoyerDeplacement();

  const message = $('#messageRdv');

  // Le champ fautif se signale au lecteur d'ecran ET reprend le focus, comme
  // dans le tunnel : un message qui n'apparait qu'a l'ecran ne dit rien a
  // quelqu'un qui ne le voit pas (lot 5).
  marquerRefus($('#rdvNom'), false);
  marquerRefus($('#champRdvHeure'), false);

  const nom = $('#rdvNom')?.value.trim();
  if (!nom) {
    afficherMessage(message, 'Il faut un nom.');
    marquerRefus($('#rdvNom'), true, 'messageRdv');
    $('#rdvNom')?.focus();
    return;
  }

  const heure = heureRetenue();
  if (!Number.isInteger(heure)) {
    afficherMessage(message, 'Choisissez une heure.');
    marquerRefus($('#champRdvHeure'), true, 'messageRdv');
    $('#rdvHeures .creneau:not([disabled])')?.focus();
    return;
  }

  const cible = {
    date: $('#rdvDate').value,
    start: heure,
    serviceId: $('#rdvPrestation').value,
    staffId: $('#rdvQui')?.value || undefined,
  };

  // Le doublement se confirme AVANT d'ecrire, et la confirmation nomme ce qui
  // est deja pose. Voir `confirmerForcage()`.
  //
  // ⚠️ LA FENETRE SE FERME AVANT LA QUESTION, et se rouvre si la reponse est
  //    non : le mecanisme de js/05-navigation.js ne retient qu'un element a
  //    rendre au clavier, deux boites empilees et le focus ne revient pas ou il
  //    faut. Meme sequence que le deplacement, juste en dessous.
  const forcee = forcageDemande();
  if (forcee) {
    fermerSurimpression('surimpressionRdv');
    if (!await confirmerForcage(cible)) {
      ouvrirSurimpression('surimpressionRdv');
      return;
    }
  }

  try {
    await poserRendezVous({
      ...cible,
      name: nom,
      phone: $('#rdvTel')?.value.trim() || '',
      // ⚠️ LA CLE NE PART QUE SI LA CASE EST COCHEE. Envoyer `force: false` a
      //    chaque saisie ferait du forcage un champ ordinaire du formulaire ;
      //    il doit rester ce qu'il est — une exception qu'on demande.
      ...(forcageDemande() ? { force: true } : {}),
      // ⚠️ PAS DE `source` ICI, ET C'EST VOULU. Le champ y figurait, et le
      //    serveur ne l'a jamais lu : la provenance est ecrite par la route
      //    elle-meme (`source: 'phone'` dans POST /api/admin/bookings). C'est
      //    la seule facon de la garder vraie — un client qui la choisit
      //    pourrait faire passer une saisie au comptoir pour une reservation en
      //    ligne, et c'est exactement le chiffre que le tableau de bord montre.
    });

    fermerSurimpression('surimpressionRdv');
    reinitialiserFormulaireRdv();
    await chargerAgenda();
  } catch (erreur) {
    if (erreur.code === 401) return exigerConnexion();

    // La fenetre a ete fermee juste avant pour poser la question du forcage :
    // on la rouvre, avec les valeurs refusees encore dedans. Seulement dans ce
    // cas — la rouvrir alors qu'elle est deja ouverte remettrait le focus sur
    // son premier champ, loin du message qu'on vient d'ecrire.
    if (forcee) ouvrirSurimpression('surimpressionRdv');
    afficherMessage(message, erreur.message);
  }
}

/**
 * Le formulaire rendu a son etat de depart.
 *
 * `reset()` seul ne suffit pas : il rend leurs valeurs aux champs, pas leur
 * visibilite ni leurs libelles. Sans cette remise a zero, le formulaire ouvert
 * une fois en deplacement gardait ensuite le titre « Déplacer le rendez-vous »
 * et ses deux champs de coordonnees masques — et « Noter un rendez-vous »
 * refusait alors la saisie faute de nom, sans nulle part ou le taper.
 */
function reinitialiserFormulaireRdv() {
  $('#formulaireRdv')?.reset();
  MODE_RDV = { genre: 'ajout' };
  verrouillerEnvoiRdv(false);

  poserTexte($('#titreRdv'), 'Noter un rendez-vous');
  poserTexte($('#rdvValider'), 'Noter ce rendez-vous');
  montrer($('#rdvIntro'), false);
  montrer($('#champRdvNom'), true);
  montrer($('#champRdvTel'), true);

  // ⚠️ LA GRILLE ET LES PROPOSITIONS SONT VIDEES A LA MAIN. `reset()` rend leur
  //    valeur aux champs, mais ces deux-la sont du contenu peint : sans cette
  //    ligne, rouvrir la fenetre montrait pendant un instant les creneaux de la
  //    fois d'avant, avec leur date — donc une proposition fausse, sur laquelle
  //    un clic rapide partait.
  const grille = $('#rdvHeures');
  if (grille) grille.innerHTML = '';
  montrer($('#rdvDispos'), false);
  marquerRefus($('#champRdvHeure'), false);
}

/**
 * Le deplacement : on demande confirmation, puis on envoie les quatre champs.
 *
 * >>> LA CONFIRMATION NE S'EMPILE PAS SUR LE FORMULAIRE. <<< Le mecanisme de
 * js/05-navigation.js ne retient qu'un element a rendre au clavier ; la fenetre
 * se ferme donc avant la question, et se rouvre telle quelle si la reponse est
 * non. Meme sequence que la fiche avant une suppression.
 */
async function envoyerDeplacement() {
  const message = $('#messageRdv');
  const rdv = MODE_RDV.rdv;

  marquerRefus($('#champRdvHeure'), false);

  const heure = heureRetenue();
  if (!Number.isInteger(heure)) {
    afficherMessage(message, 'Choisissez une heure.');
    marquerRefus($('#champRdvHeure'), true, 'messageRdv');
    $('#rdvHeures .creneau:not([disabled])')?.focus();
    return;
  }

  const cible = {
    date: $('#rdvDate').value,
    start: heure,
    serviceId: $('#rdvPrestation').value,
    // La cle part TOUJOURS, valeur vide comprise : c'est ainsi que « Peu
    // importe » rend le rendez-vous a personne. Cote serveur, c'est la presence
    // de la cle qui vaut ordre, pas sa valeur.
    staffId: $('#rdvQui')?.value || null,
  };

  const forcee = forcageDemande();

  fermerSurimpression('surimpressionRdv');

  // DEUX QUESTIONS QUAND ON FORCE, ET DANS CET ORDRE. La premiere nomme le
  // rendez-vous qu'on va doubler ; la seconde, celle du deplacement ordinaire,
  // nomme l'avant et l'apres. Les fondre en une seule ferait une phrase de six
  // lignes ou l'information qui compte — « Rémi a déjà quelqu'un à 15:00 » —
  // se perdrait au milieu du reste.
  if (forcee && !await confirmerForcage(cible, rdv.id)) {
    ouvrirSurimpression('surimpressionRdv');
    return;
  }

  if (!await confirmerDeplacement(rdv, cible, forcee)) {
    ouvrirSurimpression('surimpressionRdv');
    return;
  }

  try {
    await deplacerRendezVous(rdv.id, forcee ? { ...cible, force: true } : cible);

    reinitialiserFormulaireRdv();
    await chargerAgenda();
    annoncer(rappelDePrevenir(rdv, cible));
  } catch (erreur) {
    if (erreur.code === 401) return exigerConnexion();

    // Le refus se lit dans le formulaire, qui se rouvre avec les valeurs
    // refusees : un creneau pris se corrige en changeant l'heure, pas en
    // recommencant tout.
    ouvrirSurimpression('surimpressionRdv');
    afficherMessage(message, erreur.message);
  }
}

/** « du samedi 15 août à 09:00 au mardi 18 août à 14:30, avec Rémi ? » */
function confirmerDeplacement(rdv, cible, forcee = false) {
  const personne = CONFIG.staff.find((s) => s.id === cible.staffId);
  const prestation = CONFIG.services.find((s) => s.id === cible.serviceId);

  const avant = `${dateLongue(rdv.date)} à ${fmtHeure(rdv.start)}`;
  const apres = `${dateLongue(cible.date)} à ${fmtHeure(cible.start)}`;
  const avec = personne ? `, avec ${personne.name}` : '';

  const lignes = [
    ['Avant', `${dateCourte(rdv.date)} ${fmtHeure(rdv.start)}`],
    ['Après', `${dateCourte(cible.date)} ${fmtHeure(cible.start)}`],
    ['Prestation', prestation?.name ?? ''],
    ['Avec', personne?.name ?? 'Peu importe'],
    ['Téléphone', rdv.phone ?? ''],
  ];
  if (forcee) lignes.push(['Créneau', 'Forcé — l\'heure est déjà prise']);

  return demanderConfirmation({
    titre: 'Déplacer ce rendez-vous',
    phrase: `Déplacer le rendez-vous de ${rdv.name} du ${avant} au ${apres}${avec} ?`,
    lignes,
    // Le creneau libere repart au public dans la seconde : c'est la
    // consequence qu'on ne voit pas, et la seule qui ne se defait pas.
    consequence: 'L\'ancien créneau redevient réservable aussitôt. Le client '
      + 'n\'est prévenu de rien : c\'est à vous de l\'appeler.',
    oui: 'Oui, déplacer',
    non: 'Non, ne rien changer',
  });
}

// --- FORCER UN CRENEAU ------------------------------------------------------
//
// >>> LE PATRON EST CHEZ LUI. <<< S'il decide de caser quelqu'un en doublant a
// 15h — un habitue qui passe, un depannage, une coupe de dix minutes entre deux
// — le logiciel doit le permettre. C'est son agenda, et il connait son metier
// mieux que nous.
//
// Ce qu'il ne doit pas pouvoir faire, c'est doubler SANS S'EN APERCEVOIR. D'ou
// la confirmation, et d'ou le fait qu'elle NOMME le rendez-vous double : « Rémi
// a déjà Damien Carpentier à 15:00 ». « Ce créneau est occupé, continuer ? » ne
// dit pas assez — on ne sait pas qui on va faire attendre.

/** La case est-elle cochee ? */
function forcageDemande() {
  return Boolean($('#rdvForcer')?.checked);
}

/**
 * Ce qui occupe deja le creneau vise, en une phrase.
 *
 * ⚠️ ON RELIT LA JOURNEE PLUTOT QUE DE CHERCHER DANS L'AGENDA AFFICHE. Le jour
 *    vise peut etre a trois semaines, hors de la semaine chargee a l'ecran :
 *    chercher dans ce qu'on a sous la main rendrait « rien » et la question
 *    nommerait un rendez-vous vide. Une lecture, jamais plafonnee.
 *
 * `sauf` retire le rendez-vous qu'on deplace : il ne se double pas lui-meme.
 */
async function occupantsDuCreneau(cible, sauf = null) {
  const prestation = CONFIG.services.find((s) => s.id === cible.serviceId);
  const duree = prestation?.duration ?? 0;
  const fin = cible.start + duree;

  const { bookings = [] } = await lireRendezVous(cible.date, cible.date);

  return bookings.filter((r) => {
    if (r.id === sauf) return false;
    if (r.cancelledAt) return false;
    // Sans personne nommee, une ligne occupe tout le monde (voir le schema) :
    // elle compte quelle que soit la personne visee.
    if (cible.staffId && r.staffId && r.staffId !== cible.staffId) return false;
    return r.start < fin && r.start + r.duration > cible.start;
  });
}

/** « Rémi a déjà Damien Carpentier à 15:00. Poser un second rendez-vous ? » */
async function confirmerForcage(cible, sauf = null) {
  let occupants = [];
  try {
    occupants = await occupantsDuCreneau(cible, sauf);
  } catch {
    // ⚠️ ON NE FORCE PAS EN AVEUGLE. Si la lecture echoue, on ne sait pas ce
    //    qu'on va doubler : la question ne peut plus nommer personne, et une
    //    confirmation qui ne nomme rien ne confirme rien. On renonce, le
    //    commercant reessaie.
    afficherMessage($('#messageRdv'), "Impossible de lire ce qui occupe ce créneau. Réessayez.");
    return false;
  }

  // Rien n'occupe le creneau : la case etait cochee pour rien, et il n'y a donc
  // rien a confirmer. On laisse passer sans poser de question — refuser ici
  // ferait echouer une saisie parfaitement ordinaire.
  if (!occupants.length) return true;

  const nomDe = (id) => CONFIG.staff.find((s) => s.id === id)?.name ?? null;

  const lignes = occupants.map((r) => [
    nomDe(r.staffId) ?? 'Sans personne',
    `${fmtHeure(r.start)} · ${r.name || 'Sans nom'}`,
  ]);

  const premier = occupants[0];
  const qui = nomDe(premier.staffId);
  const phrase = qui
    ? `${qui} a déjà ${premier.name || 'un rendez-vous'} à ${fmtHeure(premier.start)}.`
      + ` Poser un second rendez-vous sur ce créneau ?`
    : `Un rendez-vous occupe déjà ${fmtHeure(premier.start)}.`
      + ` Poser un second rendez-vous sur ce créneau ?`;

  return demanderConfirmation({
    titre: 'Forcer ce créneau',
    phrase,
    lignes,
    consequence: 'Deux rendez-vous se chevaucheront. Le site ne proposera pas '
      + 'ce créneau au public, mais rien ne préviendra les deux clients.',
    oui: 'Oui, doubler',
    non: 'Non, choisir un autre créneau',
  });
}

/**
 * >>> PERSONNE N'A PREVENU LE CLIENT, ET IL FAUT LE DIRE. <<<
 *
 * Le rendez-vous a bouge dans l'agenda du commerce ; sur le telephone du
 * client, il est toujours a l'ancienne heure. Tant que les canaux de
 * notification sont eteints (src/lib/notifications.js), la seule chose honnete
 * a faire est de rappeler le numero, tout de suite, sur l'ecran qu'il regarde.
 *
 * Le jour ou le SMS s'allumera, cette phrase deviendra « Damien Carpentier a
 * ete prevenu par SMS » — et le point d'appel est deja marque cote serveur.
 */
function rappelDePrevenir(rdv, cible) {
  const quand = `${dateCourte(cible.date)} à ${fmtHeure(cible.start)}`;
  const qui = rdv.name || 'le client';

  return rdv.phone
    ? `Rendez-vous déplacé au ${quand}. Pensez à prévenir ${qui} — ${rdv.phone}.`
    : `Rendez-vous déplacé au ${quand}. Pensez à prévenir ${qui} : aucun numéro n'est noté.`;
}

// --- LA FICHE D'UNE LIGNE D'AGENDA ------------------------------------------
//
// >>> LE CLIC SUR UNE LIGNE OUVRE UNE FICHE. IL NE SUPPRIME PLUS RIEN. <<<
//
// Il demandait directement « Annuler le rendez-vous de X ? » dans une fenetre
// native. Deux choses clochaient. La premiere : ce n'est pas ce qu'on veut en
// cliquant sur une ligne d'agenda — on veut voir le telephone en entier, la
// prestation, la reference, savoir si le rendez-vous a ete pris en ligne ou
// note a la main. La seconde : la seule action possible etait irreversible, et
// elle etait cachee derriere un clic qu'on fait par curiosite.
//
// La suppression vit maintenant DANS la fiche, derriere un bouton nomme, et sa
// confirmation nomme le client, le jour, l'heure et la personne.

/** La ligne d'agenda actuellement ouverte en fiche. */
let FICHE_OUVERTE = null;

/** Le rendez-vous, retrouve dans ce que l'agenda a en memoire. */
function rdvConnu(id) {
  return [...AGENDA.values()].flat().find((r) => r.id === id) ?? null;
}

/** « en ligne » / « noté par le salon » — deux choses tres differentes a lire. */
function origineDe(rdv) {
  return rdv.source === 'online' ? 'Pris en ligne par le client' : 'Noté par le salon';
}

/** Ouvre la fiche d'un rendez-vous client. */
function ouvrirFicheRdv(id) {
  const rdv = rdvConnu(id);
  if (!rdv) return;

  const prestation = CONFIG.services.find((s) => s.id === rdv.serviceId);
  const personne = CONFIG.staff.find((s) => s.id === rdv.staffId);

  FICHE_OUVERTE = { genre: 'rdv', rdv };

  poserTexte($('#titreFicheAgenda'), rdv.name || 'Rendez-vous');

  const lignes = [
    ['Quand', `${dateCourte(rdv.date)} ${fmtHeure(rdv.start)} → ${fmtHeure(rdv.start + rdv.duration)}`],
    ['Prestation', prestation?.name ?? 'Prestation retirée'],
    ['Durée', fmtDuree(rdv.duration)],
    ['Avec', personne?.name ?? ''],
    ['À régler', rdv.price === null || rdv.price === undefined ? '' : fmtPrix(rdv.price)],
    ['Téléphone', rdv.phone ?? ''],
    ['Courriel', rdv.email ?? ''],
    ['Référence', rdv.reference ?? ''],
    ['Origine', origineDe(rdv)],
    ['Note', rdv.notes ?? ''],
  ];

  if (rdv.cancelledAt) lignes.push(['Annulé par le client', dateCourte(rdv.cancelledAt.slice(0, 10))]);

  // La fiche dit l'etat ENTIER, y compris quand il est implicite : sur l'agenda,
  // « venu » se lit a l'absence de marque, ce qui suffit quand on parcourt une
  // journee mais ne repond pas quand on ouvre une ligne pour la regarder. La
  // regle est en tete de `absences()`, src/lib/statistiques.js.
  if (!rdv.cancelledAt && estTermine(rdv, rdv.date)) {
    lignes.push(['Pointé', rdv.presence === 'absent' ? 'Pas venu' : 'Venu']);
  }

  peindreFicheDeTravail($('#ficheAgenda'), lignes);

  // Le telephone se TOUCHE : sur le telephone du commercant, c'est ce qui
  // permet de rappeler quelqu'un sans le recopier. On le repasse en lien apres
  // coup plutot que dans la fiche, qui n'ecrit que du texte.
  poserLienTelephone($('#ficheAgenda'), rdv.phone);

  poserTexte($('#ficheSupprimer'), 'Supprimer ce rendez-vous');

  // Un rendez-vous deja annule par le client ne se deplace pas : son creneau est
  // rendu, et le decaler reviendrait a le ressusciter dans le dos de celui qui
  // s'est decommande. Le serveur le refuse aussi (409) — les deux, parce qu'un
  // bouton qu'on ne peut pas presser vaut mieux qu'un refus apres coup.
  montrer($('#ficheDeplacer'), !rdv.cancelledAt);

  afficherMessage($('#messageFicheAgenda'), '');
  ouvrirSurimpression('surimpressionFiche');
}

/** Ouvre la fiche d'une periode bloquee. */
async function ouvrirFicheBloc(id) {
  const bloc = rdvConnu(id);
  if (!bloc) return;

  const personne = CONFIG.staff.find((s) => s.id === bloc.staffId);

  poserTexte($('#titreFicheAgenda'), bloc.notes || 'Période bloquée');
  peindreFicheDeTravail($('#ficheAgenda'), [['Jour', dateCourte(bloc.date)]]);
  poserTexte($('#ficheSupprimer'), 'Lever ce blocage');

  // Une periode bloquee se leve et se repose ; elle ne se deplace pas. Elle
  // tient a une ligne par jour, et « la decaler » n'aurait pas de sens sur une
  // periode qui enjambe des jours de fermeture habituelle.
  montrer($('#ficheDeplacer'), false);
  afficherMessage($('#messageFicheAgenda'), '');
  ouvrirSurimpression('surimpressionFiche');

  // La periode complete se demande au serveur : un blocage est une ligne par
  // jour, et seul lui sait quels jours de fermeture habituelle l'enjambent. La
  // fiche s'ouvre AVANT la reponse, avec ce qu'on sait deja — l'attente n'a pas
  // a se voir sur une boite qui s'ouvre.
  try {
    const periode = await lireBlocage(id);
    FICHE_OUVERTE = { genre: 'bloc', bloc, periode };

    const seulJour = periode.from === periode.to;

    peindreFicheDeTravail($('#ficheAgenda'), [
      ['Qui', personne?.name ?? 'Tout le commerce'],
      ['Du', dateCourte(periode.from)],
      ['Au', dateCourte(periode.to)],
      ['Journées bloquées', String(periode.days)],
      ['Motif', bloc.notes ?? ''],
      ['Heures', `${fmtHeure(bloc.start)} → ${fmtHeure(bloc.start + bloc.duration)}`],
    ]);

    poserTexte($('#ficheSupprimer'), seulJour ? 'Lever ce blocage' : 'Lever toute la période');
  } catch (erreur) {
    if (erreur.code === 401) return exigerConnexion();
    // La periode n'a pas pu etre recomposee : on leve au moins ce jour-la,
    // plutot que de laisser un bouton qui ne fait rien.
    FICHE_OUVERTE = { genre: 'bloc', bloc, periode: { from: bloc.date, to: bloc.date, days: 1 } };
    afficherMessage($('#messageFicheAgenda'), erreur.message);
  }
}

/**
 * Le numero de telephone, repasse en lien `tel:` dans la fiche.
 *
 * `peindreFicheDeTravail()` n'ecrit que du texte, et c'est voulu — tout ce qui
 * vient de la base y passe echappe. On retrouve donc la ligne apres coup, et on
 * n'y met qu'une adresse construite ici, jamais du balisage venu d'ailleurs.
 */
function poserLienTelephone(fiche, telephone) {
  if (!fiche || !telephone) return;

  const ligne = $$('div', fiche).find((d) => d.querySelector('dt')?.textContent === 'Téléphone');
  const valeur = ligne?.querySelector('dd');
  if (!valeur) return;

  const lien = document.createElement('a');
  lien.href = `tel:${telephone.replace(/[^\d+]/g, '')}`;
  lien.textContent = telephone;

  valeur.textContent = '';
  valeur.append(lien);
}

/** Le bouton d'action de la fiche : supprimer un rendez-vous, ou lever un blocage. */
async function agirDepuisFiche() {
  if (!FICHE_OUVERTE) return;

  // La confirmation ne s'empile pas sur la fiche : on ferme, on demande, et on
  // rouvre si la reponse est non (voir js/confirmation.js).
  fermerSurimpression('surimpressionFiche');

  const accepte = FICHE_OUVERTE.genre === 'rdv'
    ? await confirmerSuppressionRdv(FICHE_OUVERTE.rdv)
    : await confirmerLeveeBlocage(FICHE_OUVERTE);

  if (!accepte) {
    ouvrirSurimpression('surimpressionFiche');
    return;
  }

  try {
    let retour;

    if (FICHE_OUVERTE.genre === 'rdv') {
      await supprimerRendezVous(FICHE_OUVERTE.rdv.id);
      retour = `Le rendez-vous de ${FICHE_OUVERTE.rdv.name} a été supprimé.`;
    } else {
      const { bloc, periode } = FICHE_OUVERTE;
      await debloquerPeriode({ date: periode.from, to: periode.to, staffId: bloc.staffId ?? '' });
      retour = periode.days > 1
        ? `Le blocage est levé sur ${periode.days} journées. Les créneaux sont de nouveau réservables.`
        : 'Le blocage est levé. Les créneaux sont de nouveau réservables.';
    }

    FICHE_OUVERTE = null;

    // ⚠️ LE MESSAGE APRES LA RELECTURE, ET PAS AVANT. `chargerAgenda()` efface
    //    `#messageAgenda` quand elle aboutit — c'est ce qu'on veut d'elle, sans
    //    quoi une erreur resterait affichee sur un agenda qui s'est reaffiche.
    //    Annoncer avant, c'etait annoncer dans le vide : la ligne disparaissait
    //    sans un mot, exactement ce que ce retour doit eviter.
    await chargerAgenda();
    annoncer(retour);
  } catch (erreur) {
    if (erreur.code === 401) return exigerConnexion();
    afficherMessage($('#messageAgenda'), erreur.message);
  }
}

/**
 * Le retour visible apres une suppression.
 *
 * A defaut d'un vrai « annuler », le commercant doit au moins VOIR que quelque
 * chose s'est passe : une ligne qui disparait sans un mot laisse le doute
 * — a-t-on supprime la bonne ? a-t-on supprime tout court ?
 */
function annoncer(texte) {
  afficherMessage($('#messageAgenda'), texte, 'bon');
}

function confirmerSuppressionRdv(rdv) {
  const personne = CONFIG.staff.find((s) => s.id === rdv.staffId);
  const prestation = CONFIG.services.find((s) => s.id === rdv.serviceId);

  const quand = `${dateLongue(rdv.date)} à ${fmtHeure(rdv.start)}`;
  const avec = personne ? ` avec ${personne.name}` : '';

  return demanderConfirmation({
    titre: 'Supprimer ce rendez-vous',
    phrase: `Supprimer le rendez-vous de ${rdv.name}, ${quand}${avec} ?`,
    lignes: [
      ['Quand', `${dateCourte(rdv.date)} ${fmtHeure(rdv.start)}`],
      ['Prestation', prestation?.name ?? ''],
      ['Avec', personne?.name ?? ''],
      ['Téléphone', rdv.phone ?? ''],
    ],
    consequence: 'Le créneau repartira aussitôt à quelqu\'un d\'autre, et le client '
      + 'ne sera pas prévenu. Cette action ne se défait pas.',
    oui: 'Oui, supprimer',
    non: 'Non, le garder',
  });
}

function confirmerLeveeBlocage({ bloc, periode }) {
  const personne = CONFIG.staff.find((s) => s.id === bloc.staffId);
  const qui = personne ? personne.name : 'tout le commerce';
  const seulJour = periode.from === periode.to;

  return demanderConfirmation({
    titre: seulJour ? 'Lever ce blocage' : 'Lever toute la période',
    phrase: seulJour
      ? `Rouvrir le ${dateLongue(periode.from)} pour ${qui} ?`
      : `Rouvrir du ${dateLongue(periode.from)} au ${dateLongue(periode.to)} pour ${qui} ?`,
    lignes: [
      ['Qui', personne?.name ?? 'Tout le commerce'],
      ['Du', dateCourte(periode.from)],
      ['Au', dateCourte(periode.to)],
      ['Journées', String(periode.days)],
      ['Motif', bloc.notes ?? ''],
    ],
    consequence: 'Les créneaux redeviennent réservables en ligne immédiatement. '
      + 'Vous pourrez re-bloquer la période, mais les rendez-vous pris entre-temps resteront.',
    oui: seulJour ? 'Oui, lever le blocage' : 'Oui, lever la période',
    non: 'Non, la garder bloquée',
  });
}

async function envoyerBlocage(evenement) {
  evenement.preventDefault();
  const message = $('#messageBlocage');

  marquerRefus($('#blocageDu'), false);
  marquerRefus($('#blocageAu'), false);

  const du = $('#blocageDu')?.value;
  const au = $('#blocageAu')?.value;
  if (!du || !au) {
    afficherMessage(message, 'Il faut une date de début et une date de fin.');
    marquerRefus($(du ? '#blocageAu' : '#blocageDu'), true, 'messageBlocage');
    $(du ? '#blocageAu' : '#blocageDu')?.focus();
    return;
  }

  // Le motif part tel quel : c'est le serveur qui choisit le libelle de repli
  // quand il est vide, et un seul endroit doit le decider.
  const demande = {
    date: du,
    to: au,
    staffId: $('#blocageQui')?.value || undefined,
    notes: $('#blocageMotif')?.value.trim() || undefined,
  };

  try {
    let reponse;

    try {
      reponse = await bloquerPeriode(demande);
    } catch (erreur) {
      // 409 avec une liste : des rendez-vous sont deja pris sur la periode. Le
      // serveur n'a rien pose, et attend de savoir quoi en faire.
      if (erreur.code !== 409 || !Array.isArray(erreur.donnees?.conflicts)) throw erreur;

      const choix = await deciderDesConflits(erreur.donnees.conflicts);
      if (choix === null) return;

      reponse = await bloquerPeriode({
        ...demande,
        confirmConflicts: true,
        cancelConflicts: choix === 'annuler',
      });
    }

    fermerSurimpression('surimpressionBlocage');
    $('#formulaireBlocage').reset();
    await chargerAgenda();

    // Les jours de fermeture habituelle sont sautes par le serveur : on le dit,
    // sinon le commercant compte ses jours et croit a une erreur.
    //
    // La cle est `skipped`, et le serveur ne la renvoie QUE pour une periode de
    // plusieurs jours — une journee unique repond par le blocage lui-meme.
    const sautes = reponse?.skipped ?? 0;
    if (sautes) {
      afficherMessage($('#messageAgenda'),
        `Période bloquée. ${sautes} jour${sautes > 1 ? 's' : ''} de fermeture habituelle ${sautes > 1 ? 'ont' : 'a'} été ignoré${sautes > 1 ? 's' : ''}.`,
        'bon');
    }
  } catch (erreur) {
    if (erreur.code === 401) return exigerConnexion();
    afficherMessage(message, erreur.message);
  }
}

/**
 * L'ecran des rendez-vous qu'un blocage va recouvrir.
 *
 * Rend « garder », « annuler », ou `null` si la fenetre est fermee sans choisir
 * — auquel cas rien n'est bloque, et le formulaire reste ouvert tel qu'il etait.
 *
 * Deux boutons qui agissent tous les deux, plus une sortie : c'est pour cela
 * qu'il n'emprunte pas `demanderConfirmation()`, dont la reponse est un oui ou
 * un non. Il en reprend en revanche tous les objets — la liste, l'avertissement,
 * la paire de boutons.
 */
function deciderDesConflits(conflits) {
  const nombre = conflits.length;

  poserTexte($('#phraseConflits'), nombre > 1
    ? `${nombre} rendez-vous sont pris sur cette période. Voici les personnes à rappeler.`
    : 'Un rendez-vous est pris sur cette période. Voici la personne à rappeler.');

  peindreConflits($('#listeConflits'), conflits);
  ouvrirSurimpression('surimpressionConflits');

  return new Promise((resoudre) => {
    const boite = $('#surimpressionConflits');

    const terminer = (choix) => {
      boite.removeEventListener('click', surClic);
      boite.removeEventListener('keydown', surTouche);
      fermerSurimpression('surimpressionConflits');
      resoudre(choix);
    };

    function surClic(evenement) {
      if (evenement.target.closest('#conflitsGarder')) return terminer('garder');
      if (evenement.target.closest('#conflitsAnnuler')) return terminer('annuler');
      if (evenement.target === boite || evenement.target.closest('[data-fermer]')) terminer(null);
    }

    function surTouche(evenement) {
      if (evenement.key === 'Escape') terminer(null);
    }

    boite.addEventListener('click', surClic);
    boite.addEventListener('keydown', surTouche);
  });
}

/** Un rendez-vous en conflit, dans la forme d'une ligne d'agenda. */
function peindreConflits(cible, conflits) {
  if (!cible) return;

  cible.innerHTML = conflits.map((rdv) => {
    const prestation = CONFIG.services.find((s) => s.id === rdv.serviceId);
    const personne = CONFIG.staff.find((s) => s.id === rdv.staffId);
    const detail = [prestation?.name, fmtDuree(rdv.duration)].filter(Boolean).join(' · ');

    return '<li class="conflit">'
      + `<span class="conflit-quand donnee">${esc(dateCourte(rdv.date))} ${esc(fmtHeure(rdv.start))}</span>`
      + '<span class="conflit-corps">'
        + `<span class="conflit-nom">${esc(rdv.name || 'Sans nom')}</span>`
        + `<span class="conflit-quoi">${esc(detail)}${personne ? ' · ' + esc(personne.name) : ''}</span>`
      + '</span>'
      + (rdv.phone
        ? `<a class="conflit-tel donnee" href="tel:${esc(rdv.phone.replace(/[^\d+]/g, ''))}">${esc(rdv.phone)}</a>`
        : '<span class="conflit-tel donnee">pas de numéro</span>')
      + '</li>';
  }).join('');
}

function ouvrirBlocage() {
  const colonnes = equipeActive();
  const choix = $('#blocageQui');

  montrer($('#champBlocageQui'), colonnes.length > 0);
  if (choix && colonnes.length) {
    choix.innerHTML = '<option value="">Tout le commerce</option>'
      + colonnes.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  }

  const du = $('#blocageDu');
  const au = $('#blocageAu');
  if (du) du.value = ESPACE.date;
  if (au) au.value = ESPACE.date;

  afficherMessage($('#messageBlocage'), '');
  ouvrirSurimpression('surimpressionBlocage');
}

// --- Le branchement ---------------------------------------------------------

function brancherAgenda() {
  $('#agendaPrecedent')?.addEventListener('click', () => {
    ESPACE.date = plusDeJours(ESPACE.date, ESPACE.vue === 'jour' ? -1 : -7);
    chargerAgenda();
  });

  $('#agendaSuivant')?.addEventListener('click', () => {
    ESPACE.date = plusDeJours(ESPACE.date, ESPACE.vue === 'jour' ? 1 : 7);
    chargerAgenda();
  });

  $('#agendaAujourdhui')?.addEventListener('click', () => {
    ESPACE.date = aujourdhui();
    chargerAgenda();
  });

  for (const bouton of $$('input[name="agendaVue"]')) {
    bouton.addEventListener('change', () => {
      ESPACE.vue = bouton.value;
      chargerAgenda();
    });
  }

  // >>> FRANCHIR 900 PX CHANGE LE DESSIN, PAS SEULEMENT SA LARGEUR. <<<
  // Sans cette ligne, on garderait la liste sur un ecran qu'on vient
  // d'agrandir, ou les colonnes sur un ecran qu'on vient de retrecir — et
  // trois colonnes sur un telephone sont illisibles. C'est aussi ce qui se
  // produit en tournant une tablette.
  ECRAN_LARGE.addEventListener('change', () => {
    if (ESPACE.vue === 'semaine') peindreAgenda();
  });

  // La largeur change SANS franchir 900 px : le dessin ne bouge pas, mais le
  // nom du jour peut passer a la ligne — et les prenoms colles dessous se
  // calent sur sa hauteur.
  window.addEventListener('resize', mesurerTeteDeJournee);
  document.fonts?.ready.then(mesurerTeteDeJournee);

  $('#ouvrirAjoutRdv')?.addEventListener('click', () => ouvrirAjout());
  $('#ouvrirBlocage')?.addEventListener('click', ouvrirBlocage);

  // Les cases vides cliquables ont disparu avec la grille : on note un
  // rendez-vous par le bouton en tete, qui ouvre le meme formulaire.
  $('#agenda')?.addEventListener('click', (evenement) => {
    // Le pointage d'abord : ses boutons sont DANS la ligne, et laisser passer
    // le clic ouvrirait la fiche par-dessus.
    const point = evenement.target.closest('[data-pointage]');
    if (point) return pointer(point.dataset.pointage, point.dataset.valeur);

    // ⚠️ LE NUMERO MASQUE AUSSI PASSE AVANT, ET POUR LA MEME RAISON. Il est
    //    DANS le bouton de la ligne : laisser filer le clic ouvrirait la fiche
    //    par-dessus le numero qu'on vient de reveler. Il porte `data-devoiler`
    //    et non `data-rdv`, sinon la ligne juste en dessous le prendrait pour
    //    elle.
    const masque = evenement.target.closest('[data-devoiler]');
    if (masque) return devoilerLeTelephone(masque.dataset.devoiler);

    const rdv = evenement.target.closest('[data-rdv]');
    if (rdv) return ouvrirFicheRdv(rdv.dataset.rdv);

    const bloc = evenement.target.closest('[data-bloc]');
    if (bloc) ouvrirFicheBloc(bloc.dataset.bloc);
  });

  // >>> LE CLAVIER, PARCE QU'UN `role="button"` NE L'A PAS TOUT SEUL. <<< Un
  //     vrai `<button>` repond a Entree et a Espace ; un `<span>` qui s'annonce
  //     comme un bouton doit les brancher lui-meme, sans quoi le numero ne se
  //     revele qu'a la souris. Le `<span>` est impose par le balisage : un
  //     bouton dans un bouton est invalide.
  $('#agenda')?.addEventListener('keydown', (evenement) => {
    if (evenement.key !== 'Enter' && evenement.key !== ' ') return;

    const masque = evenement.target.closest('[data-devoiler]');
    if (!masque) return;

    // Espace ferait defiler la page ; Entree activerait le bouton de la ligne.
    evenement.preventDefault();
    devoilerLeTelephone(masque.dataset.devoiler);
  });

  $('#ficheSupprimer')?.addEventListener('click', agirDepuisFiche);

  // La fiche se ferme, le formulaire s'ouvre a sa place : deux surimpressions
  // empilees et le focus ne revient pas ou il faut (voir js/confirmation.js).
  $('#ficheDeplacer')?.addEventListener('click', () => {
    if (FICHE_OUVERTE?.genre !== 'rdv') return;
    const rdv = FICHE_OUVERTE.rdv;
    fermerSurimpression('surimpressionFiche');
    ouvrirDeplacement(rdv);
  });

  // Changer de prestation ou de personne change les heures possibles.
  //
  // ⚠️ L'HEURE DEJA RETENUE EST REPASSEE. Sans elle, changer de personne
  //    reposait le formulaire sur le premier creneau libre de la journee : on
  //    choisissait 18:15, on precisait « avec Karim », et l'heure retombait a
  //    09:00 sans un mot. `peindreHeuresRdv()` la garde si elle est encore
  //    libre, et retombe sur la premiere sinon — ce qui est exactement le bon
  //    comportement quand le changement vient de la rendre impossible.
  $('#rdvPrestation')?.addEventListener('change', () => chargerHeuresRdv(heureRetenue()));
  $('#rdvQui')?.addEventListener('change', () => chargerHeuresRdv(heureRetenue()));
  $('#rdvDate')?.addEventListener('change', () => chargerHeuresRdv(heureRetenue()));

  // Les créneaux : la grille du jour et les propositions n'ont pas le même
  // effet. La grille retient une heure ; une proposition pose AUSSI la date,
  // puisqu'elle peut désigner un autre jour.
  $('#rdvHeures')?.addEventListener('click', (evenement) => {
    const bouton = evenement.target.closest('.creneau');
    if (bouton && !bouton.disabled) retenirHeure(Number(bouton.dataset.heure));
  });

  $('#rdvDisposGrille')?.addEventListener('click', (evenement) => {
    const bouton = evenement.target.closest('.creneau');
    if (bouton) choisirProchaineDispo(bouton);
  });

  // Cocher « Forcer » rend les créneaux pris cliquables : c'est le geste, et il
  // serait absurde de proposer de forcer sans pouvoir désigner l'heure occupée.
  $('#rdvForcer')?.addEventListener('change', appliquerForcageAuxCreneaux);

  $('#formulaireRdv')?.addEventListener('submit', envoyerRdv);
  $('#formulaireBlocage')?.addEventListener('submit', envoyerBlocage);

  // Un champ corrige cesse d'etre en faute des la frappe : laisser
  // `aria-invalid` sur une saisie qui vient d'etre reparee ferait dire
  // « saisie invalide » sur un champ qui ne l'est plus.
  for (const formulaire of [$('#formulaireRdv'), $('#formulaireBlocage')]) {
    formulaire?.addEventListener('input', (evenement) => marquerRefus(evenement.target, false));
  }
}
