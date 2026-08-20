// ---------------------------------------------------------------------------
// LES CHIFFRES DU COMMERCE
//
// Ce que le commercant ouvre le lundi matin, et ce qu'un patron qui vient de
// Fresha ou de Planity cherche des la premiere minute. Sans lui, l'espace ne
// contient que ce qu'on y a saisi ; avec lui, il rend quelque chose.
//
// TROIS REGLES ONT GOUVERNE CE FICHIER.
//
// 1. TOUT SE CALCULE ICI, RIEN DANS LE NAVIGATEUR. Un chiffre d'affaires
//    recalcule cote page a partir d'une liste de rendez-vous divergerait du
//    jour ou l'un des deux oublierait d'ecarter les annulations. Le serveur
//    renvoie des nombres finis ; la page les affiche.
//
// 2. UNE PERIODE VIDE VAUT ZERO, JAMAIS `NaN` NI `undefined`. Un commerce qui
//    ouvre, une semaine de conges, un lundi matin : les divisions par zero sont
//    partout dans un tableau de bord. Chacune est ecrite avec son garde-fou.
//
// 3. LE TAUX DE REMPLISSAGE SE COMPTE EN MINUTES, PAS EN CRENEAUX. Un rasage de
//    quarante minutes et une coupe a la tondeuse de quinze n'occupent pas la
//    meme chose ; les compter tous deux pour « un creneau » donnerait un taux
//    qui monte quand le barbier fait des prestations courtes. Le denominateur
//    est le temps reellement ouvert, personne par personne — donc trois
//    barbiers ouverts huit heures font vingt-quatre heures a remplir, ce qui
//    est la seule lecture juste.
// ---------------------------------------------------------------------------

import { prisma } from '../db.js';
import { OCCUPENT } from './annulation.js';
import { todayIso, addDaysIso, weekdayOf } from './time.js';
import {
  loadOpeningHours,
  loadStaff,
  plagesDe,
  plagesTravaillees,
} from './availability.js';

/** Sur combien de semaines on cherche les heures creuses. */
const RECUL_SEMAINES = 8;

// --- Petits outils ---------------------------------------------------------

/** Une division qui ne renvoie jamais NaN ni Infinity. */
function part(numerateur, denominateur) {
  if (!denominateur) return 0;
  return numerateur / denominateur;
}

/** Un pourcentage entier, borne, et sans surprise sur une periode vide. */
function pourcent(numerateur, denominateur) {
  return Math.round(part(numerateur, denominateur) * 100);
}

/**
 * Le numero de telephone, ramene a ses chiffres.
 *
 * « 06 39 98 14 07 », « 0639981407 » et « +33 6 39 98 14 07 » designent la meme
 * personne. Sans cette normalisation, le meme client compterait trois fois dans
 * « nouveaux clients » selon la facon dont il a tape son numero — et le suivi
 * des absences ne verrait jamais deux absences du meme.
 *
 * Le prefixe international est ramene au 0 national : +33 6 ... et 06 ... sont
 * le meme numero, et un client qui reserve depuis l'etranger ne doit pas
 * devenir quelqu'un d'autre.
 */
export function clePhone(telephone) {
  if (typeof telephone !== 'string') return '';
  let chiffres = telephone.replace(/\D/g, '');
  if (chiffres.startsWith('33') && chiffres.length === 11) chiffres = '0' + chiffres.slice(2);
  return chiffres;
}

/** Les rendez-vous clients d'une periode : ni blocages, ni annulations. */
function ouSontLesRendezVous(du, au) {
  return { kind: 'appt', date: { gte: du, lte: au }, ...OCCUPENT };
}

/** Le tarif convenu d'un rendez-vous, en centimes. */
function tarifDe(rdv, prestations) {
  if (rdv.priceCents !== null && rdv.priceCents !== undefined) return rdv.priceCents;
  return prestations.find((p) => p.id === rdv.serviceId)?.priceCents ?? 0;
}

// --- Le temps ouvert -------------------------------------------------------

/**
 * Combien de minutes le commerce a-t-il eu a vendre, entre ces deux dates ?
 *
 * Le denominateur du taux de remplissage. Trois choses y entrent, et les trois
 * comptent :
 *
 *   - les horaires du commerce, pause du midi deduite ;
 *   - LES HORAIRES PROPRES DE CHAQUE PERSONNE. Quelqu'un qui ne travaille que
 *     trois jours n'ajoute que trois jours au temps a remplir, sans quoi le
 *     taux d'un commerce a temps partiel serait faux de moitie ;
 *   - LES BLOCAGES. Une semaine de conges ne se compte pas comme du temps
 *     invendu : le commerce etait ferme, il n'avait rien a vendre. C'est ce
 *     qui evite qu'un taux de remplissage s'effondre chaque mois d'aout.
 *
 * Un commerce sans equipe enregistree compte pour UNE ressource : c'est
 * exactement la regle du reste du projet (voir src/lib/availability.js).
 */
function minutesOuvertes({ du, au, horaires, equipe, blocages }) {
  const parJour = new Map();
  for (const b of blocages) {
    if (!parJour.has(b.date)) parJour.set(b.date, []);
    parJour.get(b.date).push(b);
  }

  let total = 0;

  for (let date = du; date <= au; date = addDaysIso(date, 1)) {
    const jour = horaires[weekdayOf(date)];
    if (!jour) continue;

    const blocagesDuJour = parJour.get(date) ?? [];
    const bloquePourTous = blocagesDuJour.some((b) => !b.staffId);
    if (bloquePourTous) continue;

    const duree = (plages) => plages.reduce((somme, [debut, fin]) => somme + (fin - debut), 0);

    if (!equipe.length) {
      total += duree(plagesDe(jour));
      continue;
    }

    for (const personne of equipe) {
      const absente = blocagesDuJour.some((b) => b.staffId === personne.id);
      if (absente) continue;
      total += duree(plagesTravaillees(personne, jour));
    }
  }

  return total;
}

// --- Une periode -----------------------------------------------------------

/**
 * Le bloc de chiffres d'une periode : combien de rendez-vous, combien
 * d'argent, quelle part du temps ouvert.
 */
async function periode({ du, au, horaires, equipe, prestations }) {
  const [rendezVous, blocages] = await Promise.all([
    prisma.booking.findMany({ where: ouSontLesRendezVous(du, au) }),
    prisma.booking.findMany({ where: { kind: 'block', date: { gte: du, lte: au }, ...OCCUPENT } }),
  ]);

  const caCents = rendezVous.reduce((somme, r) => somme + tarifDe(r, prestations), 0);
  const minutesPrises = rendezVous.reduce((somme, r) => somme + r.durationMin, 0);
  const minutesAVendre = minutesOuvertes({ du, au, horaires, equipe, blocages });

  return {
    du,
    au,
    rendezVous: rendezVous.length,
    caCents,
    minutesPrises,
    minutesOuvertes: minutesAVendre,
    remplissage: pourcent(minutesPrises, minutesAVendre),
  };
}

/** Le lundi de la semaine qui contient cette date. */
function lundiDe(iso) {
  const jour = weekdayOf(iso);
  const recul = (jour + 6) % 7; // lundi = 0
  return addDaysIso(iso, -recul);
}

/** Le premier et le dernier jour du mois qui contient cette date. */
function bornesDuMois(iso) {
  const [annee, mois] = iso.split('-').map(Number);
  const premier = `${annee}-${String(mois).padStart(2, '0')}-01`;
  const dernierJour = new Date(Date.UTC(annee, mois, 0)).getUTCDate();
  return { du: premier, au: `${annee}-${String(mois).padStart(2, '0')}-${String(dernierJour).padStart(2, '0')}` };
}

/** Le mois precedent celui de cette date. */
function moisPrecedentDe(iso) {
  const [annee, mois] = iso.split('-').map(Number);
  const precedent = mois === 1 ? { a: annee - 1, m: 12 } : { a: annee, m: mois - 1 };
  return bornesDuMois(`${precedent.a}-${String(precedent.m).padStart(2, '0')}-01`);
}

// --- Les classements -------------------------------------------------------

/** Les prestations, classees par ce qu'elles rapportent. */
function parPrestation(rendezVous, prestations) {
  const total = new Map();

  for (const r of rendezVous) {
    if (!r.serviceId) continue;
    const ligne = total.get(r.serviceId) ?? { nombre: 0, caCents: 0 };
    ligne.nombre += 1;
    ligne.caCents += tarifDe(r, prestations);
    total.set(r.serviceId, ligne);
  }

  return [...total.entries()]
    .map(([id, ligne]) => ({
      id,
      name: prestations.find((p) => p.id === id)?.name ?? 'Prestation supprimée',
      ...ligne,
    }))
    .sort((a, b) => b.caCents - a.caCents || b.nombre - a.nombre);
}

/**
 * Ce que chaque personne a realise sur la periode.
 *
 * ⚠️ CE N'EST PAS UN CLASSEMENT, et les libelles de la page le disent : les
 *    personnes sont rangees dans l'ordre de l'equipe, pas du plus gros au plus
 *    petit. Quelqu'un a trois jours par semaine fera toujours moins que
 *    quelqu'un a cinq, et afficher un podium ferait dire a ce tableau une chose
 *    qu'il ne sait pas.
 */
function parPersonne(rendezVous, equipe, prestations) {
  return equipe.map((personne) => {
    const siens = rendezVous.filter((r) => r.staffId === personne.id);
    return {
      id: personne.id,
      name: personne.name,
      nombre: siens.length,
      caCents: siens.reduce((somme, r) => somme + tarifDe(r, prestations), 0),
    };
  });
}

/**
 * Les heures creuses des huit dernieres semaines.
 *
 * >>> LE CHIFFRE LE PLUS ACTIONNABLE DU TABLEAU DE BORD. <<< Un patron ne peut
 * pas faire grand-chose de son chiffre d'affaires du mois ; il peut fermer le
 * mardi matin, decaler son ouverture d'une heure, ou y poser une promotion.
 *
 * >>> IL SE LISAIT A L'ENVERS, ET IL FALLAIT UN DENOMINATEUR POUR LE REPARER.
 * <<<
 *
 * Releve a l'ecran :
 *
 *     mardi 09:00      barre longue        6 rdv
 *     vendredi 20:00   barre moyenne      11 rdv
 *     mercredi 18:00   barre tres courte  19 rdv
 *
 * La barre encodait le VIDE, le nombre encodait le VOLUME : les deux allaient
 * en sens inverse sur la meme ligne. Un patron qui survole lit « grande barre =
 * beaucoup », c'est-a-dire l'exact contraire de ce que le tableau dit.
 *
 * Et « 19 rdv » sur huit semaines ne decidait rien : dix-neuf sur combien de
 * places ? L'information qui tranche — « cette heure est remplie a 20 % » —
 * n'etait affichee nulle part.
 *
 * ⚠️ LE REMPLISSAGE SE COMPTE EN MINUTES, PAS EN RENDEZ-VOUS. C'est la
 *    troisieme regle en tete de ce fichier, et elle vaut ici comme ailleurs :
 *    compter les rendez-vous ferait monter le taux d'une heure ou le barbier
 *    n'enchaine que des coupes a la tondeuse. Le denominateur est le temps
 *    reellement ouvert sur cette heure-la, personne par personne.
 *
 * ⚠️ ON NE COMPTE QUE LES HEURES REELLEMENT OUVERTES. Sans ce filtre, les
 *    heures les moins reservees seraient toujours celles ou le commerce est
 *    ferme — le lundi, la pause de midi, huit heures du matin — ce qui
 *    n'apprend rien a personne. Une heure dont la capacite est nulle sur toute
 *    la periode (un jour bloque de bout en bout) est ecartee de la meme facon :
 *    sa division donnerait 0 %, et elle trusterait le classement.
 *
 * ⚠️ UN RENDEZ-VOUS A CHEVAL COMPTE DANS LES DEUX HEURES, au prorata. Une coupe
 *    de 09:45 a 10:10 remplit un quart d'heure de 9h et dix minutes de 10h. La
 *    version d'avant la rangeait entierement dans l'heure de DEBUT, ce qui
 *    creusait artificiellement les heures qui commencent apres une prestation
 *    longue.
 */
function heuresCreuses({ rendezVous, blocages, horaires, equipe, du, au }) {
  /** Les minutes de [debut, fin) qui tombent dans l'heure `heure`. */
  const dansLHeure = (debut, fin, heure) => Math.max(
    0, Math.min(fin, (heure + 1) * 60) - Math.max(debut, heure * 60));

  const pris = new Map();   // « jour-heure » -> minutes reservees
  const offert = new Map(); // « jour-heure » -> minutes a vendre

  // Toutes les heures ouvertes de la semaine, a zero. C'est ce qui fait
  // apparaitre une heure ou PERSONNE n'a jamais reserve — le cas le plus
  // interessant, et celui qu'un simple parcours des rendez-vous rate.
  for (let jour = 0; jour < 7; jour++) {
    for (const [debut, fin] of plagesDe(horaires[jour])) {
      for (let heure = Math.floor(debut / 60); heure < Math.ceil(fin / 60); heure++) {
        pris.set(`${jour}-${heure}`, 0);
        offert.set(`${jour}-${heure}`, 0);
      }
    }
  }

  // --- LA CAPACITE, jour reel par jour reel ---------------------------------
  //
  // Meme lecture que `minutesOuvertes()` : horaires du commerce, horaires
  // propres de chaque personne, blocages deduits. La difference est qu'on ne
  // cumule pas un total mais qu'on repartit heure par heure.
  const blocagesParJour = new Map();
  for (const b of blocages) {
    if (!blocagesParJour.has(b.date)) blocagesParJour.set(b.date, []);
    blocagesParJour.get(b.date).push(b);
  }

  for (let date = du; date <= au; date = addDaysIso(date, 1)) {
    const jour = weekdayOf(date);
    const horaire = horaires[jour];
    if (!horaire) continue;

    const duJour = blocagesParJour.get(date) ?? [];
    if (duJour.some((b) => !b.staffId)) continue;

    // Sans equipe enregistree, le commerce compte pour UNE ressource : c'est la
    // regle du reste du projet.
    const ressources = equipe.length
      ? equipe.filter((p) => !duJour.some((b) => b.staffId === p.id))
        .map((p) => plagesTravaillees(p, horaire))
      : [plagesDe(horaire)];

    for (const plages of ressources) {
      for (const [debut, fin] of plages) {
        for (let heure = Math.floor(debut / 60); heure < Math.ceil(fin / 60); heure++) {
          const cle = `${jour}-${heure}`;
          if (!offert.has(cle)) continue;
          offert.set(cle, offert.get(cle) + dansLHeure(debut, fin, heure));
        }
      }
    }
  }

  // --- CE QUI A ETE VENDU ---------------------------------------------------
  for (const r of rendezVous) {
    const jour = weekdayOf(r.date);
    const debut = r.startMin;
    const fin = r.startMin + r.durationMin;

    for (let heure = Math.floor(debut / 60); heure < Math.ceil(fin / 60); heure++) {
      const cle = `${jour}-${heure}`;
      if (!pris.has(cle)) continue;
      pris.set(cle, pris.get(cle) + dansLHeure(debut, fin, heure));
    }
  }

  // --- LE NOMBRE BRUT, garde en information secondaire ----------------------
  //
  // « 19 rdv sur 8 semaines » ne decide rien tout seul, mais il dit l'ordre de
  // grandeur derriere le pourcentage : 0 % sur deux places offertes et 0 % sur
  // quarante ne demandent pas la meme decision.
  //
  // Il se compte sur l'heure de DEBUT, contrairement aux minutes : un
  // rendez-vous est UN rendez-vous, et le partager entre deux heures donnerait
  // « 1,4 rdv ».
  const nombres = new Map();
  for (const r of rendezVous) {
    const cle = `${weekdayOf(r.date)}-${Math.floor(r.startMin / 60)}`;
    if (pris.has(cle)) nombres.set(cle, (nombres.get(cle) ?? 0) + 1);
  }

  return [...offert.entries()]
    .filter(([, minutes]) => minutes > 0)
    .map(([cle, minutesOffertes]) => {
      const [jour, heure] = cle.split('-').map(Number);
      const minutesPrises = pris.get(cle) ?? 0;
      return {
        jour,
        heure,
        nombre: nombres.get(cle) ?? 0,
        minutesPrises,
        minutesOuvertes: minutesOffertes,
        remplissage: pourcent(minutesPrises, minutesOffertes),
      };
    })
    // >>> TRIE PAR REMPLISSAGE CROISSANT, dans le sens du titre. <<< C'etait le
    //     nombre de rendez-vous : deux heures a 6 et 19 rendez-vous pouvaient
    //     etre remplies a 60 % et 20 %, et le classement les rangeait a
    //     l'envers de ce qu'il annonce.
    .sort((a, b) => a.remplissage - b.remplissage
      || a.minutesPrises - b.minutesPrises
      || a.jour - b.jour || a.heure - b.heure)
    .slice(0, 5);
}

/**
 * Combien de clients n'etaient jamais venus.
 *
 * « Jamais vu » se mesure sur TOUT ce que la base contient avant la periode,
 * pas seulement sur la periode elle-meme. Un client de l'an dernier qui revient
 * n'est pas un nouveau client.
 *
 * Les rendez-vous sans telephone (saisis a la va-vite par le salon) sont
 * ecartes des deux cotes : on ne sait pas dire s'ils sont nouveaux, et les
 * compter comme tels gonflerait le chiffre sans raison.
 */
function nouveauxEtHabitues(rendezVous, anterieurs) {
  const dejaVus = new Set(anterieurs.map((r) => clePhone(r.customerPhone)).filter(Boolean));

  const vusDansLaPeriode = new Set();
  let nouveaux = 0;
  let habitues = 0;

  for (const r of rendezVous) {
    const cle = clePhone(r.customerPhone);
    if (!cle) continue;

    // Deux rendez-vous du meme client dans la periode : un seul client.
    if (vusDansLaPeriode.has(cle)) continue;
    vusDansLaPeriode.add(cle);

    if (dejaVus.has(cle)) habitues += 1;
    else nouveaux += 1;
  }

  return { nouveaux, habitues, total: nouveaux + habitues };
}

// --- Les absences ----------------------------------------------------------

/**
 * Combien d'absences par numero de telephone, sur toute la base.
 *
 * Renvoie une Map cle -> nombre. Sert au marqueur discret de l'agenda, et au
 * taux d'absence du tableau de bord.
 *
 * Une seule requete, groupee cote base : la solution naive — une requete par
 * rendez-vous affiche — ferait cinquante allers-retours pour une semaine.
 */
export async function absencesParClient() {
  const lignes = await prisma.booking.findMany({
    where: { presence: 'absent' },
    select: { customerPhone: true },
  });

  const compte = new Map();
  for (const ligne of lignes) {
    const cle = clePhone(ligne.customerPhone);
    if (!cle) continue;
    compte.set(cle, (compte.get(cle) ?? 0) + 1);
  }
  return compte;
}

/**
 * Le taux d'absence d'une periode.
 *
 * >>> LA REGLE DU POINTAGE, ET ELLE VAUT PARTOUT OU `presence` EST LU. <<<
 *
 * UN RENDEZ-VOUS PASSE EST VENU TANT QU'IL N'EST PAS MARQUE « absent ».
 * `null` et `'venu'` disent donc la meme chose ; seul `'absent'` differe.
 *
 * ⚠️ LE DENOMINATEUR ETAIT « CE QUI A ETE POINTE », ET CE N'EST PLUS TENABLE.
 *    Il l'etait tant que les deux etats se cochaient a la main : un commercant
 *    qui ne cochait rien pendant trois semaines ne devait pas voir son taux
 *    tomber a 2 %, il devait voir qu'il n'avait rien pointe — d'ou `pointes`,
 *    renvoye pour que la page le dise.
 *
 *    Depuis que « venu » est l'etat par defaut, ce garde-fou se retourne : le
 *    commercant ne coche QUE les absences, donc « ce qui a ete pointe » ne
 *    contient plus que des absents, et le taux afficherait 100 % a quelqu'un
 *    qui a eu deux lapins sur quarante-deux rendez-vous. Le denominateur est
 *    desormais tout ce qui est passe, ce qui est aussi le vrai taux de lapins.
 *
 * ⚠️ 0 % VEUT DIRE « PERSONNE N'A ETE SIGNALE ABSENT », et c'est maintenant une
 *    phrase vraie plutot qu'un trou dans la saisie : ne rien marquer EST
 *    l'affirmation que tout le monde est venu. L'ecran des chiffres enonce la
 *    convention (js/10-chiffres.js) — sans elle, un zero se lirait comme un
 *    sans-faute alors qu'il decrit un choix de saisie.
 *
 * ⚠️ « PASSE » SE COMPTE EN JOURS ENTIERS, et c'est voulu ici : une journee en
 *    cours n'est pas encore un resultat. C'est la difference avec l'agenda, qui
 *    compare des heures (`estTermine`, js/09-agenda.js) parce qu'on y pointe au
 *    fil de la journee.
 */
function absences(rendezVous) {
  const passes = rendezVous.filter((r) => r.date < todayIso());
  const absents = passes.filter((r) => r.presence === 'absent');

  return {
    passes: passes.length,
    absents: absents.length,
    taux: pourcent(absents.length, passes.length),
  };
}

// --- L'assemblage ----------------------------------------------------------

/**
 * Tous les chiffres du tableau de bord, en un seul appel.
 *
 * Un seul appel et non six : la page les affiche ensemble, et six requetes
 * paralleles sur SQLite ne vont pas plus vite qu'une.
 */
export async function tableauDeBord(maintenant = new Date()) {
  const aujourdHui = todayIso(maintenant);

  const [horaires, equipe, prestations] = await Promise.all([
    loadOpeningHours(),
    loadStaff(),
    // Les prestations EN PAUSE COMPRISES : un rendez-vous pris le mois dernier
    // sur une prestation retiree depuis garde son tarif, et doit garder son nom.
    prisma.service.findMany(),
  ]);

  const semaine = { du: lundiDe(aujourdHui), au: addDaysIso(lundiDe(aujourdHui), 6) };
  const moisCourant = bornesDuMois(aujourdHui);
  const moisAvant = moisPrecedentDe(aujourdHui);

  const commun = { horaires, equipe, prestations };

  const [blocSemaine, blocMois, blocMoisAvant] = await Promise.all([
    periode({ ...semaine, ...commun }),
    periode({ ...moisCourant, ...commun }),
    periode({ ...moisAvant, ...commun }),
  ]);

  // Le detail du mois : c'est la periode sur laquelle un commercant raisonne.
  const duMois = await prisma.booking.findMany({
    where: ouSontLesRendezVous(moisCourant.du, moisCourant.au),
  });

  const anterieurs = await prisma.booking.findMany({
    where: { kind: 'appt', date: { lt: moisCourant.du } },
    select: { customerPhone: true },
  });

  // ⚠️ LA FENETRE S'ARRETE HIER, ET PAS AUJOURD'HUI. La journee en cours est
  //    incomplete : ses heures a venir offriraient de la capacite que personne
  //    n'a encore eu l'occasion de remplir, et creuseraient artificiellement
  //    les fins de journee du jour de la semaine ou l'on regarde l'ecran.
  const debutRecul = addDaysIso(aujourdHui, -RECUL_SEMAINES * 7);
  const finRecul = addDaysIso(aujourdHui, -1);

  const [pourLesCreux, blocagesDuRecul] = await Promise.all([
    prisma.booking.findMany({
      where: ouSontLesRendezVous(debutRecul, finRecul),
      select: { date: true, startMin: true, durationMin: true },
    }),
    prisma.booking.findMany({
      where: { kind: 'block', date: { gte: debutRecul, lte: finRecul }, ...OCCUPENT },
    }),
  ]);

  return {
    aujourdHui,
    semaine: blocSemaine,
    mois: blocMois,
    moisPrecedent: blocMoisAvant,

    // L'ecart avec le mois precedent, en euros ET en pourcentage.
    //
    // ⚠️ `pourcent` vaut `null`, et non 0, quand le mois precedent etait vide :
    //    « +100 % » depuis zero ne veut rien dire, et « 0 % » serait un
    //    mensonge. La page ecrit alors « — » plutot qu'un nombre invente.
    ecart: {
      cents: blocMois.caCents - blocMoisAvant.caCents,
      pourcent: blocMoisAvant.caCents
        ? Math.round(((blocMois.caCents - blocMoisAvant.caCents) / blocMoisAvant.caCents) * 100)
        : null,
      rendezVous: blocMois.rendezVous - blocMoisAvant.rendezVous,
    },

    prestations: parPrestation(duMois, prestations),
    equipe: parPersonne(duMois, equipe, prestations),
    creneauxMorts: heuresCreuses({
      rendezVous: pourLesCreux,
      blocages: blocagesDuRecul,
      horaires,
      equipe,
      du: debutRecul,
      au: finRecul,
    }),
    clientele: nouveauxEtHabitues(duMois, anterieurs),
    absences: absences(duMois),
    reculSemaines: RECUL_SEMAINES,
  };
}
