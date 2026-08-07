// ---------------------------------------------------------------------------
// DISPONIBILITES
//
// Toute la regle metier du site : quels creneaux sont proposes un jour donne,
// et lesquels sont deja pris. Cette logique existait deja cote navigateur ;
// elle est reprise ici a l'identique, mais c'est desormais CETTE version qui
// fait foi.
//
// Pourquoi la refaire cote serveur alors qu'elle marchait deja ? Parce qu'un
// visiteur peut modifier ce qui tourne dans son navigateur. Si le serveur se
// contentait d'enregistrer ce qu'on lui envoie, on pourrait lui faire accepter
// un rendez-vous a 3h du matin, un dimanche, ou sur un creneau deja pris. Le
// navigateur propose ; le serveur verifie et decide.
//
// L'EQUIPE
//
// Tout ce fichier suit une regle unique : un creneau est libre s'il reste AU
// MOINS UNE personne capable de le prendre. Deux consequences qui expliquent la
// forme du code :
//
//   - une table Staff VIDE ramene exactement le calcul d'origine, sur une
//     ressource unique implicite. C'est ce qui permet a un commerce qui
//     travaille seul de ne jamais rencontrer cette notion ;
//   - un rendez-vous sans personne attribuee occupe TOUT LE MONDE. C'est la
//     seule lecture sure : elle refuse parfois un creneau qui aurait pu passer,
//     mais elle ne peut jamais poser deux rendez-vous sur la meme personne.
// ---------------------------------------------------------------------------

import { prisma } from '../db.js';
import { toHHMM, todayIso, nowMinutes } from './time.js';

/** Les reglages du commerce (ligne unique). */
export async function loadSettings() {
  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!settings) {
    throw new Error(
      "Les reglages sont absents de la base. Lancer `npm run db:seed` pour la remplir."
    );
  }
  return settings;
}

/** Les horaires, ranges par jour de la semaine (0 = dimanche ... 6 = samedi). */
export async function loadOpeningHours() {
  const lignes = await prisma.openingHours.findMany();
  const parJour = {};
  for (const ligne of lignes) parJour[ligne.weekday] = ligne;
  return parJour;
}

/**
 * L'equipe, dans l'ordre d'affichage.
 *
 * Un tableau vide n'est pas un cas d'erreur : c'est le commerce qui travaille
 * seul, et tout le reste du fichier sait le traiter.
 *
 * `includeInactive` suit la meme regle que pour les prestations : le public ne
 * voit que les personnes actives, le commercant les voit toutes puisqu'il doit
 * pouvoir en remettre une en service — et lui caler un rendez-vous entre-temps.
 */
export async function loadStaff({ includeInactive = false } = {}) {
  return prisma.staff.findMany({
    where: includeInactive ? {} : { active: true },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
    // Les horaires propres viennent avec : sans eux, le calcul retomberait
    // silencieusement sur ceux du commerce et ferait travailler quelqu'un le
    // jour de son repos.
    include: { hours: true },
  });
}

/**
 * Charge une prestation AVEC les personnes qui l'assurent.
 *
 * Passer par cette fonction plutot que par `prisma.service.findUnique` n'est pas
 * un detail : sans la liste des liens, `eligibleStaff()` conclurait "personne
 * n'est designe, donc tout le monde assure" et le commerce se retrouverait a
 * proposer des couleurs a quelqu'un qui n'en fait pas. Un seul chemin, pas
 * d'oubli possible.
 */
export async function loadService(id) {
  return prisma.service.findUnique({
    where: { id: String(id ?? '') },
    include: { staffLinks: { select: { staffId: true } } },
  });
}

/**
 * Qui peut assurer cette prestation, parmi l'equipe fournie.
 *
 * AUCUN LIEN ENREGISTRE = TOUTE L'EQUIPE. C'est ce qui rend la fonctionnalite
 * indolore : un commerce ou chacun fait tout n'a rien a saisir, et une base
 * anterieure a l'equipe se comporte comme avant. "Personne n'assure cette
 * prestation" reste exprimable, mais par la mise en pause de la prestation.
 */
export function eligibleStaff(service, equipe) {
  const lies = new Set((service?.staffLinks ?? []).map((l) => l.staffId));
  if (!lies.size) return equipe;
  return equipe.filter((personne) => lies.has(personne.id));
}

/**
 * Les reservations qui empechent CETTE personne de prendre un rendez-vous :
 * les siennes, plus toutes celles qui ne sont attribuees a personne.
 *
 * Le second cas couvre l'heritage (les rendez-vous pris avant l'arrivee de
 * l'equipe) et les fermetures du commerce entier.
 */
export function reservationsDe(reservations, staffId) {
  return reservations.filter((r) => !r.staffId || r.staffId === staffId);
}

/**
 * Un creneau est libre s'il ne chevauche ni un rendez-vous ni un blocage.
 *
 * Deux plages se chevauchent des que l'une commence avant que l'autre finisse,
 * et inversement. Un rendez-vous de 90 minutes bloque donc bien toute sa duree,
 * et pas seulement son heure de debut.
 */
export function isFree(reservations, startMin, durationMin) {
  const fin = startMin + durationMin;
  return !reservations.some(
    (r) => startMin < r.startMin + r.durationMin && fin > r.startMin
  );
}

/**
 * Vrai si la journee entiere a ete rendue indisponible par le commercant.
 *
 * Sans `staffId`, on ne regarde que les blocages du commerce entier ; avec, on
 * y ajoute l'absence de cette personne-la. Les deux se distinguent par le seul
 * `staffId` du blocage, sans table supplementaire.
 */
export function hasDayBlock(reservations, staffId = null) {
  return reservationsDe(reservations, staffId).some((r) => r.kind === 'block');
}

// --- Les plages travaillees -------------------------------------------------
//
// Une journee ne se decrit plus par "ouverture, fermeture, pause" mais par une
// LISTE DE PLAGES : [[570, 750], [840, 1110]]. Le changement n'est pas
// cosmetique — il rend l'intersection entre les horaires du commerce et ceux
// d'une personne naturelle a ecrire, alors qu'elle etait inextricable avec un
// couple ouverture/fermeture et une pause unique.

/** Les plages d'une journee, commerce ou personne. Vide = ne travaille pas. */
export function plagesDe(day) {
  if (!day || day.closed) return [];
  if (day.openMin === null || day.closeMin === null) return [];

  if (day.pauseStartMin !== null && day.pauseEndMin !== null) {
    return [
      [day.openMin, day.pauseStartMin],
      [day.pauseEndMin, day.closeMin],
    ];
  }
  return [[day.openMin, day.closeMin]];
}

/** Ce que deux listes de plages ont en commun. */
export function intersectionPlages(a, b) {
  const communes = [];

  for (const [debutA, finA] of a) {
    for (const [debutB, finB] of b) {
      const debut = Math.max(debutA, debutB);
      const fin = Math.min(finA, finB);
      if (fin > debut) communes.push([debut, fin]);
    }
  }

  return communes.sort((x, y) => x[0] - y[0]);
}

/**
 * Les plages reellement travaillees par une personne un jour donne.
 *
 * Deux regles, et elles se combinent :
 *   - AUCUNE LIGNE D'HORAIRE POUR CE JOUR = elle suit le commerce. Le cas
 *     courant ne demande donc aucune saisie ;
 *   - ses horaires ne peuvent que REDUIRE ceux du commerce, jamais les
 *     etendre. L'intersection est faite ici, au calcul, et non verifiee a
 *     l'enregistrement : si le commerce change ses horaires plus tard, aucune
 *     ligne enregistree ne devient silencieusement fausse.
 */
export function plagesTravaillees(personne, day) {
  const duCommerce = plagesDe(day);
  if (!duCommerce.length) return [];

  const sien = (personne?.hours ?? []).find((h) => h.weekday === day.weekday);
  if (!sien) return duCommerce;

  return intersectionPlages(duCommerce, plagesDe(sien));
}

/**
 * Qui est libre a cette heure precise, parmi les personnes fournies.
 *
 * C'est le denominateur commun entre l'affichage des creneaux et
 * l'enregistrement d'un rendez-vous : les deux doivent repondre exactement la
 * meme chose, sinon le site proposerait des creneaux que le serveur refuserait.
 * C'est pourquoi les horaires propres sont relus ICI plutot que prepares par
 * l'appelant : il n'y a pas d'etape a oublier d'un cote et pas de l'autre.
 */
export function freeStaffAt({ staff, reservations, startMin, durationMin, day }) {
  return staff.filter((personne) => {
    const plages = plagesTravaillees(personne, day);
    const travaille = plages.some(([debut, fin]) => startMin >= debut && startMin + durationMin <= fin);
    if (!travaille) return false;

    return isFree(reservationsDe(reservations, personne.id), startMin, durationMin);
  });
}

/**
 * A qui attribuer un rendez-vous pris "peu importe avec qui".
 *
 * On choisit la personne la moins chargee ce jour-la, departagee par l'ordre
 * d'affichage. Repartir plutot que tirer au hasard evite qu'une meme personne
 * recolte toute la journee pendant que les autres restent vides.
 *
 * >>> A N'APPELER QUE DANS LA TRANSACTION D'ENREGISTREMENT. <<< Choisir avant
 * de verrouiller, c'est autoriser deux clientes simultanees a repartir avec la
 * meme coiffeuse.
 */
export function pickStaff(libres, reservations) {
  if (!libres.length) return null;

  const charge = (id) => reservations
    .filter((r) => r.staffId === id)
    .reduce((total, r) => total + r.durationMin, 0);

  return [...libres].sort((a, b) =>
    charge(a.id) - charge(b.id) || a.position - b.position || a.id.localeCompare(b.id)
  )[0];
}

/**
 * Les heures auxquelles un rendez-vous peut commencer ce jour-la.
 *
 * Ne depend que des horaires du commerce, pas de qui travaille : c'est la
 * grille, avant toute question d'occupation. Sont ecartes les creneaux qui
 * depassent l'heure de fermeture, ceux qui mordent sur la pause du midi, et —
 * si c'est aujourd'hui — ceux trop proches de l'heure actuelle.
 */
function candidateStarts({ date, durationMin, day, plages, settings, maintenant, ignorerDelai }) {
  const heures = [];
  if (!plages.length) return heures;

  const pasDeTemps = settings.slotStepMin;
  const estAujourdhui = date === todayIso(maintenant);
  const limite = nowMinutes(maintenant) + settings.leadTimeMin;
  const derniereFin = Math.max(...plages.map(([, fin]) => fin));

  // >>> LA GRILLE EST ANCREE SUR L'OUVERTURE DU COMMERCE, jamais sur celle de
  // la personne. Deux personnes aux horaires decales (l'une a 9h30, l'autre a
  // 10h00) produiraient sinon deux grilles differentes, et la liste affichee a
  // la cliente n'aurait plus aucun sens quand elle passe de l'une a l'autre.
  // C'est aussi ce qui laisse `isBookableStart` inchange.
  for (let t = day.openMin; t + durationMin <= derniereFin; t += pasDeTemps) {
    // Le rendez-vous doit tenir ENTIEREMENT dans une meme plage : a cheval sur
    // la pause du midi, ou debordant de l'horaire de la personne, il ne va pas.
    if (!plages.some(([debut, fin]) => t >= debut && t + durationMin <= fin)) continue;

    // Trop tard pour aujourd'hui.
    if (!ignorerDelai && estAujourdhui && t < limite) continue;

    heures.push(t);
  }

  return heures;
}

/**
 * Les creneaux d'une journee pour une duree de prestation donnee.
 *
 * Les creneaux deja pris ne sont pas retires mais marques `free: false` :
 * le site les affiche grises, ce qui renseigne mieux qu'un trou dans la liste.
 *
 * `staff` est la liste des personnes susceptibles d'assurer la prestation :
 *   - vide (commerce sans equipe enregistree) : un seul agenda, exactement le
 *     calcul d'origine, et `staff: []` sur chaque creneau ;
 *   - non vide : le creneau est libre des qu'UNE personne l'est, et il porte la
 *     liste de celles qui le sont. Cette liste evite au site un second appel
 *     pour repondre a "avec qui ?".
 *
 * `ignorerDelai` leve le delai minimum : le commercant doit pouvoir noter un
 * rendez-vous pour dans dix minutes, ce que le public ne peut pas faire. C'est
 * la meme tolerance que celle de `isBookableStart`, pour que la liste proposee
 * a la saisie corresponde exactement a ce que l'enregistrement acceptera.
 */
export function computeSlots({ date, durationMin, day, settings, reservations, staff = [], maintenant = new Date(), ignorerDelai = false }) {
  if (!day || day.closed) return [];

  const plagesDuCommerce = plagesDe(day);

  // Sans equipe enregistree : une ressource unique, le comportement d'origine.
  if (!staff.length) {
    const heures = candidateStarts({
      date, durationMin, day, plages: plagesDuCommerce, settings, maintenant, ignorerDelai,
    });
    return heures.map((t) => ({
      start: t,
      label: toHHMM(t),
      free: isFree(reservations, t, durationMin),
      staff: [],
    }));
  }

  // Avec une equipe, la grille couvre l'amplitude du commerce : une heure ou
  // une seule personne travaille doit y figurer. Ce sont les plages de chacune
  // qui decident ensuite si elle peut la prendre.
  const heures = candidateStarts({
    date, durationMin, day, plages: plagesDuCommerce, settings, maintenant, ignorerDelai,
  });

  return heures.map((t) => {
    const libres = freeStaffAt({ staff, reservations, startMin: t, durationMin, day });
    return {
      start: t,
      label: toHHMM(t),
      free: libres.length > 0,
      staff: libres.map((personne) => personne.id),
    };
  });
}

/**
 * Verifie qu'une heure de debut correspond bien a un creneau reellement
 * proposable — et pas a une valeur fabriquee de toutes pieces.
 *
 * Ne dit rien de QUI est libre, et c'est deliberé : cette question se pose au
 * dernier moment, dans la transaction d'enregistrement, via `freeStaffAt()`.
 * La verifier ici ne servirait a rien — le creneau pourrait etre pris entre la
 * verification et l'ecriture.
 *
 * `ignorerDelai` sert aux rendez-vous saisis par le commercant lui-meme :
 * il doit pouvoir noter un rendez-vous pour dans dix minutes, ce que le delai
 * minimum interdit au public.
 */
export function isBookableStart({ date, startMin, durationMin, day, settings, maintenant = new Date(), ignorerDelai = false }) {
  if (!day || day.closed) return { ok: false, raison: 'Le commerce est fermé ce jour-là.' };

  if (startMin < day.openMin || startMin + durationMin > day.closeMin) {
    return { ok: false, raison: "Ce créneau sort des horaires d'ouverture." };
  }

  // Doit tomber sur la grille des creneaux (toutes les 30 minutes par defaut).
  if ((startMin - day.openMin) % settings.slotStepMin !== 0) {
    return { ok: false, raison: "Cette heure ne correspond à aucun créneau proposé." };
  }

  if (day.pauseStartMin !== null && day.pauseEndMin !== null
      && startMin < day.pauseEndMin && startMin + durationMin > day.pauseStartMin) {
    return { ok: false, raison: 'Ce créneau tombe pendant la pause.' };
  }

  const aujourdhui = todayIso(maintenant);
  if (date < aujourdhui) {
    return { ok: false, raison: 'Cette date est déjà passée.' };
  }

  if (!ignorerDelai && date === aujourdhui) {
    if (startMin < nowMinutes(maintenant) + settings.leadTimeMin) {
      return { ok: false, raison: 'Ce créneau est trop proche pour être réservé en ligne.' };
    }
  }

  return { ok: true };
}
