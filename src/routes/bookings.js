// ---------------------------------------------------------------------------
// API DES RESERVATIONS
//
// Les adresses que le site appellera a la place de son localStorage.
// Elles se repartissent en deux familles :
//
//   /api/...        ouvert a tous : ce dont une cliente a besoin pour reserver.
//   /api/admin/...  reserve au commercant : son agenda, ses annulations.
//
// Cette separation n'est pas cosmetique. La liste des rendez-vous contient des
// noms et des numeros de telephone : elle ne doit jamais etre lisible par le
// public. Le calcul des creneaux, lui, ne revele que "libre" ou "occupe".
// ---------------------------------------------------------------------------

import express from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';

import {
  RESERVATIONS_RAFALE_MAX,
  RESERVATIONS_RAFALE_MS,
  RESERVATIONS_HEURE_MAX,
  RESERVATIONS_TENTATIVES_MAX,
  RESERVATIONS_FENETRE_MS,
  RESERVATIONS_MINUTE_MAX,
  RESERVATIONS_MINUTE_MS,
} from '../config.js';
import { prisma } from '../db.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { OCCUPENT } from '../lib/annulation.js';
import { referenceLibre } from '../lib/reference.js';
import { validerNom, normaliserTelephone, validerCourriel } from '../lib/coordonnees.js';
import { limiteApplicable, passageDisponible, noterPassage } from '../lib/rateLimit.js';
import { isValidIso, weekdayOf, todayIso, addDaysIso, nowMinutes } from '../lib/time.js';
import {
  loadSettings,
  loadOpeningHours,
  loadStaff,
  loadService,
  eligibleStaff,
  computeSlots,
  hasDayBlock,
  freeStaffAt,
  pickStaff,
  isBookableStart,
  isFree,
  reservationsDe,
} from '../lib/availability.js';
import { etatDuMoment } from '../lib/etat.js';
import { prevenirLeClient } from '../lib/courriels.js';

export const bookingsRouter = express.Router();

/** Nombre de jours qu'une seule demande de disponibilites peut couvrir. */
const FENETRE_MAX_JOURS = 62;

// --- Traduction base <-> site ---------------------------------------------

/**
 * Convertit une ligne de la base vers la forme attendue par le site.
 *
 * Les noms different volontairement : la base est explicite (`startMin`,
 * `customerName`), le site garde le vocabulaire qu'il utilise deja (`start`,
 * `name`). Cette fonction est le seul point de passage entre les deux : c'est
 * ce qui a permis de brancher le site sur l'API sans le reecrire.
 *
 * Le jeton d'annulation n'est jamais inclus par defaut. Il n'est communique
 * qu'une seule fois, dans la reponse a la reservation, a la cliente qui vient
 * de la prendre.
 */
function toApiBooking(ligne, { avecJeton = false } = {}) {
  const sortie = {
    id: ligne.id,
    type: ligne.kind,
    date: ligne.date,
    start: ligne.startMin,
    duration: ligne.durationMin,
    serviceId: ligne.serviceId,
    staffId: ligne.staffId,
    // En euros, comme partout cote site. `null` pour les rendez-vous anterieurs
    // a ce champ : le site retombe alors sur le tarif de la prestation.
    price: ligne.priceCents === null || ligne.priceCents === undefined
      ? null
      : ligne.priceCents / 100,
    name: ligne.customerName,
    phone: ligne.customerPhone,
    email: ligne.customerEmail,
    notes: ligne.notes,
    source: ligne.source,
    // La reference courte. Elle n'est pas un secret — le client la dicte au
    // telephone — et sa place est partout ou le rendez-vous apparait : sur
    // l'ecran de confirmation, dans son courriel, et dans l'agenda du
    // commercant, qui doit pouvoir la retrouver quand on la lui donne.
    reference: ligne.reference ?? null,
    // L'instant de l'annulation par le client, ou `null`. C'est ce qui permet a
    // l'agenda d'afficher la ligne barree plutot que de la faire disparaitre
    // sans explication (voir src/lib/annulation.js).
    cancelledAt: ligne.annuleLe ? ligne.annuleLe.toISOString() : null,
    // « Venu », « pas venu », ou rien tant que personne n'a repondu. Lu par
    // l'agenda pour dessiner les deux boutons de pointage.
    presence: ligne.presence ?? null,
  };
  if (avecJeton) sortie.cancelToken = ligne.cancelToken;
  return sortie;
}

/** Comparaison de deux jetons a duree constante (voir src/lib/passwords.js). */
function memeJeton(attendu, recu) {
  if (typeof attendu !== 'string' || typeof recu !== 'string') return false;

  const a = Buffer.from(attendu, 'utf8');
  const b = Buffer.from(recu, 'utf8');
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

/** Reponse d'erreur uniforme : le site n'a qu'un seul format a savoir lire. */
function refus(res, code, message) {
  return res.status(code).json({ error: message });
}

/** Nettoie un texte saisi : coupe les espaces inutiles et borne la longueur. */
function texte(valeur, maxi) {
  if (typeof valeur !== 'string') return null;
  const propre = valeur.trim();
  if (!propre) return null;
  return propre.slice(0, maxi);
}

/** Un identifiant recu, ou null. "Peu importe avec qui" s'ecrit null. */
function identifiantOptionnel(valeur) {
  return typeof valeur === 'string' && valeur.trim() ? valeur.trim() : null;
}

// --- Les plafonds de reservation -------------------------------------------

/**
 * Les trois plafonds qui protegent l'agenda d'un client, dans l'ordre ou on les
 * consulte. Voir src/config.js pour le raisonnement sur les valeurs.
 */
const PLAFONDS = [
  { nom: 'minute', max: RESERVATIONS_MINUTE_MAX, fenetreMs: RESERVATIONS_MINUTE_MS },
  { nom: 'tentatives', max: RESERVATIONS_TENTATIVES_MAX, fenetreMs: RESERVATIONS_FENETRE_MS },
  { nom: 'rafale', max: RESERVATIONS_RAFALE_MAX, fenetreMs: RESERVATIONS_RAFALE_MS },
  { nom: 'heure', max: RESERVATIONS_HEURE_MAX, fenetreMs: RESERVATIONS_FENETRE_MS },
];

/**
 * Les plafonds qui comptent CHAQUE PASSAGE, aboutissement ou non.
 *
 * >>> C'ETAIT LE TROU. <<< « rafale » et « heure » ne notent que ce qui a
 * vraiment cree un rendez-vous : quarante requetes invalides d'affilee ne les
 * touchaient pas. « tentatives » les comptait bien, mais a l'heure — quarante
 * requetes en une seconde et demie restaient donc sous son seuil. « minute »
 * est le plafond qui manquait, et il se note ici, avec l'autre.
 */
const PLAFONDS_PAR_TENTATIVE = ['minute', 'tentatives'];

const cleDe = (nom, ip) => `resa:${nom}:${ip}`;

/**
 * Ce qu'on repond quand un plafond est atteint.
 *
 * >>> LE MESSAGE DIT COMBIEN DE TEMPS, ET DONNE UNE SORTIE. <<< Un refus sec
 * laisse quelqu'un recliquer dans le vide ; un refus qui dit « dans douze
 * minutes, ou appelez le salon » laisse le choix. Le numero est sur la page,
 * juste en dessous — inutile de le recopier ici et d'ouvrir la base pour cela.
 *
 * ⚠️ AUCUNE INDICATION DE CE QUI A DECLENCHE. « Trop de reservations » et rien
 *    de plus : dire lequel des trois plafonds a mordu apprendrait a un curieux
 *    comment passer entre.
 */
function trop(res, secondes) {
  const minutes = Math.max(1, Math.ceil((secondes ?? 60) / 60));

  // `Retry-After` EN PLUS DE LA PHRASE, et pas a sa place : la phrase est pour
  // le client, l'en-tete est pour ce qui n'a pas d'yeux — un moniteur, un
  // relais, une bibliotheque qui reessaie toute seule. Sans lui, un client
  // programme reessaie a l'aveugle, souvent tout de suite, ce qui est
  // exactement ce qu'on cherche a eviter.
  res.setHeader('Retry-After', String(Math.max(1, Math.ceil(secondes ?? 60))));

  return res.status(429).json({
    error: `Trop de réservations depuis cette connexion. Réessayez dans ${minutes} minute${minutes > 1 ? 's' : ''}, ou appelez le salon.`,
  });
}

// --- L'equipe ---------------------------------------------------------------

/**
 * Repond a "qui peut prendre ce rendez-vous ?".
 *
 * Renvoie soit `{ erreur }`, soit `{ eligibles }` — la liste des personnes a
 * considerer pour le calcul comme pour l'enregistrement. Cette liste est vide
 * quand le commerce n'a pas d'equipe enregistree : c'est le cas normal de
 * l'agenda unique, pas une erreur.
 *
 * Quand une personne precise est demandee, la liste se reduit a elle seule :
 * les creneaux affiches sont alors exactement ceux qu'elle peut prendre.
 *
 * `tolererEnPause` est le pendant, pour les personnes, de la tolerance deja
 * accordee aux prestations en pause cote commercant : le salon peut caler un
 * rendez-vous a quelqu'un qui ne figure plus sur le site. La repartition
 * automatique, elle, ne retient jamais qu'une personne active.
 */
async function resoudreEquipe(prestation, staffIdDemande, { tolererEnPause = false } = {}) {
  const toutes = await loadStaff({ includeInactive: true });
  const actives = toutes.filter((personne) => personne.active);

  if (!staffIdDemande) return { eligibles: eligibleStaff(prestation, actives) };

  const connue = toutes.find((personne) => personne.id === staffIdDemande);
  if (!connue) return { erreur: { code: 404, message: 'Personne inconnue.' } };

  if (!connue.active && !tolererEnPause) {
    return { erreur: { code: 409, message: "Cette personne ne prend pas de rendez-vous en ligne." } };
  }

  const bassin = tolererEnPause ? toutes : actives;
  const autorisee = eligibleStaff(prestation, bassin).some((p) => p.id === connue.id);
  if (!autorisee) {
    return { erreur: { code: 409, message: "Cette personne n'assure pas cette prestation." } };
  }

  return { eligibles: [connue] };
}

/**
 * Attribue le rendez-vous, ou constate que le creneau n'est plus prenable.
 *
 * Renvoie `{ staffId }` — avec `staffId: null` pour un commerce sans equipe —
 * ou `null` si plus personne ne peut le prendre.
 *
 * >>> A N'APPELER QUE DANS LA TRANSACTION D'ENREGISTREMENT. <<< C'est tout
 * l'interet de cette fonction : le controle "est-ce libre" et le choix de la
 * personne sont une seule et meme operation. Les separer laisserait deux
 * clientes simultanees repartir avec la meme coiffeuse.
 */
function attribuer({ eligibles, reservations, startMin, durationMin, day, prestation }) {
  // Le tarif est celui de la prestation, quelle que soit la personne : une coupe
  // vaut le meme prix pour tout le monde. On le recopie tout de meme sur le
  // rendez-vous, pour le figer a ce qui a ete annonce a la cliente.
  const avecPrix = (staffId) => ({ staffId, priceCents: prestation.priceCents });

  if (!eligibles.length) {
    return isFree(reservations, startMin, durationMin) ? avecPrix(null) : null;
  }

  // `day` compte : c'est lui qui permet a freeStaffAt d'ecarter une personne
  // dont ce n'est pas le jour de travail. L'oublier ferait accepter un
  // rendez-vous que la liste des creneaux n'aurait jamais propose.
  const libres = freeStaffAt({ staff: eligibles, reservations, startMin, durationMin, day });
  const choisie = pickStaff(libres, reservations);
  return choisie ? avecPrix(choisie.id) : null;
}

/**
 * `force: true` a-t-il ete demande ?
 *
 * >>> LE FORCAGE EST UN GESTE DE COMMERCANT, ET IL N'EXISTE QUE LA. <<<
 *
 * Le patron est chez lui : s'il decide de caser quelqu'un en doublant a 15h,
 * le logiciel doit le permettre — c'est son agenda et il connait son metier.
 * Un client, lui, ne doit jamais pouvoir se fabriquer une place : ce serait
 * l'oracle de disponibilite le plus simple du monde, et le moyen de remplir un
 * agenda de doublons depuis une boucle de dix lignes.
 *
 * ⚠️ CETTE FONCTION N'EST APPELEE QUE DEPUIS LES ROUTES `/admin/…`, toutes
 *    derriere `requireAdmin`. Les adresses publiques — `POST /api/bookings`,
 *    `PATCH /api/rendez-vous/…` — ne la lisent nulle part : un `force: true`
 *    envoye la-bas est un champ inconnu de plus, ignore comme les autres. C'est
 *    verifie par un test plutot que promis par un commentaire, parce que la
 *    portee est exactement ce qui se perd en recopiant une ligne d'une route a
 *    l'autre.
 *
 * Strictement `=== true` : ni `"true"`, ni `1`, ni `"on"`. Un formulaire mal
 * serialise ne doit pas doubler un rendez-vous par accident.
 */
function forcage(req) {
  return req.body?.force === true;
}

// --- Routes publiques ------------------------------------------------------

/**
 * GET /api/slots?date=AAAA-MM-JJ&serviceId=coupe[&staffId=...]
 *
 * Les creneaux d'une journee pour une prestation. Ne renvoie aucune donnee
 * personnelle : seulement une heure, un etat libre/occupe, et — quand le
 * commerce a une equipe — les prenoms de ceux qui sont libres a cette heure.
 *
 * `staffId` restreint le calcul a une seule personne. Sans lui, un creneau est
 * libre des qu'une personne l'est. Le champ `staff` de la reponse dit toujours
 * sur quelles personnes le calcul a porte ; il est vide pour un commerce a
 * agenda unique, ce qui est aussi le signal que le site n'a rien a proposer.
 */
bookingsRouter.get('/slots', async (req, res, next) => {
  try {
    const { date, serviceId } = req.query;

    if (!isValidIso(date)) return refus(res, 400, 'Date invalide.');

    const prestation = await loadService(serviceId);
    if (!prestation) return refus(res, 404, 'Prestation inconnue.');
    if (!prestation.active) return refus(res, 409, "Cette prestation n'est pas proposée en ligne.");

    const equipe = await resoudreEquipe(prestation, identifiantOptionnel(req.query.staffId));
    if (equipe.erreur) return refus(res, equipe.erreur.code, equipe.erreur.message);

    const [settings, horaires, reservations] = await Promise.all([
      loadSettings(),
      loadOpeningHours(),
      prisma.booking.findMany({ where: { date, ...OCCUPENT } }),
    ]);

    const creneaux = computeSlots({
      date,
      durationMin: prestation.durationMin,
      day: horaires[weekdayOf(date)],
      settings,
      reservations,
      staff: equipe.eligibles,
    });

    res.json({
      date,
      serviceId: prestation.id,
      duration: prestation.durationMin,
      staff: equipe.eligibles.map((p) => ({ id: p.id, name: p.name })),
      slots: creneaux,
    });
  } catch (erreur) {
    next(erreur);
  }
});

/**
 * GET /api/days?from=AAAA-MM-JJ&to=AAAA-MM-JJ&serviceId=coupe
 *
 * L'etat de chaque journee d'une periode, pour le calendrier du site :
 * `closed` (le commerce est ferme), `full` (ouvert, mais plus un seul creneau
 * libre pour cette prestation) ou `open`.
 *
 * Cette adresse existe pour une raison bien precise : le calendrier grise les
 * journees completes, ce qui demandait de calculer les creneaux de chacun des
 * trente jours du mois affiche. En passant par /api/slots, cela ferait trente
 * allers-retours a chaque changement de mois ; ici, un seul suffit.
 *
 * Comme /api/slots, elle ne revele rien d'autre que libre ou occupe. Une
 * journee n'est `full` que lorsque PERSONNE n'y a plus de creneau : avec une
 * equipe, l'absence d'une seule personne ne ferme pas la journee.
 */
bookingsRouter.get('/days', async (req, res, next) => {
  try {
    const { from, to, serviceId } = req.query;

    if (!isValidIso(from) || !isValidIso(to)) return refus(res, 400, 'Dates invalides.');
    if (to < from) return refus(res, 400, 'La date de fin précède la date de début.');
    if (from < addDaysIso(to, -FENETRE_MAX_JOURS)) {
      return refus(res, 400, `La période demandée dépasse ${FENETRE_MAX_JOURS} jours.`);
    }

    const prestation = await loadService(serviceId);
    if (!prestation) return refus(res, 404, 'Prestation inconnue.');
    if (!prestation.active) return refus(res, 409, "Cette prestation n'est pas proposée en ligne.");

    const equipe = await resoudreEquipe(prestation, identifiantOptionnel(req.query.staffId));
    if (equipe.erreur) return refus(res, equipe.erreur.code, equipe.erreur.message);

    const [settings, horaires, reservations] = await Promise.all([
      loadSettings(),
      loadOpeningHours(),
      prisma.booking.findMany({ where: { date: { gte: from, lte: to }, ...OCCUPENT } }),
    ]);

    // Un seul passage sur les reservations : les ranger par jour evite de
    // reparcourir toute la liste pour chacune des journees examinees.
    const parJour = new Map();
    for (const r of reservations) {
      if (!parJour.has(r.date)) parJour.set(r.date, []);
      parJour.get(r.date).push(r);
    }

    const jours = [];
    for (let date = from; date <= to; date = addDaysIso(date, 1)) {
      const creneaux = computeSlots({
        date,
        durationMin: prestation.durationMin,
        day: horaires[weekdayOf(date)],
        settings,
        reservations: parJour.get(date) ?? [],
        staff: equipe.eligibles,
      });

      const jour = horaires[weekdayOf(date)];
      const ferme = !jour || jour.closed;

      jours.push({
        date,
        state: ferme ? 'closed' : (creneaux.some((c) => c.free) ? 'open' : 'full'),
      });
    }

    res.json({ from, to, serviceId: prestation.id, days: jours });
  } catch (erreur) {
    next(erreur);
  }
});

/**
 * GET /api/status
 *
 * L'etat du moment pour le bandeau en haut de la page : ouvert ou ferme, ce qui
 * vient ensuite, et le prochain creneau reellement libre (voir src/lib/etat.js).
 *
 * Les phrases sont composees par le serveur et renvoyees toutes faites : le
 * bandeau remplace du texte par du texte, il n'assemble rien. Une seule
 * formulation existe donc dans le projet, et elle ne peut pas diverger.
 *
 * NE REVELE RIEN DE PERSONNEL : une heure et un etat, comme /api/slots.
 *
 * `no-store` : c'est la donnee la plus perissable du site. Un relais qui la
 * garderait ne serait-ce qu'une minute afficherait « prochain créneau 16h45 »
 * a quelqu'un qui arrive a 16h50.
 */
bookingsRouter.get('/status', async (req, res, next) => {
  try {
    const etat = await etatDuMoment();

    // Le calcul a echoue : on le dit par un 503 plutot que par un etat invente.
    // Le bandeau garde alors ce que le serveur y avait ecrit au chargement, ce
    // qui est exactement le comportement voulu.
    if (!etat) return res.status(503).json({ error: 'État indisponible.' });

    res.setHeader('Cache-Control', 'no-store');
    res.json(etat);
  } catch (erreur) {
    next(erreur);
  }
});

/**
 * POST /api/bookings
 *
 * Reservation prise par une cliente depuis le site.
 * Le serveur ne fait confiance a rien de ce qu'il recoit : il relit la duree
 * depuis la prestation, revalide le creneau, et refuse une prestation en pause.
 *
 * `staffId` est facultatif : l'omettre, c'est "peu importe avec qui", et le
 * serveur repartit alors sur la personne la moins chargee du jour.
 */
bookingsRouter.post('/bookings', async (req, res, next) => {
  try {
    // >>> LES PLAFONDS, AVANT TOUT LE RESTE. <<<
    //
    // Avant meme de lire ce qui arrive : une requete refusee ici ne doit rien
    // couter — ni lecture de la base, ni calcul de creneau. C'est tout l'objet
    // du plafond de tentatives.
    //
    // On les consulte SANS RIEN COMPTER : la tentative est notee juste apres,
    // et la reservation aboutie plus bas, seulement si elle a lieu.
    const limite = limiteApplicable(req.ip);

    if (limite) {
      for (const plafond of PLAFONDS) {
        const verdict = passageDisponible(cleDe(plafond.nom, req.ip), { max: plafond.max });
        if (verdict.bloque) return trop(res, verdict.secondes);
      }

      for (const nom of PLAFONDS_PAR_TENTATIVE) {
        const plafond = PLAFONDS.find((p) => p.nom === nom);
        noterPassage(cleDe(nom, req.ip), { fenetreMs: plafond.fenetreMs });
      }
    }

    const { date, start, serviceId } = req.body ?? {};

    if (!isValidIso(date)) return refus(res, 400, 'Date invalide.');
    if (!Number.isInteger(start) || start < 0 || start > 1439) {
      return refus(res, 400, 'Heure invalide.');
    }

    // >>> LES COORDONNEES, VERIFIEES ICI ET PAS SEULEMENT DANS LE NAVIGATEUR. <<<
    //
    // Ces trois lignes etaient `texte(…, 120)` : rien de plus qu'un `trim()` et
    // une coupe. « abc » passait pour un telephone, « pasunemail » pour un
    // courriel, et un nom de cinq mille caracteres partait en base ampute a
    // cent vingt sans que personne ne le sache. La regle complete, et le
    // pourquoi de chaque cas, sont dans src/lib/coordonnees.js.
    //
    // ⚠️ L'ORDRE DES MESSAGES SUIT L'ORDRE DES CHAMPS A L'ECRAN. Le navigateur
    //    pose la meme sequence (js/07-tunnel.js) : celui qui envoie un
    //    formulaire depuis la page et celui qui appelle l'API directement
    //    doivent lire la meme phrase pour la meme faute.
    const verdictNom = validerNom(req.body?.name);
    if (verdictNom.erreur) return refus(res, 400, verdictNom.erreur);

    const verdictTel = normaliserTelephone(req.body?.phone);
    if (verdictTel.erreur) return refus(res, 400, verdictTel.erreur);

    const verdictCourriel = validerCourriel(req.body?.email);
    if (verdictCourriel.erreur) return refus(res, 400, verdictCourriel.erreur);

    const nom = verdictNom.valeur;
    // NORMALISE, pas brut : le meme numero tape de quatre facons remplissait
    // quatre lignes differentes dans l'export « clients ».
    const telephone = verdictTel.valeur;
    const courriel = verdictCourriel.valeur;

    const prestation = await loadService(serviceId);
    if (!prestation) return refus(res, 404, 'Prestation inconnue.');
    if (!prestation.active) return refus(res, 409, "Cette prestation n'est plus proposée en ligne.");

    const equipe = await resoudreEquipe(prestation, identifiantOptionnel(req.body?.staffId));
    if (equipe.erreur) return refus(res, equipe.erreur.code, equipe.erreur.message);

    const [settings, horaires] = await Promise.all([loadSettings(), loadOpeningHours()]);

    // La duree vient de la prestation, jamais de la requete.
    const duree = prestation.durationMin;

    const verdict = isBookableStart({
      date,
      startMin: start,
      durationMin: duree,
      day: horaires[weekdayOf(date)],
      settings,
    });
    if (!verdict.ok) return refus(res, 409, verdict.raison);

    // Le controle "le creneau est-il libre ?", le CHOIX DE LA PERSONNE et
    // l'enregistrement doivent se faire d'un seul bloc : sinon, deux clientes
    // cliquant en meme temps passeraient toutes deux le controle, et se
    // verraient attribuer la meme coiffeuse avant que l'une n'ait enregistre.
    const cree = await prisma.$transaction(async (tx) => {
      const dejaPris = await tx.booking.findMany({ where: { date, ...OCCUPENT } });

      const attribution = attribuer({
        eligibles: equipe.eligibles,
        reservations: dejaPris,
        startMin: start,
        durationMin: duree,
        day: horaires[weekdayOf(date)],
        prestation,
      });
      if (!attribution) return null;

      return tx.booking.create({
        data: {
          kind: 'appt',
          date,
          startMin: start,
          durationMin: duree,
          serviceId: prestation.id,
          staffId: attribution.staffId,
          priceCents: attribution.priceCents,
          customerName: nom,
          customerPhone: telephone,
          customerEmail: courriel,
          source: 'online',
          // Remis a la cliente sur l'ecran de confirmation, et a elle seule :
          // c'est ce qui l'autorisera a annuler son propre rendez-vous.
          cancelToken: randomBytes(32).toString('base64url'),
          // La reference courte, celle qu'elle note et qu'elle ressaisira sur
          // /annuler. Tiree DANS la transaction, avec le meme client : c'est ce
          // qui rend le controle d'unicite valable au moment de l'ecriture.
          reference: await referenceLibre(tx),
        },
      });
    });

    if (!cree) return refus(res, 409, "Ce créneau vient d'être réservé. Merci d'en choisir un autre.");

    // LE RENDEZ-VOUS EXISTE : on le compte dans les deux plafonds qui portent
    // sur ce qui aboutit. Ici et pas plus haut — un creneau perdu au profit de
    // quelqu'un d'autre n'a sali aucun agenda, il n'a pas a etre decompte.
    if (limite) {
      noterPassage(cleDe('rafale', req.ip), { fenetreMs: RESERVATIONS_RAFALE_MS });
      noterPassage(cleDe('heure', req.ip), { fenetreMs: RESERVATIONS_FENETRE_MS });
    }

    res.status(201).json(toApiBooking(cree, { avecJeton: true }));

    // >>> LA CONFIRMATION ECRITE, ET C'EST TOUT L'INTERET DU CANAL. <<< Sans
    //     elle, le client repart avec une reference de six caracteres qu'il a
    //     peut-etre notee, et rien d'autre.
    //
    // ⚠️ APRES `res`, ET SANS `await`. `prevenirLeClient()` ne rend rien et ne
    //    leve pas : la reponse au client est deja partie, et une reservation
    //    aboutie ne doit ni attendre un courriel ni echouer parce qu'il n'est
    //    pas parti. Le champ etant facultatif, l'appel sort de lui-meme quand
    //    il n'y a pas d'adresse.
    prevenirLeClient('confirmation', { rendezVous: cree });
  } catch (erreur) {
    next(erreur);
  }
});

/**
 * DELETE /api/bookings/:id?token=...
 *
 * Annulation par la cliente elle-meme, depuis l'ecran de confirmation.
 *
 * L'identifiant seul ne suffit pas : celui que Prisma attribue est en partie
 * previsible (il contient l'instant de creation), et n'importe qui pourrait
 * alors annuler les rendez-vous des autres. C'est le jeton, tire au hasard a la
 * reservation et connu de la seule cliente, qui fait foi.
 *
 * Seuls les rendez-vous pris en ligne et pas encore passes sont concernes : ce
 * qu'a saisi le commercant lui-meme, et l'historique, ne se touchent que depuis
 * l'espace commercant.
 */
bookingsRouter.delete('/bookings/:id', async (req, res, next) => {
  try {
    const jeton = typeof req.query.token === 'string' ? req.query.token : '';

    const rendezVous = await prisma.booking.findUnique({ where: { id: req.params.id } });

    // Rendez-vous inconnu, jeton faux et rendez-vous DEJA ANNULE renvoient la
    // meme reponse : sans cela, on pourrait apprendre quels identifiants
    // existent en les essayant.
    //
    // Cette adresse-ci reste donc muette sur l'annulation deja faite, alors que
    // /api/rendez-vous/annuler, elle, le dit en toutes lettres. La difference
    // n'est pas un oubli : celle-la se rejoue depuis un ecran ouvert, sans que
    // personne n'ait rien saisi, et n'a aucun message a porter.
    if (!rendezVous
      || !rendezVous.cancelToken
      || !memeJeton(rendezVous.cancelToken, jeton)
      || rendezVous.annuleLe) {
      return refus(res, 404, 'Ce rendez-vous est introuvable.');
    }

    if (rendezVous.kind !== 'appt' || rendezVous.source !== 'online') {
      return refus(res, 403, 'Ce rendez-vous ne peut être annulé que par le salon.');
    }

    if (rendezVous.date < todayIso()) {
      return refus(res, 409, 'Ce rendez-vous est déjà passé.');
    }

    // MARQUE, ET NON SUPPRIME. Le creneau se libere de la meme facon — tout ce
    // qui calcule une disponibilite ecarte les lignes annulees — mais le
    // commercant voit que quelqu'un s'est decommande. Voir src/lib/annulation.js.
    await prisma.booking.update({
      where: { id: rendezVous.id },
      data: { annuleLe: new Date() },
    });
    res.json({ ok: true, id: rendezVous.id });

    // Le client vient d'annuler lui-meme : le courriel n'apprend rien de neuf,
    // il DONNE UNE TRACE. C'est ce qu'on relit quand on doute d'avoir bien
    // annule — et le doute, ici, se resout autrement par un appel au salon.
    prevenirLeClient('annulation', { rendezVous });
  } catch (erreur) {
    next(erreur);
  }
});

// --- Routes de l'espace commercant ----------------------------------------
//
// Toutes passent par `requireAdmin` : une seule porte a surveiller.

/**
 * GET /api/admin/slots?date=AAAA-MM-JJ&serviceId=coupe
 *
 * Les creneaux proposes au commercant quand il saisit lui-meme un rendez-vous.
 *
 * Trois differences avec l'adresse publique, les memes que pour l'enregistrement
 * (POST /api/admin/bookings) : une prestation en pause reste calable a la main,
 * une personne en pause aussi, et le delai minimum ne s'applique pas — un client
 * peut se presenter a la boutique et repartir avec un rendez-vous dans le quart
 * d'heure.
 *
 * `exclude=<id>` RETIRE UN RENDEZ-VOUS DU CALCUL, et ne sert qu'au deplacement.
 *
 * Sans lui, l'ecran « Deplacer » affiche le creneau actuel du rendez-vous comme
 * pris — pris par lui-meme — et le desactive. Consequence concrete : on ne peut
 * plus changer la personne ni la prestation sans changer aussi l'heure, alors
 * que c'est justement le cas le plus courant. C'est le pendant, cote liste, de
 * l'auto-collision que la transaction du PATCH ecarte deja.
 */
bookingsRouter.get('/admin/slots', requireAdmin, async (req, res, next) => {
  try {
    const { date, serviceId } = req.query;

    if (!isValidIso(date)) return refus(res, 400, 'Date invalide.');

    const prestation = await loadService(serviceId);
    if (!prestation) return refus(res, 404, 'Prestation inconnue.');

    const equipe = await resoudreEquipe(prestation, identifiantOptionnel(req.query.staffId), {
      tolererEnPause: true,
    });
    if (equipe.erreur) return refus(res, equipe.erreur.code, equipe.erreur.message);

    const ignore = identifiantOptionnel(req.query.exclude);

    const [settings, horaires, reservations] = await Promise.all([
      loadSettings(),
      loadOpeningHours(),
      prisma.booking.findMany({
        where: { date, ...(ignore ? { id: { not: ignore } } : {}), ...OCCUPENT },
      }),
    ]);

    const creneaux = computeSlots({
      date,
      durationMin: prestation.durationMin,
      day: horaires[weekdayOf(date)],
      settings,
      reservations,
      staff: equipe.eligibles,
      ignorerDelai: true,
    });

    res.json({
      date,
      serviceId: prestation.id,
      duration: prestation.durationMin,
      staff: equipe.eligibles.map((p) => ({ id: p.id, name: p.name })),
      slots: creneaux,
    });
  } catch (erreur) {
    next(erreur);
  }
});

/** Jusqu'ou chercher une disponibilite avant de renoncer. */
const HORIZON_DISPOS_JOURS = 30;

/** Combien de disponibilites proposer d'emblee, et le plafond demandable. */
const DISPOS_PAR_DEFAUT = 3;
const DISPOS_MAX = 10;

/**
 * GET /api/admin/prochaines-dispos?serviceId=&staffId=&date=&exclude=&limite=3
 *
 * LES PREMIERES DISPONIBILITES REELLES, SUR PLUSIEURS JOURS.
 *
 * >>> C'EST LA ROUTE QUI MANQUAIT AU DEPLACEMENT. <<<
 *
 * Mesure en session : ouvrir un rendez-vous du 20 aout, cliquer « Deplacer ce
 * rendez-vous ». La liste des heures contenait vingt-huit entrees dont
 * vingt-sept « — pris » et desactivees ; seule l'heure actuelle etait
 * selectionnable, c'est-a-dire qu'on ne pouvait rien faire. En passant au 21 :
 * trente-six entrees, une seule libre. Le commercant devait changer de date
 * jour apres jour et relire trente lignes mortes a chaque fois — au telephone,
 * avec un client en ligne, qui est le SEUL moment ou l'on deplace un
 * rendez-vous.
 *
 * Le tunnel client, lui, sait depuis toujours ouvrir le premier jour libre. Le
 * commercant, non : `GET /api/admin/slots` ne repond que sur UNE journee, celle
 * qu'on lui nomme. C'est cette adresse-la qui balaie les jours suivants.
 *
 * `exclude=<id>` a exactement le meme role qu'ici au-dessus : un rendez-vous
 * qu'on deplace ne doit pas se voir lui-meme comme obstacle, sans quoi son
 * heure actuelle ne figurerait jamais parmi les propositions.
 *
 * ⚠️ UNE SEULE REQUETE EN BASE POUR TOUT L'HORIZON, comme dans etat.js. Boucler
 *    trente jours en interrogeant la base a chaque tour ferait trente
 *    allers-retours pour repondre « demain 09:00 » — et cette adresse est
 *    appelee a chaque ouverture de la fenetre.
 */
bookingsRouter.get('/admin/prochaines-dispos', requireAdmin, async (req, res, next) => {
  try {
    const depart = isValidIso(req.query.date) ? req.query.date : todayIso();

    // ⚠️ ON NE REMONTE JAMAIS AVANT AUJOURD'HUI. Le formulaire s'ouvre sur la
    //    date actuelle du rendez-vous, qui peut etre passee — proposer alors
    //    « mardi dernier 09:00 » serait proposer ce que le PATCH refuse.
    const from = depart < todayIso() ? todayIso() : depart;

    const prestation = await loadService(req.query.serviceId);
    if (!prestation) return refus(res, 404, 'Prestation inconnue.');

    const equipe = await resoudreEquipe(prestation, identifiantOptionnel(req.query.staffId), {
      tolererEnPause: true,
    });
    if (equipe.erreur) return refus(res, equipe.erreur.code, equipe.erreur.message);

    const demandee = Number(req.query.limite);
    const limite = Number.isInteger(demandee) && demandee > 0
      ? Math.min(demandee, DISPOS_MAX)
      : DISPOS_PAR_DEFAUT;

    const ignore = identifiantOptionnel(req.query.exclude);
    const jusqua = addDaysIso(from, HORIZON_DISPOS_JOURS);

    const [settings, horaires, reservations] = await Promise.all([
      loadSettings(),
      loadOpeningHours(),
      prisma.booking.findMany({
        where: {
          date: { gte: from, lte: jusqua },
          ...(ignore ? { id: { not: ignore } } : {}),
          ...OCCUPENT,
        },
      }),
    ]);

    const parJour = new Map();
    for (const r of reservations) {
      if (!parJour.has(r.date)) parJour.set(r.date, []);
      parJour.get(r.date).push(r);
    }

    const trouvees = [];
    for (let n = 0; n <= HORIZON_DISPOS_JOURS && trouvees.length < limite; n++) {
      const date = addDaysIso(from, n);
      const jour = horaires[weekdayOf(date)];
      if (!jour || jour.closed) continue;

      const duJour = parJour.get(date) ?? [];
      if (hasDayBlock(duJour)) continue;

      const creneaux = computeSlots({
        date,
        durationMin: prestation.durationMin,
        day: jour,
        settings,
        reservations: duJour,
        staff: equipe.eligibles,
        // Comme partout cote commercant : le delai minimum ne s'applique pas.
        // Un client au telephone peut arriver dans le quart d'heure.
        ignorerDelai: true,
      });

      for (const creneau of creneaux) {
        if (!creneau.free) continue;

        // ⚠️ AUJOURD'HUI, CE QUI EST PASSE N'EST PAS UNE PROPOSITION. Le calcul
        //    ci-dessus rend la journee ENTIERE — c'est voulu ailleurs, et il ne
        //    faut pas y toucher : `GET /api/admin/slots` s'en sert pour laisser
        //    noter a 15h le client passe a 9h ce matin. Mais cette adresse-ci
        //    repond « quand puis-je vous caser ? », et « aujourd'hui 09:00 » a
        //    15h40 n'est pas une reponse a cette question — c'est meme la seule
        //    facon de rendre les trois propositions inutilisables, puisque ce
        //    sont les trois premieres de la grille qui sortiraient toujours.
        if (date === todayIso() && creneau.start < nowMinutes()) continue;

        trouvees.push({ date, start: creneau.start, label: creneau.label });
        if (trouvees.length >= limite) break;
      }
    }

    res.json({
      serviceId: prestation.id,
      duration: prestation.durationMin,
      slots: trouvees,
    });
  } catch (erreur) {
    next(erreur);
  }
});

/**
 * GET /api/admin/bookings?from=AAAA-MM-JJ&to=AAAA-MM-JJ
 *
 * Les rendez-vous d'une periode (l'agenda affiche une semaine a la fois).
 * Sans parametres : les 60 jours a partir d'aujourd'hui.
 */
bookingsRouter.get('/admin/bookings', requireAdmin, async (req, res, next) => {
  try {
    const from = isValidIso(req.query.from) ? req.query.from : todayIso();
    const to = isValidIso(req.query.to) ? req.query.to : addDaysIso(from, 60);

    if (to < from) return refus(res, 400, 'La date de fin précède la date de début.');

    const lignes = await prisma.booking.findMany({
      where: { date: { gte: from, lte: to } },
      orderBy: [{ date: 'asc' }, { startMin: 'asc' }],
    });

    res.json({ from, to, bookings: lignes.map(toApiBooking) });
  } catch (erreur) {
    next(erreur);
  }
});

/**
 * POST /api/admin/bookings
 *
 * Rendez-vous saisi par le commercant (appel telephonique, passage en boutique).
 * Plus souple que la reservation en ligne : les prestations et les personnes en
 * pause sont autorisees, et le delai minimum ne s'applique pas.
 *
 * ⚠️ LES COORDONNEES NE SONT PAS VALIDEES ICI, ET C'EST VOULU. La reservation
 *    en ligne, elle, exige un telephone reconnaissable (src/lib/coordonnees.js)
 *    parce qu'elle vient d'un inconnu et que ce numero est le seul moyen de le
 *    rappeler. Ici, c'est le commercant qui tape, et il tape ce qu'il a : « le
 *    monsieur de la rue Neuve » sans numero, un poste interne a quatre
 *    chiffres, un numero note a moitie pendant l'appel. Lui refuser sa propre
 *    saisie parce qu'elle ne rentre pas dans un format serait lui donner du
 *    travail pour rien — c'est son agenda, pas le notre.
 *
 * `force: true` POSE LE RENDEZ-VOUS SUR UNE HEURE DEJA OCCUPEE. Voir la note
 * sur `forcage()` : c'est une adresse d'espace commercant, et la regle du
 * doublement est la meme ici et au deplacement.
 */
bookingsRouter.post('/admin/bookings', requireAdmin, async (req, res, next) => {
  try {
    const { date, start, serviceId } = req.body ?? {};
    const forcer = forcage(req);

    const nom = texte(req.body?.name, 120);
    const telephone = texte(req.body?.phone, 40);
    const courriel = texte(req.body?.email, 160);
    const remarques = texte(req.body?.notes, 500);

    if (!isValidIso(date)) return refus(res, 400, 'Date invalide.');
    if (!Number.isInteger(start) || start < 0 || start > 1439) {
      return refus(res, 400, 'Heure invalide.');
    }
    if (!nom) return refus(res, 400, 'Le nom est obligatoire.');

    const prestation = await loadService(serviceId);
    if (!prestation) return refus(res, 404, 'Prestation inconnue.');

    const equipe = await resoudreEquipe(prestation, identifiantOptionnel(req.body?.staffId), {
      tolererEnPause: true,
    });
    if (equipe.erreur) return refus(res, equipe.erreur.code, equipe.erreur.message);

    const [settings, horaires] = await Promise.all([loadSettings(), loadOpeningHours()]);
    const duree = prestation.durationMin;

    const verdict = isBookableStart({
      date,
      startMin: start,
      durationMin: duree,
      day: horaires[weekdayOf(date)],
      settings,
      ignorerDelai: true,
    });
    if (!verdict.ok) return refus(res, 409, verdict.raison);

    const cree = await prisma.$transaction(async (tx) => {
      const dejaPris = await tx.booking.findMany({ where: { date, ...OCCUPENT } });

      let attribution = attribuer({
        eligibles: equipe.eligibles,
        reservations: dejaPris,
        startMin: start,
        durationMin: duree,
        day: horaires[weekdayOf(date)],
        prestation,
      });

      // >>> LE DOUBLEMENT VOLONTAIRE. <<< `attribuer()` n'a trouve personne de
      // libre ; avec `force`, on pose quand meme, sur la personne EXPLICITEMENT
      // demandee et jamais sur une autre.
      //
      // ⚠️ « PEU IMPORTE » NE SE FORCE PAS. Le doublement dit « celui-la prend
      //    deux clients a 15h » : il nomme forcement quelqu'un. Sans personne
      //    designee, la ligne posee occuperait TOUT LE MONDE (voir le champ
      //    `staffId` du schema) — on fermerait le creneau pour l'equipe entiere
      //    au lieu de le doubler pour une seule. Sur un commerce SANS equipe,
      //    en revanche, `eligibles` est vide et `staffId: null` est la seule
      //    valeur juste : il n'y a qu'un agenda, et c'est bien lui qu'on double.
      if (!attribution && forcer && equipe.eligibles.length <= 1) {
        attribution = {
          staffId: equipe.eligibles[0]?.id ?? null,
          priceCents: prestation.priceCents,
        };
      }

      if (!attribution) return null;

      return tx.booking.create({
        data: {
          kind: 'appt',
          date,
          startMin: start,
          durationMin: duree,
          serviceId: prestation.id,
          staffId: attribution.staffId,
          priceCents: attribution.priceCents,
          customerName: nom,
          customerPhone: telephone,
          customerEmail: courriel,
          notes: remarques,
          source: 'phone',
        },
      });
    });

    // Le refus NOMME la raison quand c'est le forçage qui n'a pas pu aboutir :
    // « déjà occupé » serait faux, puisque le commerçant vient précisément de
    // dire qu'il le savait.
    if (!cree) {
      return refus(res, 409, forcer && equipe.eligibles.length > 1
        ? "Choisissez avec qui avant de forcer : sans personne nommée, le rendez-vous occuperait toute l'équipe."
        : 'Ce créneau est déjà occupé.');
    }

    res.status(201).json(toApiBooking(cree));
  } catch (erreur) {
    next(erreur);
  }
});

/**
 * PATCH /api/admin/bookings/:id  { staffId?, date?, start?, serviceId?, force? }
 *
 * DEPLACE UN RENDEZ-VOUS, ou le confie a quelqu'un d'autre. Les deux passent
 * par ici, et c'est le meme geste vu de l'agenda : « Madame Dupont passe a 15 h
 * au lieu de 14 h », « finalement ce sera avec Remi ».
 *
 * >>> UN DEPLACEMENT N'EST PAS UNE SUPPRESSION SUIVIE D'UNE CREATION. <<<
 *
 * C'etait pourtant le seul chemin possible, faute de cette adresse cote
 * interface, et il cassait une chaine entiere en silence : le rendez-vous
 * recree recevait une NOUVELLE reference et un NOUVEAU jeton, si bien que la
 * reference notee par la cliente ne fonctionnait plus sur /annuler, que le
 * bandeau « Votre rendez-vous » de son telephone pointait dans le vide, et que
 * la ligne repassait en `source: 'phone'` — faussant la statistique de
 * provenance du tableau de bord. La cliente voyait son rendez-vous disparaitre
 * pendant que le commercant croyait l'avoir simplement decale.
 *
 * `id`, `reference`, `cancelToken`, `source` et `createdAt` sont donc
 * CONSERVES : c'est tout l'interet de l'operation, et un `update` partiel n'y
 * touche pas. Ne jamais les ajouter aux champs ecrits plus bas.
 *
 * CHAQUE CHAMP EST FACULTATIF, ET SEULS LES CHAMPS PRESENTS CHANGENT. Une
 * requete `{ staffId: null }` rend le rendez-vous a personne sans deplacer quoi
 * que ce soit ; une requete `{ date, start }` le decale sans toucher a qui s'en
 * occupe. C'est la CLE qui compte, pas sa valeur — `staffId: null` est un ordre,
 * `staffId` absent n'en est pas un.
 *
 * ⚠️ `start` EST LE VOCABULAIRE DU SITE, `startMin` CELUI DE LA BASE. Les deux
 *    sont acceptes ici parce que les deux se lisent dans le depot : le site
 *    envoie `start` (POST /api/bookings), la base stocke `startMin`. N'en
 *    accepter qu'un aurait fait echouer l'autre SANS UN MOT — un champ inconnu
 *    est ignore en silence, et le rendez-vous serait revenu inchange avec un
 *    honnete 200.
 *
 * `force: true` DEPLACE SUR UN CRENEAU DEJA OCCUPE. Voir `forcage()` pour la
 * raison et pour la portee : c'est un geste de commercant, il n'existe que
 * derriere `requireAdmin`, et il ne leve QUE le controle d'occupation. Le refus
 * de la date passee, celui d'une periode bloquee et celui d'un rendez-vous deja
 * annule par le client restent entiers — ceux-la ne disent pas « c'est pris »,
 * ils disent « ce n'est pas ce geste-la ».
 */
bookingsRouter.patch('/admin/bookings/:id', requireAdmin, async (req, res, next) => {
  try {
    const rendezVous = await prisma.booking.findUnique({ where: { id: req.params.id } });
    if (!rendezVous) return refus(res, 404, 'Rendez-vous introuvable.');

    const corps = req.body ?? {};
    const demande = (cle) => Object.prototype.hasOwnProperty.call(corps, cle);
    const forcer = forcage(req);

    // --- CE QUI CHANGE, ET CE QUI RESTE -------------------------------------

    const staffId = demande('staffId') ? identifiantOptionnel(corps.staffId) : rendezVous.staffId;

    const changeJour = demande('date');
    if (changeJour && !isValidIso(corps.date)) return refus(res, 400, 'Date invalide.');
    const date = changeJour ? corps.date : rendezVous.date;

    const cleHeure = demande('start') ? 'start' : (demande('startMin') ? 'startMin' : null);
    const changeHeure = cleHeure !== null;
    if (changeHeure) {
      const valeur = corps[cleHeure];
      if (!Number.isInteger(valeur) || valeur < 0 || valeur > 1439) {
        return refus(res, 400, 'Heure invalide.');
      }
    }
    const startMin = changeHeure ? corps[cleHeure] : rendezVous.startMin;

    const changePrestation = demande('serviceId') && corps.serviceId !== rendezVous.serviceId;

    // Le deplacement proprement dit : tout ce qui touche a la case occupee dans
    // l'agenda. Changer la seule personne n'en est pas un — et la distinction
    // decide du controle applique plus bas, qui n'est pas le meme.
    const deplace = changeJour || changeHeure || changePrestation;

    if (deplace && rendezVous.kind !== 'appt') {
      return refus(res, 409, 'Une période bloquée ne se déplace pas : levez-la, puis reposez-la.');
    }
    if (deplace && rendezVous.annuleLe) {
      return refus(res, 409, 'Ce rendez-vous a été annulé par le client.');
    }

    // --- LA PRESTATION, ET CE QU'ELLE ENTRAINE ------------------------------
    //
    // Changer de prestation change la DUREE et le TARIF. Tous deux sont recopies
    // depuis la prestation et jamais recus de la requete : meme regle qu'a la
    // creation, et pour la meme raison.
    //
    // ⚠️ LE TARIF EST CELUI DE LA PRESTATION, PAS DE LA PERSONNE. Le depot a
    //    connu un tarif par personne pendant une demi-journee
    //    (migration 20260804010708_tarif_par_personne), retire par la suivante
    //    le jour meme (20260804014224_photo_equipe_et_tarif_unique). Il n'y a
    //    donc rien a lire du cote de `staffId` : une coupe vaut le meme prix
    //    pour tout le monde, et `attribuer()` en dit autant a la creation.
    const serviceId = demande('serviceId') ? identifiantOptionnel(corps.serviceId) : rendezVous.serviceId;

    let prestation = null;
    if (serviceId) {
      // En pause y compris : cote commercant, une prestation retiree du site
      // reste calable a la main, comme a la creation.
      prestation = await loadService(serviceId);
      if (!prestation) return refus(res, 404, 'Prestation inconnue.');
    }

    // Sans changement de prestation, la duree et le tarif CONVENUS ne bougent
    // pas — meme si le commerce a change ses prix depuis. C'est la regle du
    // champ `priceCents` (voir prisma/schema.prisma) : le rendez-vous garde ce
    // qui avait ete annonce a la cliente.
    //
    // ⚠️ `prestation` EST TESTE, ET PAS SEULEMENT `changePrestation`. Les deux ne
    //    disent pas la meme chose : `{ serviceId: null }` DETACHE la prestation
    //    — c'est un changement, mais il n'y a plus rien a lire. Sur le seul
    //    `changePrestation`, la ligne suivante dereferencait `null` et rendait
    //    500 la ou le rendez-vous doit simplement garder sa duree convenue.
    const durationMin = changePrestation && prestation ? prestation.durationMin : rendezVous.durationMin;
    const priceCents = changePrestation && prestation ? prestation.priceCents : rendezVous.priceCents;

    // --- LA PERSONNE --------------------------------------------------------

    if (staffId) {
      const connue = await prisma.staff.findUnique({ where: { id: staffId } });
      if (!connue) return refus(res, 404, 'Personne inconnue.');

      // La prestation peut ne pas etre de son ressort. On le verifie, mais on
      // reste tolerant comme partout cote commercant : une personne en pause
      // est acceptee, c'est le salon qui decide.
      if (prestation) {
        const equipe = await loadStaff({ includeInactive: true });
        const autorisee = eligibleStaff(prestation, equipe).some((p) => p.id === staffId);
        if (!autorisee) return refus(res, 409, "Cette personne n'assure pas cette prestation.");
      }
    }

    // --- LES HORAIRES : ON PREVIENT, ON N'INTERDIT PAS ----------------------
    //
    // Un rendez-vous cale hors des heures d'ouverture, pendant la pause, ou en
    // dehors de la grille des creneaux est ACCEPTE, et la reponse porte alors un
    // `warning`. C'est la ligne de conduite de tout le cote commercant : il
    // connait son commerce mieux que nous, et un client qui insiste pour venir a
    // 19h15 un mardi n'est pas une erreur de saisie. L'ecran, lui, ne propose
    // que des creneaux valides — cette tolerance ne sert qu'a celui qui appelle
    // l'API directement.
    //
    // ⚠️ ELLE EST PLUS LARGE QUE CELLE DE POST /api/admin/bookings, qui refuse
    //    ces memes cas. La difference est assumee : a la creation, un creneau
    //    hors horaires est presque toujours une faute de frappe, alors qu'ici il
    //    y a deja un rendez-vous et un client au telephone. Un refus ferait
    //    supprimer-puis-recreer, c'est-a-dire exactement ce que cette adresse
    //    existe pour eviter.
    //
    // Une seule chose reste refusee : la DATE PASSEE. Deplacer un rendez-vous
    // vers hier ne repond a aucune demande, et fausserait le taux de remplissage
    // comme le pointage.
    // ⚠️ ON NE FORCE PAS SUR « PEU IMPORTE » QUAND IL Y A UNE EQUIPE. Un
    //    rendez-vous sans personne occupe TOUT LE MONDE (voir le champ `staffId`
    //    du schema) : le doubler ainsi fermerait le creneau pour l'equipe
    //    entiere au lieu de le doubler pour une seule personne — l'inverse de ce
    //    qu'on vient de demander. Le refus le dit, plutot que de laisser tomber
    //    sur « ce creneau est deja occupe », qui serait faux : le commercant
    //    vient justement de dire qu'il le savait.
    if (forcer && !staffId) {
      const equipe = await prisma.staff.count({ where: { active: true } });
      if (equipe > 0) {
        return refus(res, 409,
          "Choisissez avec qui avant de forcer : sans personne nommée, le rendez-vous occuperait toute l'équipe.");
      }
    }

    let avertissement = null;
    if (deplace) {
      if (date < todayIso()) return refus(res, 409, 'Cette date est déjà passée.');

      const [settings, horaires] = await Promise.all([loadSettings(), loadOpeningHours()]);
      const verdict = isBookableStart({
        date,
        startMin,
        durationMin,
        day: horaires[weekdayOf(date)],
        settings,
        ignorerDelai: true,
      });
      if (!verdict.ok) avertissement = verdict.raison;
    }

    // --- L'ECRITURE ---------------------------------------------------------
    //
    // Le controle « est-ce libre ? » et l'ecriture d'un seul bloc, comme a la
    // creation : les separer laisserait deux deplacements simultanes aboutir
    // sur le meme creneau.
    const maj = await prisma.$transaction(async (tx) => {
      if (deplace) {
        // >>> SOI-MEME EXCLU. <<< Sans `id: { not: … }`, un rendez-vous se
        // verrait comme un obstacle : le reposer sur son propre creneau — pour
        // n'en changer que la prestation — serait refuse, et rendre son heure
        // d'origine apres une hesitation deviendrait impossible.
        const occupants = await tx.booking.findMany({
          where: { date, id: { not: rendezVous.id }, ...OCCUPENT },
        });

        // `reservationsDe` ajoute les rendez-vous SANS personne aux siens : un
        // rendez-vous non attribue occupe tout le monde (voir le schema). Sans
        // personne du tout — commerce a agenda unique — c'est toute la liste
        // qui compte.
        const contre = staffId ? reservationsDe(occupants, staffId) : occupants;

        // `force` passe outre l'occupation, et rien d'autre : voir `forcage()`.
        // Le refus de la date passee, celui d'une periode bloquee et celui d'un
        // rendez-vous deja annule sont plus haut et restent entiers — ils ne
        // disent pas « c'est pris », ils disent « ce n'est pas ce geste-la ».
        if (!forcer && !isFree(contre, startMin, durationMin)) return null;
      } else if (staffId) {
        // ATTENTION : on ne regarde ICI que ce qui est DEJA attribue a cette
        // personne — pas les rendez-vous sans personne, contrairement au bloc
        // ci-dessus.
        //
        // La regle "sans personne = occupe tout le monde" est la bonne pour
        // decider si un creneau est libre ; elle est fausse pour une simple
        // reattribution. Deux rendez-vous non attribues qui se chevauchent (cas
        // courant apres le passage d'un commerce seul a une equipe : ils
        // etaient sur un agenda unique) se bloqueraient alors l'un l'autre, et
        // AUCUN des deux ne pourrait plus etre attribue a qui que ce soit.
        // Impasse — dans exactement la situation que cette adresse existe pour
        // reparer.
        //
        // Rien n'est perdu : le seul risque a ecarter est de poser deux
        // rendez-vous sur la MEME personne, et c'est ce que ce filtre verifie.
        // Les orphelins restants continuent par ailleurs de bloquer la
        // reservation de nouveaux creneaux, tant qu'ils n'ont pas ete tries.
        const siens = await tx.booking.findMany({
          where: { date, staffId, id: { not: rendezVous.id }, ...OCCUPENT },
        });
        if (!forcer && !isFree(siens, startMin, durationMin)) return null;
      }

      return tx.booking.update({
        where: { id: rendezVous.id },
        data: { staffId, date, startMin, durationMin, serviceId, priceCents },
      });
    });

    if (!maj) {
      return refus(res, 409, deplace
        ? "Ce créneau est déjà occupé. Choisissez-en un autre."
        : 'Cette personne a déjà un rendez-vous sur ce créneau.');
    }

    const reponse = toApiBooking(maj);

    // Ce qui a change, pour que l'ecran nomme l'avant et l'apres sans avoir eu a
    // en garder une copie de son cote.
    if (deplace) {
      reponse.movedFrom = {
        date: rendezVous.date,
        start: rendezVous.startMin,
        staffId: rendezVous.staffId,
        serviceId: rendezVous.serviceId,
      };
    }
    if (avertissement) reponse.warning = avertissement;

    res.json(reponse);

    // >>> LE POINT D'APPEL DE LA NOTIFICATION, ET IL N'EST PLUS VIDE. <<<
    //
    // Le client ne savait pas que son rendez-vous avait bouge : tant qu'aucun
    // canal n'etait allume, c'etait au commercant de decrocher, et l'ecran lui
    // rappelait le numero pour cela. Le courriel prend desormais le relais
    // QUAND une adresse a ete laissee — le rappel de l'ecran reste, parce que
    // le champ est facultatif et que beaucoup de rendez-vous n'en portent pas.
    //
    // ⚠️ SEULEMENT SI LE CRENEAU A BOUGE. Rendre un rendez-vous a quelqu'un
    //    d'autre sans le decaler ne change rien pour le client : lui ecrire
    //    « votre rendez-vous a été déplacé » alors qu'il est a la meme heure
    //    ferait ouvrir un courriel pour rien, et douter du suivant.
    if (deplace) {
      prevenirLeClient('deplacement', {
        rendezVous: maj,
        avant: { date: rendezVous.date, start: rendezVous.startMin },
      });
    }
  } catch (erreur) {
    next(erreur);
  }
});

/** DELETE /api/admin/bookings/:id — annulation d'un rendez-vous. */
bookingsRouter.delete('/admin/bookings/:id', requireAdmin, async (req, res, next) => {
  try {
    const existe = await prisma.booking.findUnique({ where: { id: req.params.id } });
    if (!existe) return refus(res, 404, 'Rendez-vous introuvable.');

    await prisma.booking.delete({ where: { id: req.params.id } });
    res.json({ ok: true, id: req.params.id });
  } catch (erreur) {
    next(erreur);
  }
});

/**
 * POST /api/admin/day-block  { date, to?, staffId? }
 *
 * Rend une journee entiere indisponible a la reservation en ligne. Le blocage
 * couvre toute la plage d'ouverture ; les rendez-vous deja pris ce jour-la sont
 * conserves (le commercant les annule un par un s'il le souhaite).
 *
 * `to` etend a une periode (conges, formation) : une ligne par jour ouvert.
 *
 * Deux blocages differents, distingues par le seul `staffId` :
 *   - sans      : le COMMERCE est ferme ce jour-la, personne ne peut rien y
 *                 prendre. C'est le comportement d'origine ;
 *   - avec      : cette personne-la est absente (conges, formation), le reste
 *                 de l'equipe continue de recevoir.
 */
bookingsRouter.post('/admin/day-block', requireAdmin, async (req, res, next) => {
  try {
    const { date } = req.body ?? {};
    if (!isValidIso(date)) return refus(res, 400, 'Date invalide.');

    // `to` couvre une periode : une semaine de conges, une formation. Rien de
    // plus qu'une boucle — UNE LIGNE DE BLOCAGE PAR JOUR. Un modele a plage de
    // dates aurait oblige a reprendre tout le calcul des disponibilites, et
    // aurait empeche de rouvrir un jour isole au milieu d'une periode.
    const fin = req.body?.to === undefined || req.body?.to === null ? date : req.body.to;
    if (!isValidIso(fin)) return refus(res, 400, 'Date de fin invalide.');
    if (fin < date) return refus(res, 400, 'La date de fin précède la date de début.');
    if (fin > addDaysIso(date, FENETRE_MAX_JOURS)) {
      return refus(res, 400, `La période demandée dépasse ${FENETRE_MAX_JOURS} jours.`);
    }

    const staffId = identifiantOptionnel(req.body?.staffId);
    if (staffId) {
      const connue = await prisma.staff.findUnique({ where: { id: staffId } });
      if (!connue) return refus(res, 404, 'Personne inconnue.');
    }

    const horaires = await loadOpeningHours();

    // ⚠️ LE MOTIF SAISI EST CONSERVE, ET IL NE L'ETAIT PAS.
    //
    // Le formulaire proposait « Motif (facultatif) », le commercant y ecrivait
    // « Conges » ou « Formation Karim »... et cette ligne ecrasait sa saisie par
    // un libelle fixe. L'agenda affichait ensuite « Journee bloquee » pour tout,
    // et le motif n'etait visible nulle part. Un champ qu'on propose, qu'on
    // remplit et qu'on jette est pire que pas de champ du tout.
    //
    // Le libelle de repli, lui, s'ecrit en francais : « Journee bloquee » sans
    // accents etait la seule chaine du produit a s'en passer.
    const motif = texte(req.body?.notes, 80) || (staffId ? 'Absence' : 'Journée bloquée');

    // --- LES RENDEZ-VOUS QUE LE BLOCAGE VA RECOUVRIR ------------------------
    //
    // >>> C'EST LE MOMENT OU LE PRODUIT REND SON PLUS GRAND SERVICE. <<<
    //
    // Poser des conges sur une semaine deja remplie ne disait rien : le blocage
    // s'ajoutait a cote des rendez-vous, sans hierarchie ni signalement, et le
    // commercant decouvrait trois clients a rappeler le jour meme — ou pas.
    //
    // La demande est donc REFUSEE tant qu'elle n'est pas confirmee, et le refus
    // porte la liste : nom, heure, prestation, personne, telephone. C'est
    // « voila les trois personnes a rappeler », qui est exactement ce qu'on
    // attend d'un agenda.
    //
    // Un blocage nominatif ne recouvre QUE les rendez-vous de cette personne :
    // les autres continuent de recevoir. Une fermeture du commerce les recouvre
    // tous, y compris ceux que personne n'assure encore.
    const conflits = await prisma.booking.findMany({
      where: {
        kind: 'appt',
        date: { gte: date, lte: fin },
        ...(staffId ? { staffId } : {}),
        ...OCCUPENT,
      },
      orderBy: [{ date: 'asc' }, { startMin: 'asc' }],
    });

    if (conflits.length && req.body?.confirmConflicts !== true) {
      return res.status(409).json({
        error: conflits.length > 1
          ? `${conflits.length} rendez-vous sont déjà pris sur cette période.`
          : 'Un rendez-vous est déjà pris sur cette période.',
        conflicts: conflits.map((b) => toApiBooking(b)),
      });
    }

    // Le second choix explicite : les annuler en bloc. Avant les blocages, pour
    // qu'un echec plus bas ne laisse pas un agenda a moitie vide.
    if (conflits.length && req.body?.cancelConflicts === true) {
      await prisma.booking.deleteMany({ where: { id: { in: conflits.map((b) => b.id) } } });
    }

    // Les jours de fermeture habituelle sont simplement sautes : poser des
    // conges du lundi au dimanche ne doit pas echouer parce que le commerce
    // ferme le lundi.
    const poses = [];
    let ignores = 0;

    for (let date_ = date; date_ <= fin; date_ = addDaysIso(date_, 1)) {
      const jour = horaires[weekdayOf(date_)];
      if (!jour || jour.closed) { ignores++; continue; }

      const dejaBloque = await prisma.booking.findFirst({
        where: { date: date_, kind: 'block', staffId },
      });
      if (dejaBloque) { poses.push(dejaBloque); continue; }

      poses.push(await prisma.booking.create({
        data: {
          kind: 'block',
          date: date_,
          startMin: jour.openMin,
          durationMin: jour.closeMin - jour.openMin,
          staffId,
          notes: motif,
          source: 'phone',
        },
      }));
    }

    if (!poses.length) return refus(res, 409, 'Le commerce est déjà fermé sur toute cette période.');

    // Une seule journee : on repond comme avant, avec le blocage lui-meme.
    // C'est ce qui laisse l'agenda inchange pour le cas courant.
    if (date === fin) return res.status(201).json(toApiBooking(poses[0]));

    res.status(201).json({ blocks: poses.map((b) => toApiBooking(b)), skipped: ignores });
  } catch (erreur) {
    next(erreur);
  }
});

/**
 * GET /api/admin/day-block/:id — le blocage, ET LA PERIODE A LAQUELLE IL TIENT.
 *
 * >>> POURQUOI CETTE ADRESSE EXISTE. <<< Un blocage n'est pas une plage de
 * dates en base : c'est UNE LIGNE PAR JOUR (voir le POST ci-dessus). Le
 * commercant, lui, a saisi « du 12 au 22 aout, conges » et c'est ce qu'il
 * s'attend a relire — et a lever d'un geste. Sans cette adresse, la fiche du
 * lot 2 afficherait « le 15 aout » d'une semaine de conges, et le bouton
 * « Lever ce blocage » n'en rouvrirait qu'un jour sur onze.
 *
 * ⚠️ LES JOURS DE FERMETURE HABITUELLE NE COUPENT PAS LA PERIODE. Poser des
 *    conges du samedi au mardi n'ecrit rien le dimanche ni le lundi — le
 *    commerce y est deja ferme. Remonter la periode doit donc les enjamber,
 *    sans quoi une semaine de conges se lirait comme quatre blocages separes.
 */
bookingsRouter.get('/admin/day-block/:id', requireAdmin, async (req, res, next) => {
  try {
    const bloc = await prisma.booking.findUnique({ where: { id: req.params.id } });
    if (!bloc || bloc.kind !== 'block') return refus(res, 404, 'Blocage introuvable.');

    const horaires = await loadOpeningHours();
    const ferme = (iso) => {
      const jour = horaires[weekdayOf(iso)];
      return !jour || jour.closed;
    };

    // Tout ce qui pourrait appartenir a la meme periode, en une seule requete :
    // meme personne (ou meme absence de personne), autour de ce jour-la.
    const voisins = await prisma.booking.findMany({
      where: {
        kind: 'block',
        staffId: bloc.staffId,
        date: {
          gte: addDaysIso(bloc.date, -FENETRE_MAX_JOURS),
          lte: addDaysIso(bloc.date, FENETRE_MAX_JOURS),
        },
      },
    });

    // Le motif fait partie de l'identite d'une periode : deux blocages voisins
    // qui ne disent pas la meme chose sont deux periodes.
    const parJour = new Map(voisins.filter((b) => b.notes === bloc.notes).map((b) => [b.date, b]));

    /** Le bord de la periode dans un sens, en enjambant les jours fermes. */
    const bord = (pas) => {
      let extreme = bloc.date;
      let curseur = bloc.date;

      for (let n = 0; n < FENETRE_MAX_JOURS; n++) {
        curseur = addDaysIso(curseur, pas);
        if (ferme(curseur)) continue;
        if (!parJour.has(curseur)) break;
        extreme = curseur;
      }
      return extreme;
    };

    const du = bord(-1);
    const au = bord(1);

    res.json({
      ...toApiBooking(bloc),
      from: du,
      to: au,
      // Le nombre de journees reellement bloquees, et non l'ecart entre les deux
      // dates : c'est ce qu'on annonce avant de tout lever.
      days: [...parJour.keys()].filter((d) => d >= du && d <= au).length,
    });
  } catch (erreur) {
    next(erreur);
  }
});

/**
 * DELETE /api/admin/day-block?date=AAAA-MM-JJ[&to=][&staffId=] — retire le blocage.
 *
 * Sans `staffId`, seule la fermeture du commerce est levee : les absences
 * individuelles de la journee restent en place. Lever tout d'un coup fermerait
 * la porte a l'erreur inverse — rouvrir un jour de conges sans s'en apercevoir.
 *
 * `to` leve toute une periode d'un coup, mais reste facultatif : un seul jour
 * de conges peut toujours etre rouvert au milieu des autres.
 */
bookingsRouter.delete('/admin/day-block', requireAdmin, async (req, res, next) => {
  try {
    const { date } = req.query;
    if (!isValidIso(date)) return refus(res, 400, 'Date invalide.');

    const fin = req.query.to === undefined ? date : req.query.to;
    if (!isValidIso(fin)) return refus(res, 400, 'Date de fin invalide.');
    if (fin < date) return refus(res, 400, 'La date de fin précède la date de début.');

    const staffId = identifiantOptionnel(req.query.staffId);

    const { count } = await prisma.booking.deleteMany({
      where: { date: { gte: date, lte: fin }, kind: 'block', staffId },
    });
    res.json({ ok: true, date, to: fin, staffId, removed: count });
  } catch (erreur) {
    next(erreur);
  }
});
