// ---------------------------------------------------------------------------
// L'ETAT DU MOMENT — ce qu'affiche le bandeau en haut de la page.
//
// C'est l'element signature du site, et le seul endroit ou il prend un risque :
// une bande etroite, en chasse fixe, qui repond avant tout defilement a la
// question qu'on se pose en arrivant sur la page d'un barbier — « je peux venir
// quand ? ».
//
//     OUVERT · FERME A 19H00 · PROCHAIN CRENEAU AUJOURD'HUI 16H45
//     FERME · OUVRE DEMAIN 9H00 · PROCHAIN CRENEAU DEMAIN 9H30
//
// >>> LE TEXTE EST COMPOSE ICI, ET NULLE PART AILLEURS. <<<
//
// Le serveur l'ecrit dans la page a l'envoi, et le renvoie tel quel sur
// /api/status quand la page se rafraichit. Le navigateur ne compose donc aucune
// phrase : il remplace du texte par du texte.
//
// Ce n'est pas de la coquetterie. La page de Studio Cassandre ecrivait son titre
// a deux endroits — le serveur et le JavaScript — avec un commentaire demandant
// de penser a changer les deux. Ici, une seule formulation existe, et la
// question de la faire diverger ne se pose pas.
//
// LA DEGRADATION EST LE POINT DUR. Si l'appel echoue, le bandeau garde ce que le
// serveur y avait ecrit au chargement : des horaires justes, un peu anciens.
// Jamais de message d'erreur, jamais de bandeau vide, jamais de « ... ».
// ---------------------------------------------------------------------------

import { prisma } from '../db.js';
import { OCCUPENT } from './annulation.js';
import {
  computeSlots, hasDayBlock, loadOpeningHours, loadSettings, loadStaff, eligibleStaff, plagesDe,
} from './availability.js';
import { addDaysIso, nowMinutes, todayIso, weekdayOf } from './time.js';

/** Jusqu'ou chercher un creneau avant de renoncer. */
const HORIZON_JOURS = 30;

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/**
 * 570 -> "9H30", 1140 -> "19H00".
 *
 * Sans zero initial : c'est ainsi qu'on lit une heure a voix haute, et le
 * bandeau est une phrase, pas une colonne de tableau. Les heures qui doivent
 * s'aligner (la liste des creneaux, le tableau des horaires) sont ecrites
 * ailleurs, en "09:30".
 */
function heureParlee(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}H${String(m).padStart(2, '0')}`;
}

/**
 * "AUJOURD'HUI", "DEMAIN", "MARDI", ou "LE 12 SEPTEMBRE".
 *
 * Le nom du jour ne sert que dans la semaine qui vient : au-dela, "MARDI" est
 * ambigu — de quel mardi parle-t-on ? — et une date pleine renseigne mieux.
 */
function quandParle(dateIso, aujourdhui) {
  if (dateIso === aujourdhui) return "AUJOURD'HUI";
  if (dateIso === addDaysIso(aujourdhui, 1)) return 'DEMAIN';

  for (let n = 2; n <= 6; n++) {
    if (dateIso === addDaysIso(aujourdhui, n)) return JOURS[weekdayOf(dateIso)].toUpperCase();
  }

  const [, mois, jour] = dateIso.split('-').map(Number);
  return `LE ${jour} ${MOIS[mois - 1].toUpperCase()}`;
}

/**
 * La prestation sur laquelle porte « prochain créneau ».
 *
 * LA PLUS COURTE DES PRESTATIONS ACTIVES, et ce choix se defend : le bandeau
 * annonce le prochain moment ou le barbier peut recevoir quelqu'un, pas le
 * prochain creneau d'une prestation en particulier — le visiteur n'en a encore
 * choisi aucune, il vient d'arriver sur la page.
 *
 * Prendre la plus longue afficherait une disponibilite plus lointaine que la
 * realite pour la majorite des visites ; le tunnel, lui, recalcule tout depuis
 * la prestation reellement choisie, et c'est lui qui fait foi.
 */
async function prestationDeReference() {
  const prestations = await prisma.service.findMany({
    where: { active: true },
    include: { staffLinks: { select: { staffId: true } } },
    orderBy: [{ durationMin: 'asc' }, { position: 'asc' }],
  });
  return prestations[0] ?? null;
}

/**
 * Le premier creneau libre a partir d'aujourd'hui.
 *
 * Une journee a la fois, en s'arretant a la premiere trouvee : dans la quasi-
 * totalite des cas, c'est aujourd'hui ou demain, donc une ou deux boucles. Les
 * reservations sont chargees en une seule fois pour tout l'horizon, pour ne pas
 * interroger la base trente fois.
 */
function premierCreneau({ prestation, staff, settings, horaires, reservationsParJour, aujourdhui }) {
  const equipe = eligibleStaff(prestation, staff);

  for (let n = 0; n < HORIZON_JOURS; n++) {
    const date = addDaysIso(aujourdhui, n);
    const jour = horaires[weekdayOf(date)];
    if (!jour || jour.closed) continue;

    const reservations = reservationsParJour.get(date) ?? [];
    if (hasDayBlock(reservations)) continue;

    const creneaux = computeSlots({
      date,
      durationMin: prestation.durationMin,
      day: jour,
      settings,
      reservations,
      staff: equipe,
    });

    const libre = creneaux.find((c) => c.free);
    if (libre) return { date, start: libre.start };
  }

  return null;
}

/**
 * L'etat du commerce a cet instant, deja mis en phrases.
 *
 * Ne leve jamais : l'appelant recoit `null` s'il manque quelque chose, et le
 * bandeau garde alors ce qu'il avait. Un site de barbier ne doit pas devenir
 * illisible parce qu'une requete a echoue.
 */
export async function etatDuMoment(maintenant = new Date()) {
  try {
    const aujourdhui = todayIso(maintenant);
    const heure = nowMinutes(maintenant);

    const [settings, horaires, staff, prestation] = await Promise.all([
      loadSettings(),
      loadOpeningHours(),
      loadStaff(),
      prestationDeReference(),
    ]);

    const reservations = await prisma.booking.findMany({
      where: { date: { gte: aujourdhui, lte: addDaysIso(aujourdhui, HORIZON_JOURS) }, ...OCCUPENT },
    });

    const parJour = new Map();
    for (const r of reservations) {
      if (!parJour.has(r.date)) parJour.set(r.date, []);
      parJour.get(r.date).push(r);
    }

    // --- Ouvert ou ferme, et ce qui vient ensuite ---------------------------

    const jour = horaires[weekdayOf(aujourdhui)];
    const bloqueeAujourdhui = hasDayBlock(parJour.get(aujourdhui) ?? []);
    const plages = bloqueeAujourdhui ? [] : plagesDe(jour);

    const plageEnCours = plages.find(([debut, fin]) => heure >= debut && heure < fin);
    const ouvert = Boolean(plageEnCours);

    let suite;
    if (ouvert) {
      const [, finEnCours] = plageEnCours;
      // Une plage plus tard dans la journee ? Alors ce qui vient n'est pas la
      // fermeture mais la pause, et le dire evite de faire croire au visiteur
      // qu'il a jusqu'a 19h pour passer.
      const reprise = plages.find(([debut]) => debut >= finEnCours);
      suite = reprise
        ? `PAUSE À ${heureParlee(finEnCours)}`
        : `FERME À ${heureParlee(finEnCours)}`;
    } else {
      // La prochaine ouverture : plus tard aujourd'hui (avant l'ouverture, ou
      // pendant la pause), sinon le prochain jour ouvre.
      const plusTard = plages.find(([debut]) => debut > heure);

      if (plusTard) {
        suite = `OUVRE À ${heureParlee(plusTard[0])}`;
      } else {
        let trouve = null;
        for (let n = 1; n <= 7 && !trouve; n++) {
          const date = addDaysIso(aujourdhui, n);
          const j = horaires[weekdayOf(date)];
          if (!j || j.closed) continue;
          if (hasDayBlock(parJour.get(date) ?? [])) continue;

          const p = plagesDe(j);
          if (p.length) trouve = { date, debut: p[0][0] };
        }
        suite = trouve
          ? `OUVRE ${quandParle(trouve.date, aujourdhui)} ${heureParlee(trouve.debut)}`
          : null;
      }
    }

    // --- Le prochain creneau reellement libre -------------------------------

    let prochain = null;
    if (prestation) {
      const creneau = premierCreneau({
        prestation, staff, settings, horaires,
        reservationsParJour: parJour,
        aujourdhui,
      });

      if (creneau) {
        prochain = `PROCHAIN CRÉNEAU ${quandParle(creneau.date, aujourdhui)} ${heureParlee(creneau.start)}`;
      }
    }

    return {
      ouvert,
      etat: ouvert ? 'OUVERT' : 'FERMÉ',
      suite,
      prochain,
    };
  } catch (erreur) {
    console.error('Etat du moment indisponible :', erreur.message);
    return null;
  }
}
