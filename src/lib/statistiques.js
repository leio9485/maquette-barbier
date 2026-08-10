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
 * ⚠️ ON NE COMPTE QUE LES HEURES REELLEMENT OUVERTES. Sans ce filtre, les
 *    heures les moins reservees seraient toujours celles ou le commerce est
 *    ferme — le lundi, la pause de midi, huit heures du matin — ce qui
 *    n'apprend rien a personne.
 */
function heuresCreuses(rendezVous, horaires) {
  const compte = new Map();

  // Toutes les heures ouvertes de la semaine, a zero.
  for (let jour = 0; jour < 7; jour++) {
    for (const [debut, fin] of plagesDe(horaires[jour])) {
      for (let heure = Math.floor(debut / 60); heure < Math.ceil(fin / 60); heure++) {
        compte.set(`${jour}-${heure}`, 0);
      }
    }
  }

  for (const r of rendezVous) {
    const cle = `${weekdayOf(r.date)}-${Math.floor(r.startMin / 60)}`;
    if (compte.has(cle)) compte.set(cle, compte.get(cle) + 1);
  }

  return [...compte.entries()]
    .map(([cle, nombre]) => {
      const [jour, heure] = cle.split('-').map(Number);
      return { jour, heure, nombre };
    })
    .sort((a, b) => a.nombre - b.nombre || a.jour - b.jour || a.heure - b.heure)
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
 * ⚠️ LE DENOMINATEUR EST « CE QUI A ETE POINTE », pas « ce qui est passe ». Un
 *    commercant qui ne coche rien pendant trois semaines ne doit pas voir son
 *    taux d'absence tomber a 2 % ; il doit voir qu'il n'a rien pointe. `pointes`
 *    est renvoye pour que la page puisse le dire.
 */
function absences(rendezVous) {
  const passes = rendezVous.filter((r) => r.date < todayIso());
  const pointes = passes.filter((r) => r.presence === 'venu' || r.presence === 'absent');
  const absents = pointes.filter((r) => r.presence === 'absent');

  return {
    passes: passes.length,
    pointes: pointes.length,
    absents: absents.length,
    taux: pourcent(absents.length, pointes.length),
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

  const debutRecul = addDaysIso(aujourdHui, -RECUL_SEMAINES * 7);
  const pourLesCreux = await prisma.booking.findMany({
    where: ouSontLesRendezVous(debutRecul, aujourdHui),
    select: { date: true, startMin: true },
  });

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
    creneauxMorts: heuresCreuses(pourLesCreux, horaires),
    clientele: nouveauxEtHabitues(duMois, anterieurs),
    absences: absences(duMois),
    reculSemaines: RECUL_SEMAINES,
  };
}
