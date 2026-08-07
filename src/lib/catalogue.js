// ---------------------------------------------------------------------------
// LA SECTION « PRESTATIONS », ECRITE DANS LA PAGE SERVIE
//
// Sans ce fichier, la vitrine partirait avec un conteneur VIDE : les treize
// prestations, leurs tarifs et leurs durees seraient peints par le JavaScript
// de la page une fois /api/config recu. Le contenu le plus substantiel du site
// n'existerait donc pas dans le fichier envoye.
//
// Google execute le JavaScript, la page finirait par etre indexee — mais au
// deuxieme passage de son robot, qui peut arriver des jours plus tard. Et il est
// le seul a le faire aussi bien : la plupart des autres lecteurs (moteurs
// secondaires, apercus de lien, annuaires, agents) lisent le HTML et s'arretent
// la. Un barbier dont les tarifs sont la matiere meme du site n'a rien a gagner
// a les cacher derriere une execution.
//
// CE FICHIER EST UN SECOND RENDU, ET C'EST ASSUME
//
// Il refait ce que `peindrePrestations()` fait dans la page. On ne peut pas
// partager le code : le site est un seul fichier HTML autonome, sans etape de
// construction, et son JavaScript vit dans le navigateur.
//
// Trois choses rendent cette duplication tenable :
//   - le balisage produit est RIGOUREUSEMENT le meme, donc la reprise en main
//     par la page ne provoque aucun changement visible ;
//   - la page reecrit de toute facon cette section au chargement : une
//     divergence se corrigerait d'elle-meme a l'ecran, elle ne casserait rien ;
//   - un test verifie que CHAQUE prestation proposee, avec son tarif, figure
//     dans la page servie. C'est le filet : le jour ou quelqu'un ajoute un champ
//     ici sans le reporter la-bas, ou l'inverse, la suite le dit.
//
// >>> EN CAS DE MODIFICATION DE `peindrePrestations()` DANS
//     src/page/js/04-contenu-statique.js, REPORTER LE CHANGEMENT ICI. Un
//     commentaire le rappelle des deux cotes. <<<
//
// LA FORME : UNE LISTE TARIFAIRE, PAS UNE GRILLE DE CARTES.
//
// Intitule a gauche, duree et prix en chasse fixe a droite, un filet entre
// chaque ligne. Ce n'est pas qu'une question de gout : une carte a besoin d'une
// ombre ou d'un rayon pour exister, et la charte n'autorise ni l'une ni l'autre.
// Alignes en colonnes, treize tarifs se comparent d'un coup d'oeil ; en cartes,
// il faut les lire un par un.
//
// L'EQUIPE N'EST PAS INJECTEE ICI, et c'est un choix chiffre : les portraits
// sont des images ecrites en base (`data:image/jpeg;base64,…`, une vingtaine de
// kilo-octets chacun) et ils voyagent DEJA dans la reponse de /api/config, dont
// la page a besoin pour le choix « avec qui ? ». Les ecrire aussi dans le HTML
// les enverrait deux fois a chaque visite — du base64, que la compression ne
// reprend pas — pour faire gagner trois prenoms a un moteur de recherche.
// ---------------------------------------------------------------------------

/** Texte pose entre deux balises ou dans un attribut. Meme regle que `esc()` de la page. */
function esc(valeur) {
  return String(valeur ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** "18 €", "22,50 €" — la meme ecriture que `fmtPrix()` dans la page. */
function fmtPrix(n) {
  return (Number.isInteger(n) ? String(n) : n.toFixed(2).replace('.', ',')) + ' €';
}

/** "25 min", "1h", "1h30" — la meme ecriture que `fmtDuree()` dans la page. */
function fmtDuree(min) {
  if (min < 60) return `${min} min`;
  return min % 60 === 0 ? `${min / 60}h` : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`;
}

/**
 * Le catalogue range par rayon : `[{cat, services}]`.
 *
 * Un rayon sans prestation a montrer est omis, et les prestations dont le rayon
 * n'existe pas forment un dernier groupe. Un commerce SANS rayon du tout donne
 * un groupe unique sans intitule : la liste reste la meme, elle n'a simplement
 * plus de titres intermediaires.
 */
function grouperParRayon(config) {
  const groupes = [];

  for (const cat of config.categories) {
    const dedans = config.services.filter((s) => s.category === cat.id);
    if (dedans.length) groupes.push({ cat, services: dedans });
  }

  const orphelines = config.services.filter(
    (s) => !config.categories.some((c) => c.id === s.category)
  );

  if (orphelines.length) {
    // Sans aucun rayon defini, ce groupe est le seul : lui donner le titre
    // « Autres prestations » n'aurait aucun sens, il n'y a rien d'autre.
    groupes.push({ cat: null, services: orphelines, seul: groupes.length === 0 });
  }

  return groupes;
}

/**
 * Une ligne de prestation.
 *
 * C'est un vrai `<button>` : la ligne entiere est cliquable — 56 px de haut,
 * toute la largeur, ce qui compte quand on vise au pouce — et il n'y a qu'un
 * seul element a atteindre au clavier.
 *
 * AUCUN `aria-label` ICI, ET C'EST UNE CORRECTION.
 *
 * Il y en avait un — « Réserver Coupe homme — 25 min, 18 € » — pose pour eviter
 * de faire lire la description avant le tarif. Il violait le critere WCAG 2.5.3
 * (« Label in Name ») : un nom accessible doit CONTENIR le texte visible, et
 * celui-ci omettait la description. Consequence concrete, et c'est elle qui
 * compte : quelqu'un qui pilote le site a la voix dit « cliquer sur Coupe homme
 * aux ciseaux » et rien ne se passe, parce que ce n'est pas le nom que le
 * navigateur connait.
 *
 * Sans attribut, le bouton s'annonce par son contenu, qui est deja dans le bon
 * ordre : nom, description, duree, tarif.
 *
 * Les attributs `data-choix`, `data-prix-euros` et `data-duree-minutes` sont le
 * repli lisible par n'importe quel agent, celui qui ne depend d'aucune
 * specification. Les poser ici les rend lisibles SANS executer le JavaScript,
 * ce qui est precisement l'objet de ce fichier.
 */
function ligne(s) {
  return '<li><button type="button" class="tarif-ligne"'
    + ` data-id="${esc(s.id)}" data-choix="prestation"`
    + ` data-prix-euros="${esc(s.price)}" data-duree-minutes="${esc(s.duration)}">`
    + '<span class="tarif-texte">'
      + `<span class="tarif-nom">${esc(s.name)}</span>`
      + (s.desc ? `<span class="tarif-desc">${esc(s.desc)}</span>` : '')
    + '</span>'
    + '<span class="tarif-donnees donnee">'
      + `<span class="tarif-duree">${fmtDuree(s.duration)}</span>`
      + `<span class="tarif-prix">${fmtPrix(s.price)}</span>`
    + '</span>'
    + '</button></li>';
}

/** Un rayon : son intitule, sa phrase, ses lignes. */
function rayon(g) {
  const ancre = 'rayon-' + (g.cat ? g.cat.id : 'autres');

  const entete = g.cat && !g.seul
    ? `<h3 class="tarif-rayon-titre etiquette">${esc(g.cat.name)}</h3>`
      + (g.cat.desc ? `<p class="tarif-rayon-desc">${esc(g.cat.desc)}</p>` : '')
    : '';

  return `<section class="tarif-rayon" id="${esc(ancre)}">`
    + entete
    + `<ul class="tarif-liste">${g.services.map(ligne).join('')}</ul>`
    + '</section>';
}

/**
 * Toute la section « Prestations », telle qu'elle part dans la page.
 *
 * `config` vient de `loadConfig({ includeInactive: false })` : les prestations
 * en pause en sont deja absentes, exactement comme sur la vitrine.
 *
 * Renvoie `null` quand il n'y a rien a montrer — la page garde alors son
 * conteneur vide et son contenu de secours.
 */
export function sectionPrestations(config) {
  if (!config.services.length) return null;

  return grouperParRayon(config).map(rayon).join('');
}
