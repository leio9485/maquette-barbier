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
} from '../config.js';
import { prisma } from '../db.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { OCCUPENT } from '../lib/annulation.js';
import { referenceLibre } from '../lib/reference.js';
import { validerNom, normaliserTelephone, validerCourriel } from '../lib/coordonnees.js';
import { limiteApplicable, passageDisponible, noterPassage } from '../lib/rateLimit.js';
import { isValidIso, weekdayOf, todayIso, addDaysIso } from '../lib/time.js';
import {
  loadSettings,
  loadOpeningHours,
  loadStaff,
  loadService,
  eligibleStaff,
  computeSlots,
  freeStaffAt,
  pickStaff,
  isBookableStart,
  isFree,
} from '../lib/availability.js';
import { etatDuMoment } from '../lib/etat.js';

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
  { nom: 'tentatives', max: RESERVATIONS_TENTATIVES_MAX, fenetreMs: RESERVATIONS_FENETRE_MS },
  { nom: 'rafale', max: RESERVATIONS_RAFALE_MAX, fenetreMs: RESERVATIONS_RAFALE_MS },
  { nom: 'heure', max: RESERVATIONS_HEURE_MAX, fenetreMs: RESERVATIONS_FENETRE_MS },
];

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

      noterPassage(cleDe('tentatives', req.ip), { fenetreMs: RESERVATIONS_FENETRE_MS });
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
 */
bookingsRouter.post('/admin/bookings', requireAdmin, async (req, res, next) => {
  try {
    const { date, start, serviceId } = req.body ?? {};

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
          notes: remarques,
          source: 'phone',
        },
      });
    });

    if (!cree) return refus(res, 409, 'Ce créneau est déjà occupé.');

    res.status(201).json(toApiBooking(cree));
  } catch (erreur) {
    next(erreur);
  }
});

/**
 * PATCH /api/admin/bookings/:id  { staffId }
 *
 * Confie un rendez-vous a quelqu'un, ou le rend a personne (`staffId: null`).
 *
 * Sert surtout au passage d'un commerce seul a une equipe : les rendez-vous
 * pris avant n'ont pas de personne attribuee et occupent donc TOUT LE MONDE.
 * Sans cette adresse, l'agenda paraitrait complet et il faudrait tout ressaisir.
 *
 * Le controle "cette personne est-elle libre a cette heure" se fait dans la
 * transaction, comme a la creation — et en s'excluant soi-meme, sans quoi un
 * rendez-vous se verrait toujours comme un obstacle.
 */
bookingsRouter.patch('/admin/bookings/:id', requireAdmin, async (req, res, next) => {
  try {
    const rendezVous = await prisma.booking.findUnique({ where: { id: req.params.id } });
    if (!rendezVous) return refus(res, 404, 'Rendez-vous introuvable.');

    const staffId = identifiantOptionnel(req.body?.staffId);

    if (staffId) {
      const connue = await prisma.staff.findUnique({ where: { id: staffId } });
      if (!connue) return refus(res, 404, 'Personne inconnue.');

      // La prestation peut ne pas etre de son ressort. On le verifie, mais on
      // reste tolerant comme partout cote commercant : une personne en pause
      // est acceptee, c'est le salon qui decide.
      if (rendezVous.serviceId) {
        const prestation = await loadService(rendezVous.serviceId);
        const equipe = await loadStaff({ includeInactive: true });
        const autorisee = eligibleStaff(prestation, equipe).some((p) => p.id === staffId);
        if (!autorisee) return refus(res, 409, "Cette personne n'assure pas cette prestation.");
      }
    }

    const maj = await prisma.$transaction(async (tx) => {
      if (staffId) {
        // ATTENTION : on ne regarde ICI que ce qui est DEJA attribue a cette
        // personne — pas les rendez-vous sans personne, contrairement au reste
        // du fichier.
        //
        // La regle "sans personne = occupe tout le monde" est la bonne pour
        // decider si un creneau est libre ; elle est fausse ici. Deux
        // rendez-vous non attribues qui se chevauchent (cas courant apres le
        // passage d'un commerce seul a une equipe : ils etaient sur un agenda
        // unique) se bloqueraient alors l'un l'autre, et AUCUN des deux ne
        // pourrait plus etre attribue a qui que ce soit. Impasse — dans
        // exactement la situation que cette adresse existe pour reparer.
        //
        // Rien n'est perdu : le seul risque a ecarter est de poser deux
        // rendez-vous sur la MEME personne, et c'est ce que ce filtre verifie.
        // Les orphelins restants continuent par ailleurs de bloquer la
        // reservation de nouveaux creneaux, tant qu'ils n'ont pas ete tries.
        const siens = await tx.booking.findMany({
          where: { date: rendezVous.date, staffId, id: { not: rendezVous.id }, ...OCCUPENT },
        });
        if (!isFree(siens, rendezVous.startMin, rendezVous.durationMin)) return null;
      }

      return tx.booking.update({ where: { id: rendezVous.id }, data: { staffId } });
    });

    if (!maj) return refus(res, 409, 'Cette personne a déjà un rendez-vous sur ce créneau.');

    res.json(toApiBooking(maj));
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
          notes: staffId ? 'Absence' : 'Journee bloquee',
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
