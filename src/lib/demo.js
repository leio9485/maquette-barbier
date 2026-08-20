// ---------------------------------------------------------------------------
// LE MODE DEMONSTRATION
//
// Une instance de vitrine, ouverte a tous, destinee a etre montree a un
// commercant pour qu'il se projette. Elle n'existe que si DEMO_MODE=true : chez
// un vrai client, rien de ce fichier ne s'execute.
//
// Trois choses en decoulent.
//
//   1. Un compte d'acces est cree tout seul, et ses identifiants sont AFFICHES
//      sur l'ecran de connexion. Sans cela, le visiteur voit la vitrine, reserve
//      un rendez-vous... et ne decouvre jamais l'agenda ni les reglages, c'est-a-
//      dire precisement ce qu'on lui vend.
//
//   2. Tout est remis a zero chaque nuit. Ce n'est pas un detail de proprete :
//      les rendez-vous de demonstration sont poses par rapport au jour ou ils
//      sont crees. Sans remise a zero, ils glissent dans le passe et, une
//      semaine plus tard, le prospect ouvre un agenda vide. La remise a zero les
//      replace sur la semaine en cours, et efface au passage ce que les
//      visiteurs precedents ont saisi.
//
//   3. Comme la base se reconstruit toute seule, elle n'a pas besoin de
//      survivre a un redemarrage : la demonstration peut donc tourner sur un
//      hebergement gratuit, sans disque persistant.
// ---------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';

import { prisma } from '../db.js';
import { tirerReference } from './reference.js';
import { DEFAULT_CONFIG } from './defaults.js';
import { normalizeConfig, validateConfig, saveConfig } from './settings.js';
import { hashPassword } from './passwords.js';
import { toMin } from './time.js';

/**
 * Identifiants montres au visiteur.
 *
 * Ils n'ont rien de secret — c'est tout l'objet. Ce compte n'ouvre qu'une base
 * de demonstration reconstruite chaque nuit ; il n'existe pas chez un client.
 */
export const DEMO_USERNAME = 'demo';
export const DEMO_PASSWORD = 'demonstration';

/** Heure de la remise a zero quotidienne (le salon dort, personne ne regarde). */
const HEURE_REMISE_A_ZERO = 4;

/**
 * L'equipe de la vitrine.
 *
 * Chez Studio Cassandre, elle etait definie ICI et non dans defaults.js : un
 * vrai client demarrait seul, la demonstration seule montrait une equipe.
 *
 * Ce commerce-ci a trois barbiers dans ses valeurs d'origine — la gestion
 * multi-agenda fait partie de ce qu'on vend, elle ne peut pas dependre d'un
 * mode. On reprend donc simplement l'equipe de defaults.js, pour qu'il n'y ait
 * qu'un seul endroit ou la modifier. Les rendez-vous d'exemple plus bas se
 * referent a ses identifiants.
 *
 * Pour une demonstration a une seule personne : vider `staff` dans defaults.js.
 */
const EQUIPE_DEMO = DEFAULT_CONFIG.staff;

/** Date au format AAAA-MM-JJ, en heure locale. */
function isoDate(date) {
  const an = date.getFullYear();
  const mois = String(date.getMonth() + 1).padStart(2, '0');
  const jour = String(date.getDate()).padStart(2, '0');
  return `${an}-${mois}-${jour}`;
}

// ---------------------------------------------------------------------------
// LA GRAINE DE DEMONSTRATION
//
// >>> ELLE PLAIDAIT CONTRE LE PRODUIT. <<<
//
// Le volet « Chiffres » est, sur le fond, le meilleur argument commercial du
// site : du temps rempli compte en minutes sur le temps reellement ouvert
// (conges deduits), des prestations classees par ce qu'elles rapportent, des
// heures creuses sur huit semaines, des nouveaux clients distingues des
// habitues par leur numero. De la gestion, pas de la statistique decorative.
//
// Voici pourtant ce qu'un prospect y lisait :
//
//     Rendez-vous cette semaine      4
//     Chiffre d'affaires prevu       89 €
//     Temps rempli                   2 %
//     Ecart avec le mois dernier     —
//     Mois dernier                   0 rendez-vous · 0 €
//     Heures les plus creuses        mardi 09:00 · aucun  (×5)
//     Clientele                      Nouveaux 100 % · Deja venus 0 %
//     Absences                       Taux —
//
// Quatre-vingt-neuf euros de chiffre d'affaires hebdomadaire POUR TROIS
// BARBIERS. Un commercant qui regarde cet ecran voit un salon a l'agonie, pas
// un outil qui va l'aider. Le tableau de bord disait « ce salon ne marche pas »
// la ou il devait dire « voila ce que je vais vous montrer sur VOTRE activite ».
//
// La graine couvre donc huit semaines glissantes plus le mois en cours, avec
// des habitues qui reviennent, des absences pointees, une semaine de conges
// passee, et un vrai creux le mardi matin.
//
// ⚠️ TOUT EST RELATIF AU JOUR OU ELLE EST JOUEE. Aucune date en dur : elle sera
//    rejouee dans six mois, et un agenda qui parle d'aout 2026 en fevrier 2027
//    est pire qu'un agenda vide.
//
// ⚠️ ELLE EST REPRODUCTIBLE. Le tirage part d'une graine fixe : deux appels
//    successifs le meme jour donnent EXACTEMENT la meme demonstration. Ce n'est
//    pas un raffinement — c'est ce qui permet de promettre que le bouton
//    « Remettre a zero » rend la meme chose que le redemarrage du serveur, et
//    c'est verifie par tests/demonstration.mjs.
// ---------------------------------------------------------------------------

/** Sur combien de semaines la graine remonte. Le tableau de bord en lit huit. */
const SEMAINES_PASSEES = 8;

/**
 * Le tirage : reproductible, et bon marche.
 *
 * `Math.random()` donnerait une demonstration differente a chaque appel, ce qui
 * rendrait invérifiable la promesse « le bouton fait la meme chose que le
 * redemarrage ». Ce generateur (mulberry32) tient en six lignes, ne depend de
 * rien, et rend toujours la meme suite pour la meme graine.
 */
function tirage(graine) {
  let etat = graine >>> 0;
  return function suivant() {
    etat = (etat + 0x6D2B79F5) >>> 0;
    let t = etat;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- LA CLIENTELE ----------------------------------------------------------
//
// >>> ELLE EST ENGENDREE, ET NON ECRITE A LA MAIN. <<<
//
// Onze semaines de trois barbiers font environ mille sept cents visites. Une
// liste ecrite a la main en aurait compte une vingtaine, et le meme monsieur
// serait passe cinquante fois en deux mois — trois fois dans la meme journee.
// L'agenda, qui est le premier ecran qu'un prospect ouvre, aurait montre un
// carnet de rendez-vous impossible.
//
// Quarante prenoms croises avec quarante-cinq noms du Nord donnent mille huit
// cents personnes distinctes en vingt lignes de code. Chacune garde le meme
// numero d'une visite a l'autre — c'est ce numero, et lui seul, qui distingue
// un nouveau client d'un habitue (voir src/lib/statistiques.js).

const PRENOMS = [
  'Damien', 'Anthony', 'Bruno', 'Sébastien', 'Ludovic', 'Jordan', 'Mickaël',
  'Olivier', 'Pascal', 'Fabrice', 'Kévin', 'Thierry', 'Nicolas', 'Julien',
  'Grégory', 'Adrien', 'Romain', 'Cédric', 'Maxime', 'Guillaume', 'Alexandre',
  'Benoît', 'Étienne', 'Florian', 'Hugo', 'Loïc', 'Mathieu', 'Quentin',
  'Sylvain', 'Vincent', 'Yannick', 'Christophe', 'Frédéric', 'Jérôme',
  'Laurent', 'Marc', 'Patrick', 'Stéphane', 'Xavier', 'Antoine',
];

const NOMS = [
  'Carpentier', 'Vasseur', 'Leclercq', 'Mahieu', 'Wattiez', 'Delattre',
  'Dhaine', 'Fontaine', 'Dhennin', 'Leroy', 'Legrand', 'Bouchez', 'Wauquier',
  'Delcourt', 'Masclet', 'Deloffre', 'Lheureux', 'Vanhove', 'Descamps',
  'Petit', 'Ruffin', 'Cardon', 'Duhamel', 'Béghin', 'Trélat', 'Bracq',
  'Wallers', 'Sauvage', 'Poteau', 'Lemaire', 'Dubois', 'Caudron', 'Hennion',
  'Lecomte', 'Framery', 'Delsart', 'Bouquet', 'Moreau', 'Danjou', 'Vermeersch',
  'Lespagnol', 'Herbaut', 'Coulon', 'Mairesse', 'Bocquet',
];

/**
 * Combien de personnes reviennent regulierement.
 *
 * ⚠️ CE NOMBRE DECIDE DU RYTHME DE RETOUR, et donc de la credibilite de
 *    l'agenda. Trop peu, et le meme client repasse toutes les semaines ; trop,
 *    et plus personne n'est un habitue — la ligne « Deja venus » retombe a zero,
 *    ce qui etait le defaut constate. A trois cents, chacun revient toutes les
 *    trois semaines environ : le rythme d'un barbier.
 */
const NOMBRE_HABITUES = 300;

/** Ou commencent les clients qu'on ne voit qu'une fois. */
const PREMIER_DE_PASSAGE = NOMBRE_HABITUES;
const NOMBRE_DE_PASSAGE = 700;

/**
 * Ou commencent les clients qui n'apparaissent QUE dans le mois en cours.
 *
 * ⚠️ SANS EUX, « NOUVEAUX CLIENTS » AFFICHE ZERO. Le tableau de bord compare
 *    les numeros du mois a TOUT ce que la base contient avant lui : une graine
 *    qui tire ses clients dans un seul sac fait de chacun un habitue, et la
 *    ligne se lit « Nouveaux 0 % · Deja venus 100 % » — l'inverse exact du
 *    defaut d'origine, tout aussi faux, et tout aussi visible.
 */
const PREMIER_NOUVEAU = PREMIER_DE_PASSAGE + NOMBRE_DE_PASSAGE;
const NOMBRE_NOUVEAUX = 60;

/**
 * Le brouillage des quatre derniers chiffres — lot F, point F2.
 *
 * >>> LES NUMEROS SE SUIVAIENT, ET CA SE VOYAIT DANS L'AGENDA. <<< Constate
 * sur l'instance en ligne : `06 39 98 00 29`, `06 39 98 00 63`,
 * `06 39 98 00 83`, `07 39 98 01 18`… Quatre lignes d'affilee suffisent a
 * comprendre que les clients sont engendres, et un prospect qui le remarque en
 * deduit que TOUT est faux — y compris les chiffres du tableau de bord, qui
 * sont pourtant justes et recalculables.
 *
 * Un multiplicateur premier avec 10 000 fait une BIJECTION de 0..9999 sur
 * lui-meme : chaque rang garde donc un numero qui n'appartient qu'a lui. C'est
 * indispensable et pas decoratif — deux clients qui partageraient un numero
 * n'en feraient qu'un seul dans l'export « clients » et dans le partage
 * « nouveaux / deja venus » du tableau de bord, qui regroupent par telephone.
 */
const BROUILLAGE = 4177;   // premier avec 10 000
const DECALAGE = 3391;

/**
 * Une personne, designee par son rang.
 *
 * ⚠️ LES NUMEROS RESTENT DANS LA PLAGE RESERVEE A LA FICTION
 *    (06/07 39 98 XX XX) : une demonstration ne fait sonner le telephone de
 *    personne. C'est la plage de l'ARCEP pour le cinema et la television, et
 *    le brouillage ci-dessus ne touche QUE les quatre derniers chiffres — il
 *    ne peut donc pas en faire sortir.
 *
 * ⚠️ LE PREFIXE NE S'ALTERNE PLUS. Un 06 sur deux, c'etait le second signe
 *    qu'une machine avait ecrit la liste. Il se tire du numero brouille, ce
 *    qui melange les deux sans jamais rendre deux rangs identiques : les
 *    quatre derniers chiffres suffisent deja a les distinguer.
 */
function personneDeRang(rang) {
  const nom = `${PRENOMS[rang % PRENOMS.length]} ${NOMS[Math.floor(rang / PRENOMS.length) % NOMS.length]}`;

  const melange = (rang * BROUILLAGE + DECALAGE) % 10000;

  // Le prefixe se tire d'un melange NON LINEAIRE du numero : toute fonction
  // simple d'une suite arithmetique reste une suite arithmetique, et on
  // retomberait sur un motif regulier — c'est-a-dire sur le defaut qu'on
  // repare. Un decalage et deux « ou exclusif » suffisent a le casser.
  const brouille = melange ^ (melange >> 3) ^ (melange << 2);
  const prefixe = brouille & 1 ? '07' : '06';
  const ab = String(Math.floor(melange / 100)).padStart(2, '0');
  const cd = String(melange % 100).padStart(2, '0');

  return [nom, `${prefixe} 39 98 ${ab} ${cd}`];
}

/**
 * Ce que les gens prennent, et a quelle frequence.
 *
 * Les poids ne sont pas decoratifs : ils decident de ce que montre le classement
 * « prestations par chiffre d'affaires », qui est l'un des blocs qu'on commente
 * devant un prospect. Une coupe homme toutes les trois visites, un forfait de
 * temps en temps, un soin rarement — c'est la forme d'un carnet de barbier.
 */
const FREQUENCES = [
  ['coupe-homme', 30],
  ['coupe-tondeuse', 14],
  ['coupe-barbe', 13],
  ['barbe-taille', 10],
  ['coupe-shampooing', 8],
  ['contours', 7],
  ['barbe-serviette', 5],
  ['coupe-enfant', 5],
  ['rasage-coupe-chou', 4],
  ['coupe-rasage', 2],
  ['pere-fils', 2],
  ['coloration-barbe', 2],
  ['soin-visage', 1],
];

/** Le tarif et la duree d'une prestation, lus dans les valeurs livrees. */
const PRESTATION = new Map(DEFAULT_CONFIG.services.map((s) => [s.id, s]));

/**
 * Qui peut assurer quoi.
 *
 * La regle du produit se lit depuis la prestation : une prestation que personne
 * ne coche revient a TOUTE l'equipe ; des qu'une seule personne la coche, elle
 * n'est plus qu'a elle. La graine doit la respecter, sans quoi l'agenda
 * montrerait Yanis en train de faire un rasage au coupe-chou alors que les
 * reglages, deux onglets plus loin, disent que c'est reserve a Remi.
 */
const ASSUREE_PAR = new Map();
for (const service of DEFAULT_CONFIG.services) {
  const reserves = DEFAULT_CONFIG.staff.filter((p) => (p.services ?? []).includes(service.id));
  ASSUREE_PAR.set(service.id, reserves.length ? reserves.map((p) => p.id) : null);
}

/** Les horaires propres a une personne, quand elle en a. */
const HORAIRES_PROPRES = new Map(
  DEFAULT_CONFIG.staff.filter((p) => p.hours).map((p) => [p.id, p.hours])
);

/** Les plages continues travaillees par quelqu'un ce jour-la, en minutes. */
function plagesDe(staffId, dateIso) {
  const jour = new Date(`${dateIso}T12:00:00`).getDay();
  const horaires = (staffId && HORAIRES_PROPRES.get(staffId)) || DEFAULT_CONFIG.hours;
  const h = horaires[jour];
  if (!h) return [];

  return h.pause
    ? [[toMin(h.open), toMin(h.pause[0])], [toMin(h.pause[1]), toMin(h.close)]]
    : [[toMin(h.open), toMin(h.close)]];
}

/**
 * Une semaine de conges, DANS LE PASSE.
 *
 * ⚠️ ELLE EST LA POUR ETRE MONTREE. La phrase sous « Temps rempli » promet que
 *    les conges sont deduits du temps a vendre — c'est ce qui evite qu'un taux
 *    s'effondre chaque mois d'aout. Sans une seule periode bloquee dans
 *    l'historique, cette phrase reste une promesse invérifiable.
 *
 * Posee cinq semaines en arriere : assez loin pour etre dans les huit semaines
 * que lit le tableau de bord, assez pres pour tomber dans le mois precedent ou
 * dans le mois en cours selon la date — dans les deux cas, elle se voit.
 */
function congesPasses(depart) {
  const blocs = [];

  const debut = new Date(depart);
  debut.setDate(debut.getDate() - 5 * 7);

  for (let n = 0; n < 7; n++) {
    const jour = new Date(debut);
    jour.setDate(debut.getDate() + n);

    // Les jours de fermeture habituelle ne recoivent rien : c'est exactement ce
    // que fait la route de blocage, et la graine ne doit pas raconter autre
    // chose que le produit.
    const horaire = DEFAULT_CONFIG.hours[jour.getDay()];
    if (!horaire) continue;

    blocs.push({
      kind: 'block',
      date: isoDate(jour),
      startMin: toMin(horaire.open),
      durationMin: toMin(horaire.close) - toMin(horaire.open),
      staffId: null,
      notes: 'Congés',
      source: 'phone',
    });
  }

  return blocs;
}

/**
 * Combien de temps le commerce cherche a remplir, ce jour-la.
 *
 * ⚠️ CE N'EST PAS UNE CONSTANTE, ET C'EST TOUT L'INTERET.
 *
 *   - LES TROIS PROCHAINS JOURS SONT PLUS CREUX. Un prospect qui veut essayer
 *     la reservation depuis la vitrine tombe sur ces jours-la : un agenda plein
 *     a 70 % trois semaines a l'avance est credible, mais il ne laisse plus de
 *     place pour une « coupe + rasage » d'une heure, et la demonstration
 *     buterait sur son propre realisme.
 *   - LE SAMEDI DEBORDE, le mardi traine. C'est la semaine d'un barbier.
 */
function tauxDuJour({ dateIso, joursDIci }) {
  // ⚠️ CE N'EST PAS UN TAUX DE REMPLISSAGE, C'EST UNE PROBABILITE DE POSER a
  //    chaque quart d'heure. Le remplissage qui en resulte est plus eleve : une
  //    prestation dure en moyenne deux quarts d'heure, un refus n'en coute
  //    qu'un. 0,55 donne environ 66 % de temps rempli — mesure, pas estime.
  if (joursDIci > 0 && joursDIci <= 3) return 0.42;

  const jour = new Date(`${dateIso}T12:00:00`).getDay();

  if (jour === 6) return 0.74;  // samedi, le gros jour
  if (jour === 5) return 0.72;  // vendredi, nocturne
  if (jour === 2) return 0.55;  // mardi, le jour creux
  return 0.67;
}

/**
 * Le creux du mardi matin, appuye.
 *
 * >>> LE BLOC « HEURES LES PLUS CREUSES » EST LE PLUS ACTIONNABLE DU TABLEAU DE
 *     BORD, et il affichait cinq fois « aucun ». <<< Un patron ne peut pas
 *     grand-chose de son chiffre d'affaires du mois ; il peut fermer le mardi
 *     matin, decaler son ouverture, ou y poser une promotion. Encore faut-il
 *     que le bloc designe de VRAIES heures creuses plutot que des heures sans
 *     aucune donnee — cinq lignes a zero ne se distinguent pas d'une base vide.
 *
 * Le mardi de 9 h a 11 h recoit donc trois fois moins que le reste : assez pour
 * sortir en tete du classement, jamais zero.
 */
function creuxDeLaSemaine(dateIso, minute) {
  const jour = new Date(`${dateIso}T12:00:00`).getDay();
  if (jour === 2 && minute < 11 * 60) return 0.3;
  // La derniere heure d'une nocturne se remplit mal partout.
  if (jour === 5 && minute >= 20 * 60) return 0.5;
  return 1;
}

/**
 * Des rendez-vous credibles sur huit semaines passees, la semaine en cours, et
 * la fin du mois.
 *
 * Ni trop peu (un agenda desert ne donne pas envie), ni complet (le visiteur
 * doit pouvoir reserver et voir son rendez-vous apparaitre). Un melange de
 * « en ligne » et de « telephone », pour montrer que les deux coexistent.
 */
export function rendezVousDemo({ equipe = [], maintenant = new Date() } = {}) {
  const lignes = [];
  const hasard = tirage(20260817);

  const aujourdhui = isoDate(maintenant);

  // Le dernier jour couvert : la fin du mois en cours. Le taux de remplissage
  // du mois se calcule sur le mois ENTIER, jours a venir compris — s'arreter a
  // aujourd'hui donnerait un mois a moitie vide le 5 du mois.
  //
  // ⚠️ A 23 H 59, ET NON A MINUIT. Le curseur de la boucle garde l'heure de
  //    `maintenant` ; borne a minuit, la comparaison `jour <= finDuMois` etait
  //    fausse des le dernier jour du mois, et ce jour-la ne recevait rien. Une
  //    demonstration remise a zero un 31 affichait alors « Rien de prevu ».
  const finDuMois = new Date(maintenant.getFullYear(), maintenant.getMonth() + 1, 0, 23, 59, 59);

  const debut = new Date(maintenant);
  debut.setDate(debut.getDate() - SEMAINES_PASSEES * 7);

  // Les conges d'abord : les journees qu'ils couvrent ne recoivent aucun
  // rendez-vous, exactement comme dans la realite.
  const blocs = congesPasses(maintenant);
  const joursBloques = new Set(blocs.map((b) => b.date));
  lignes.push(...blocs);

  // Chaque rendez-vous designe la personne qui l'assure — mais seulement si
  // l'equipe existe. Sur une base sans equipe (le cas d'un commerce qui travaille
  // seul), `equipe` est vide et `qui()` renvoie null.
  //
  // Cela compte pour la demonstration : un rendez-vous sans personne occupe
  // TOUT LE MONDE. Les laisser non attribues remplirait l'agenda de bandeaux
  // « bloque toute l'equipe » et donnerait a voir un defaut, pas une fonction.
  const qui = (id) => (equipe.includes(id) ? id : null);

  // L'equipe reellement disponible pour la graine. Sur une base sans equipe, on
  // pose une ressource unique, sans identifiant : c'est le commerce qui
  // travaille seul, et le calcul de disponibilite le lit exactement ainsi.
  const personnes = DEFAULT_CONFIG.staff.filter((p) => equipe.includes(p.id));
  const ressources = personnes.length ? personnes.map((p) => p.id) : [null];

  /** Une prestation tiree au sort, que cette personne-la peut assurer. */
  function prestationPour(staffId, placeRestante) {
    const possibles = FREQUENCES.filter(([id, poids]) => {
      const reserves = ASSUREE_PAR.get(id);
      if (reserves && staffId && !reserves.includes(staffId)) return false;
      return poids > 0 && PRESTATION.get(id).duration <= placeRestante;
    });
    if (!possibles.length) return null;

    const total = possibles.reduce((somme, [, poids]) => somme + poids, 0);
    let seuil = hasard() * total;
    for (const [id, poids] of possibles) {
      seuil -= poids;
      if (seuil <= 0) return PRESTATION.get(id);
    }
    return PRESTATION.get(possibles[0][0]);
  }

  const premierDuMois = `${aujourdhui.slice(0, 7)}-01`;

  /**
   * Le rang de la personne qui vient.
   *
   * Trois sacs, et les trois comptent pour ce que le tableau de bord affiche :
   *
   *   - LES HABITUES, deux visites sur trois. Ils reviennent toutes les trois
   *     semaines environ, et font la ligne « Deja venus » ;
   *   - LES CLIENTS DE PASSAGE, le reste de l'historique ;
   *   - LES NOUVEAUX DU MOIS, tires seulement a partir du premier du mois et
   *     jamais avant. Sans eux, tout le monde a deja un antecedent en base et
   *     la clientele s'affiche « Nouveaux 0 % ».
   */
  function rangDuClient(dateIso) {
    if (dateIso >= premierDuMois && hasard() < 0.05) {
      return PREMIER_NOUVEAU + Math.floor(hasard() * NOMBRE_NOUVEAUX);
    }
    if (hasard() < 0.66) return Math.floor(hasard() * NOMBRE_HABITUES);
    return PREMIER_DE_PASSAGE + Math.floor(hasard() * NOMBRE_DE_PASSAGE);
  }

  for (const jour = new Date(debut); jour <= finDuMois; jour.setDate(jour.getDate() + 1)) {
    const dateIso = isoDate(jour);
    if (!DEFAULT_CONFIG.hours[jour.getDay()]) continue;
    if (joursBloques.has(dateIso)) continue;

    const joursDIci = Math.round(
      (new Date(`${dateIso}T12:00:00`) - new Date(`${aujourdhui}T12:00:00`)) / 86400000
    );
    const taux = tauxDuJour({ dateIso, joursDIci });

    // Personne ne passe deux fois chez le barbier le meme jour. Sans ce
    // garde-fou, le tirage produisait deux ou trois doublons par journee — et
    // c'est le genre de detail qu'un prospect remarque tout de suite en
    // parcourant l'agenda, parce que c'est la premiere chose qu'il y lit.
    const dejaVenusAujourdhui = new Set();

    for (const staffId of ressources) {
      for (const [ouverture, fermeture] of plagesDe(staffId, dateIso)) {
        let curseur = ouverture;

        while (curseur + 10 <= fermeture) {
          const chance = taux * creuxDeLaSemaine(dateIso, curseur);

          // Le pas de quinze minutes est celui du commerce : un agenda dont les
          // rendez-vous tombent a 09:07 se lit comme un agenda faux.
          if (hasard() > chance) { curseur += 15; continue; }

          const prestation = prestationPour(staffId, fermeture - curseur);
          if (!prestation) { curseur += 15; continue; }

          let rang = rangDuClient(dateIso);
          for (let essai = 0; essai < 5 && dejaVenusAujourdhui.has(rang); essai++) {
            rang = rangDuClient(dateIso);
          }
          dejaVenusAujourdhui.add(rang);

          const [nom, telephone] = personneDeRang(rang);

          lignes.push({
            date: dateIso,
            startMin: curseur,
            durationMin: prestation.duration,
            serviceId: prestation.id,
            staffId: qui(staffId),
            customerName: nom,
            customerPhone: telephone,
            // Deux sur trois pris en ligne : c'est ce qu'on vend, et le reste
            // montre que le telephone continue d'exister.
            source: hasard() < 0.66 ? 'online' : 'phone',
            ...pointage({ dateIso, aujourdhui, hasard }),
          });

          // ⚠️ LE CURSEUR REVIENT SUR LA GRILLE DU QUART D'HEURE, TOUJOURS.
          //
          // Il avancait de la duree exacte, plus un « souffle » de cinq minutes
          // une fois sur deux. Deux consequences, toutes deux visibles :
          //
          //   - des rendez-vous a 09:05 et 14:35, alors que le commerce propose
          //     ses creneaux au quart d'heure (`slotStep`). Un agenda dont les
          //     heures ne tombent pas sur la grille se lit comme un agenda faux ;
          //   - des trous de CINQ MINUTES entre deux clients. Le taux de
          //     remplissage etait juste, et pourtant il ne restait plus une
          //     seule place vendable : un samedi affichait 74 % de temps rempli
          //     et zero creneau libre pour une coupe. La demonstration butait
          //     sur son propre realisme.
          //
          // Sur la grille, ce qui reste libre est reservable.
          curseur = Math.ceil((curseur + prestation.duration) / 15) * 15;
        }
      }
    }
  }

  return lignes;
}

/**
 * « Pas venu », ou rien — et « rien » veut dire venu.
 *
 * ⚠️ ON NE POSE PLUS QUE LES ABSENCES. « Venu » est l'etat par defaut : le
 *    laisser implicite est exactement ce que fait le commercant a l'ecran, et
 *    des donnees de demonstration qui ecriraient `presence: 'venu'` partout
 *    montreraient un usage que personne n'a. La regle est en tete de
 *    `absences()`, src/lib/statistiques.js.
 *
 *    L'ancien tirage laissait 18 % des rendez-vous passes « pas encore
 *    pointes », parce que le taux d'absence se calculait alors sur ce qui avait
 *    ete pointe et qu'un agenda entierement pointe aurait fait mentir la phrase
 *    qui l'expliquait. Ce garde-fou n'a plus d'objet : le denominateur est tout
 *    ce qui est passe.
 *
 * Une visite sur douze finit en absence : credible pour un barbier sans acompte
 * ni carte bancaire — et c'est justement l'argument de vente du produit, donc
 * le chiffre qu'un prospect regarde.
 */
function pointage({ dateIso, aujourdhui, hasard }) {
  if (dateIso >= aujourdhui) return {};

  return hasard() < 0.085 ? { presence: 'absent' } : {};
}

/**
 * Cree le compte de demonstration, ou lui remet son mot de passe connu.
 *
 * La remise du mot de passe compte autant que la creation : un visiteur peut
 * avoir essaye d'en changer, et le compte doit rester ouvert au suivant.
 */
export async function ensureDemoAccount() {
  const empreinte = await hashPassword(DEMO_PASSWORD);
  await prisma.adminUser.upsert({
    where: { username: DEMO_USERNAME },
    create: { username: DEMO_USERNAME, passwordHash: empreinte },
    update: { passwordHash: empreinte },
  });
}

/**
 * Remet la demonstration dans son etat de depart : reglages d'origine, agenda
 * repeuple sur la semaine en cours, saisies des visiteurs effacees.
 */
export async function resetDemo() {
  // La vitrine, c'est les valeurs du client PLUS son equipe : voir EQUIPE_DEMO.
  const config = normalizeConfig({ ...DEFAULT_CONFIG, staff: EQUIPE_DEMO });

  const probleme = validateConfig(config);
  if (probleme) throw new Error(`Valeurs de demonstration invalides : ${probleme.message}`);

  await saveConfig(config);
  await prisma.booking.deleteMany({});

  // L'equipe vient d'etre ecrite : les rendez-vous peuvent s'y referer, et
  // porter le tarif convenu, comme le ferait une vraie reservation.
  const prestations = await prisma.service.findMany();
  const tarif = (serviceId) => prestations.find((p) => p.id === serviceId)?.priceCents ?? null;

  // Les rendez-vous « pris en ligne » recoivent leur reference et leur jeton,
  // comme s'ils venaient du tunnel. Sans eux, le prospect a qui l'on montre la
  // page d'annulation n'aurait aucun rendez-vous a y essayer : il faudrait en
  // reserver un devant lui, ce qui prend le temps qu'on n'a pas en rendez-vous
  // commercial. La table vient d'etre videe, un simple ensemble suffit donc a
  // garantir l'unicite.
  const referencesPrises = new Set();
  const referenceNeuve = () => {
    let candidate = tirerReference();
    while (referencesPrises.has(candidate)) candidate = tirerReference();
    referencesPrises.add(candidate);
    return candidate;
  };

  // ⚠️ LA GRAINE REND AUSSI DES BLOCAGES — une semaine de conges passee, qui
  //    fait la demonstration de la phrase « les congés sont déduits du temps à
  //    remplir ». Ils n'ont ni tarif, ni reference, ni jeton : ce ne sont pas
  //    des rendez-vous, et leur en donner ferait apparaitre des references
  //    annulables sur des journees fermees.
  const lignes = rendezVousDemo({ equipe: config.staff.map((p) => p.id) })
    .map((r) => (r.kind === 'block' ? r : {
      ...r,
      priceCents: tarif(r.serviceId),
      ...(r.source === 'online'
        ? { reference: referenceNeuve(), cancelToken: randomBytes(32).toString('base64url') }
        : {}),
    }));

  await prisma.booking.createMany({ data: lignes });
  await ensureDemoAccount();
}

/**
 * Programme la remise a zero de cette nuit, puis de toutes les suivantes.
 *
 * `setTimeout` plutot qu'un intervalle de 24 h : un serveur redemarre a
 * n'importe quelle heure resterait sinon decale pour toujours.
 */
export function scheduleDemoReset() {
  const maintenant = new Date();
  const prochaine = new Date(maintenant);
  prochaine.setHours(HEURE_REMISE_A_ZERO, 0, 0, 0);
  if (prochaine <= maintenant) prochaine.setDate(prochaine.getDate() + 1);

  const attente = prochaine.getTime() - maintenant.getTime();

  const minuterie = setTimeout(async () => {
    try {
      await resetDemo();
      console.log(`[demo] Remise a zero effectuee (${new Date().toISOString()}).`);
    } catch (erreur) {
      console.error('[demo] Remise a zero impossible :', erreur.message);
    }
    scheduleDemoReset();
  }, attente);

  // Ne pas retenir le processus en vie pour cette seule minuterie.
  minuterie.unref?.();

  const heures = Math.round(attente / 3600000);
  console.log(`[demo] Prochaine remise a zero dans ~${heures} h.`);
}

/**
 * Preparation au demarrage.
 *
 * La base est reconstruite si elle est vide — cas normal sur un hebergement
 * sans disque persistant, ou chaque redemarrage repart de zero.
 */
export async function startDemo() {
  const reglages = await prisma.settings.findUnique({ where: { id: 1 } });

  if (!reglages) {
    await resetDemo();
    console.log('[demo] Base de demonstration construite.');
  } else {
    await ensureDemoAccount();
  }

  console.log(`[demo] Espace salon ouvert a tous : ${DEMO_USERNAME} / ${DEMO_PASSWORD}`);
  scheduleDemoReset();
}
