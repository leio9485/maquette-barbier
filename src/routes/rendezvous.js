// ---------------------------------------------------------------------------
// RETROUVER, ANNULER OU DEPLACER SON RENDEZ-VOUS
//
// Le site ecrivait « notez la reference : elle suffit a annuler ». C'etait la
// seule phrase fausse du site. Le jeton d'annulation ne survivait qu'en memoire
// vive, l'onglet ferme le perdait, et aucune adresse ne savait repartir de la
// reference. Ces trois adresses-ci sont ce qui rend la phrase vraie.
//
// DEUX FACONS DE PROUVER QUE LE RENDEZ-VOUS EST LE SIEN, et une seule raison a
// cette dualite :
//
//   reference + quatre derniers chiffres du telephone
//       Ce qu'on saisit sur /annuler quand on revient sans son courriel. La
//       reference seule ne suffit PAS : trente bits s'enumerent, et une
//       enumeration reussie revelerait le nom et l'horaire du rendez-vous d'un
//       tiers. C'est une fuite de donnees personnelles, pas un desagrement.
//
//   reference + jeton
//       Le lien direct, celui du courriel. Le jeton fait 256 bits : il est a
//       lui seul une preuve, et ne demande donc rien de plus. C'est ce qui
//       permet au lien de fonctionner d'un clic, depuis un telephone, sans
//       avoir a se souvenir de quoi que ce soit.
//
// AUCUN ORACLE. Reference inconnue, mauvais telephone, mauvais jeton, blocage
// pose par le salon : une seule et meme reponse, au mot et au code HTTP pres.
// Sans cela, les refus eux-memes diraient quelles references existent — et une
// reference qui existe est un rendez-vous dont on peut ensuite chercher le
// telephone a quatre chiffres pres, soit dix mille essais.
//
// EN REVANCHE, UNE FOIS LA PREUVE FAITE, on parle clairement : « ce rendez-vous
// est deja passe », « il a deja ete annule ». Ces phrases-la ne se meritent
// qu'apres authentification, et elles n'apprennent alors rien a personne qui ne
// le sache deja.
// ---------------------------------------------------------------------------

import express from 'express';
import { timingSafeEqual } from 'node:crypto';

import { prisma } from '../db.js';
import { OCCUPENT } from '../lib/annulation.js';
import { normaliserReference } from '../lib/reference.js';
import { isRateLimited, recordFailure, resetFailures } from '../lib/rateLimit.js';
import { isValidIso, weekdayOf, todayIso } from '../lib/time.js';
import {
  loadSettings,
  loadOpeningHours,
  loadStaff,
  loadService,
  eligibleStaff,
  freeStaffAt,
  pickStaff,
  isBookableStart,
  isFree,
} from '../lib/availability.js';

export const rendezVousRouter = express.Router();

// --- La limitation des tentatives -----------------------------------------
//
// Cinq echecs par adresse et par quart d'heure. C'est severe compare aux
// cinquante de la page de connexion, et c'est voulu : ici le secret ne fait que
// trente bits plus quatre chiffres, la ou un mot de passe en vaut ce que vaut
// le mot de passe. Un client qui se trompe deux fois de suite reste tres loin
// du seuil ; un programme qui enumere le touche en une seconde.
//
// Seuls les ECHECS comptent (`recordFailure` n'est appele que sur refus) : un
// client qui cherche son rendez-vous, le regarde, puis l'annule, fait trois
// appels reussis et ne s'approche jamais du seuil.
//
// >>> LE LIEN DU COURRIEL N'EST PAS SOUMIS AU BLOCAGE, ET C'EST DELIBERE. <<<
//
// Le seuil porte sur l'adresse IP. Or une IP n'est pas une personne : derriere
// celle d'une box familiale, ou d'un operateur mobile qui en partage une entre
// des milliers d'abonnes, cinq erreurs de saisie ferment la porte a tout le
// monde pendant un quart d'heure. Un client qui clique sur le lien de son
// propre courriel n'a aucune raison d'en faire les frais.
//
// L'exemption ne coute RIEN en securite, et c'est ce qui la rend acceptable :
// pour en beneficier il faut presenter un jeton de 256 bits JUSTE. Un jeton
// faux est compte comme n'importe quel autre echec, et repousse le deblocage.
// Autrement dit, on n'est exempte qu'en prouvant qu'on ne devine pas.
//
// C'est aussi ce qui permet a un jeton valide de REMETTRE LE COMPTEUR A ZERO
// (`resetFailures` plus bas) : la personne legitime debloque sa propre ligne.

const MAX_ECHECS = 5;
const FENETRE_MS = 15 * 60 * 1000;

// --- Le refus unique -------------------------------------------------------

/**
 * LA reponse de refus. Une seule, pour tous les cas ou la preuve n'est pas
 * faite — y compris « cette reference n'existe pas ».
 *
 * Le message dit quoi verifier sans dire lequel des deux champs est en cause.
 */
const INTROUVABLE = 'Aucun rendez-vous ne correspond. Vérifiez la référence et le numéro de téléphone.';

/** Comparaison a duree constante, comme pour les jetons de session. */
function memeTexte(attendu, recu) {
  if (typeof attendu !== 'string' || typeof recu !== 'string') return false;

  const a = Buffer.from(attendu, 'utf8');
  const b = Buffer.from(recu, 'utf8');
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

/**
 * Les quatre derniers chiffres d'un numero, ou `null`.
 *
 * On ne garde que les chiffres avant de couper : « 06 39 98 14 07 »,
 * « 0639981407 » et « +33 6 39 98 14 07 » doivent donner les memes quatre
 * chiffres, sans quoi la facon dont le client a tape son numero le jour de la
 * reservation deciderait de sa capacite a annuler.
 */
function quatreDerniers(telephone) {
  if (typeof telephone !== 'string') return null;
  const chiffres = telephone.replace(/\D/g, '');
  return chiffres.length >= 4 ? chiffres.slice(-4) : null;
}

// --- L'authentification ----------------------------------------------------

/**
 * Retrouve le rendez-vous designe par la requete, ou dit pourquoi non.
 *
 * Renvoie `{ rendezVous }` ou `{ refus: { code, message } }`. L'appelant ne
 * decide de rien : c'est ici, a un seul endroit, que se joue la regle du
 * silence — trois causes de refus differentes sortent avec la meme phrase.
 *
 * ⚠️ NE FAIT AUCUNE DIFFERENCE entre les cas ; en particulier, un rendez-vous
 *    deja annule ou deja passe est retrouve NORMALEMENT. C'est l'appelant qui
 *    en tirera un message clair, une fois la preuve faite. Les melanger ici
 *    reviendrait a repondre « deja annule » a quelqu'un qui n'a rien prouve.
 */
async function authentifier(corps) {
  const reference = normaliserReference(corps?.reference);
  if (!reference) return { refus: { code: 404, message: INTROUVABLE } };

  const rendezVous = await prisma.booking.findUnique({ where: { reference } });

  // Un blocage pose par le salon n'a pas de reference, mais la regle est ecrite
  // plutot que supposee : seul un rendez-vous client pris en ligne se gere ici.
  if (!rendezVous || rendezVous.kind !== 'appt' || rendezVous.source !== 'online') {
    return { refus: { code: 404, message: INTROUVABLE } };
  }

  // Le lien direct du courriel : le jeton se suffit a lui-meme.
  const jeton = typeof corps?.jeton === 'string' ? corps.jeton : '';
  if (jeton) {
    if (rendezVous.cancelToken && memeTexte(rendezVous.cancelToken, jeton)) {
      return { rendezVous };
    }
    return { refus: { code: 404, message: INTROUVABLE } };
  }

  // La saisie a la main : reference + quatre derniers chiffres du telephone.
  const attendus = quatreDerniers(rendezVous.customerPhone);
  const recus = quatreDerniers(corps?.telephone);

  if (!attendus || !recus || !memeTexte(attendus, recus)) {
    return { refus: { code: 404, message: INTROUVABLE } };
  }

  return { rendezVous };
}

/**
 * Ce que le client a le droit de savoir de son propre rendez-vous.
 *
 * NI LE JETON, NI LE TELEPHONE, NI LE COURRIEL. Le premier parce qu'il n'a pas
 * a repartir dans une reponse obtenue avec quatre chiffres ; les deux autres
 * parce que quelqu'un qui aurait devine la reference ET les quatre chiffres
 * n'aurait pas a repartir avec le numero complet.
 */
function pourLeClient(rendezVous, prestation, personne) {
  return {
    reference: rendezVous.reference,
    date: rendezVous.date,
    start: rendezVous.startMin,
    duration: rendezVous.durationMin,
    price: rendezVous.priceCents === null || rendezVous.priceCents === undefined
      ? null
      : rendezVous.priceCents / 100,
    name: rendezVous.customerName,
    serviceId: rendezVous.serviceId,
    serviceName: prestation?.name ?? null,
    staffId: rendezVous.staffId,
    staffName: personne?.name ?? null,
    cancelledAt: rendezVous.annuleLe ? rendezVous.annuleLe.toISOString() : null,
    past: rendezVous.date < todayIso(),
  };
}

/** Le nom de la prestation et celui de la personne, pour le recapitulatif. */
async function habiller(rendezVous) {
  const [prestation, equipe] = await Promise.all([
    rendezVous.serviceId ? loadService(rendezVous.serviceId) : null,
    rendezVous.staffId ? loadStaff({ includeInactive: true }) : [],
  ]);
  const personne = equipe.find((p) => p.id === rendezVous.staffId) ?? null;
  return pourLeClient(rendezVous, prestation, personne);
}

/**
 * Le tour de garde commun aux trois adresses.
 *
 * Compte les echecs, refuse au-dela du seuil, et efface le compteur des qu'une
 * preuve est faite. Ecrit une fois, pose trois fois : c'est ce qui evite qu'une
 * des trois adresses parte sans compteur le jour ou on en ajoutera une
 * quatrieme.
 */
function garde(traitement) {
  return async (req, res, next) => {
    const cle = `rdv:${req.ip}`;

    try {
      // Le lien du courriel passe le blocage — mais seulement s'il porte un
      // jeton, et il devra encore prouver que ce jeton est le bon. Voir le
      // pave d'explication en tete de fichier.
      const parJeton = typeof req.body?.jeton === 'string' && req.body.jeton.length > 0;

      if (!parJeton) {
        const limite = isRateLimited(cle, { max: MAX_ECHECS });
        if (limite.bloque) {
          return res.status(429).json({
            error: `Trop de tentatives. Réessayez dans ${Math.ceil(limite.secondes / 60)} minutes.`,
          });
        }
      }

      const authentification = await authentifier(req.body);

      if (authentification.refus) {
        recordFailure(cle, { fenetreMs: FENETRE_MS });
        return res.status(authentification.refus.code).json({ error: authentification.refus.message });
      }

      resetFailures(cle);
      return await traitement(req, res, authentification.rendezVous);
    } catch (erreur) {
      next(erreur);
    }
  };
}

// --- Les trois adresses ----------------------------------------------------

/**
 * POST /api/rendez-vous/retrouver  { reference, telephone } | { reference, jeton }
 *
 * Le recapitulatif, avant toute action. C'est ce qui permet a la page de
 * demander « c'est bien celui-la ? » plutot que d'annuler sur parole : une
 * annulation ne se defait pas, et un client qui se trompe de reference doit
 * pouvoir s'en apercevoir avant, pas apres.
 */
rendezVousRouter.post('/rendez-vous/retrouver', garde(async (req, res, rendezVous) => {
  res.json({ rendezVous: await habiller(rendezVous) });
}));

/**
 * POST /api/rendez-vous/annuler  { reference, telephone } | { reference, jeton }
 *
 * L'annulation elle-meme. La preuve est refaite ici et n'est pas heritee de
 * l'appel precedent : ces adresses ne gardent aucun etat entre deux requetes,
 * et c'est ce qui les rend insensibles a un onglet laisse ouvert une heure.
 */
rendezVousRouter.post('/rendez-vous/annuler', garde(async (req, res, rendezVous) => {
  // Les deux cas ou l'on parle clairement, la preuve etant faite.
  if (rendezVous.annuleLe) {
    return res.status(409).json({
      error: 'Ce rendez-vous a déjà été annulé.',
      rendezVous: await habiller(rendezVous),
    });
  }

  if (rendezVous.date < todayIso()) {
    return res.status(409).json({
      error: 'Ce rendez-vous est déjà passé. Il n\'y a plus rien à annuler.',
      rendezVous: await habiller(rendezVous),
    });
  }

  const annule = await prisma.booking.update({
    where: { id: rendezVous.id },
    data: { annuleLe: new Date() },
  });

  res.json({ ok: true, rendezVous: await habiller(annule) });
}));

/**
 * POST /api/rendez-vous/deplacer
 *   { reference, telephone|jeton, date, start, staffId? }
 *
 * Le deplacement. Meme prestation, nouveau creneau.
 *
 * >>> L'ANCIEN CRENEAU N'EST LIBERE QU'UNE FOIS LE NOUVEAU PRIS, ET LES DEUX SE
 *     FONT DANS LA MEME TRANSACTION. <<<
 *
 * C'est la regle qui gouverne tout ce qui suit. Annuler d'abord puis
 * reserver — ce que fait n'importe quelle version naive — laisse le client
 * SANS RIEN si la seconde moitie echoue : creneau perdu, repris entre-temps par
 * quelqu'un d'autre, et plus aucun moyen de revenir en arriere. Dans une
 * transaction, les deux ecritures reussissent ensemble ou aucune n'a lieu.
 *
 * L'ancien rendez-vous est ecarte du calcul du nouveau (`id: { not: ... }`) :
 * sans cela, se decaler d'un quart d'heure serait refuse par soi-meme.
 */
rendezVousRouter.post('/rendez-vous/deplacer', garde(async (req, res, rendezVous) => {
  const refus = (code, message) => res.status(code).json({ error: message });

  if (rendezVous.annuleLe) {
    return refus(409, 'Ce rendez-vous a déjà été annulé. Prenez-en un nouveau.');
  }
  if (rendezVous.date < todayIso()) {
    return refus(409, 'Ce rendez-vous est déjà passé.');
  }

  const { date, start } = req.body ?? {};
  if (!isValidIso(date)) return refus(400, 'Date invalide.');
  if (!Number.isInteger(start) || start < 0 || start > 1439) return refus(400, 'Heure invalide.');

  // La prestation ne change pas : deplacer, c'est garder le meme rendez-vous a
  // une autre heure. En changer serait une autre reservation, et le tunnel est
  // la pour ca.
  const prestation = rendezVous.serviceId ? await loadService(rendezVous.serviceId) : null;
  if (!prestation) {
    return refus(409, "Cette prestation n'est plus proposée. Annulez ce rendez-vous et prenez-en un nouveau.");
  }
  if (!prestation.active) {
    return refus(409, "Cette prestation n'est plus proposée en ligne. Appelez le salon pour la décaler.");
  }

  const duree = prestation.durationMin;

  // « Avec qui » peut changer a l'occasion du deplacement : la personne du
  // rendez-vous d'origine n'est peut-etre pas de service le nouveau jour.
  const staffDemande = typeof req.body?.staffId === 'string' && req.body.staffId.trim()
    ? req.body.staffId.trim()
    : null;

  const toutes = await loadStaff({ includeInactive: true });
  const actives = toutes.filter((personne) => personne.active);

  let eligibles;
  if (staffDemande) {
    const connue = actives.find((personne) => personne.id === staffDemande);
    if (!connue) return refus(409, "Cette personne ne prend pas de rendez-vous en ligne.");
    if (!eligibleStaff(prestation, actives).some((p) => p.id === connue.id)) {
      return refus(409, "Cette personne n'assure pas cette prestation.");
    }
    eligibles = [connue];
  } else {
    eligibles = eligibleStaff(prestation, actives);
  }

  const [settings, horaires] = await Promise.all([loadSettings(), loadOpeningHours()]);

  const verdict = isBookableStart({
    date,
    startMin: start,
    durationMin: duree,
    day: horaires[weekdayOf(date)],
    settings,
  });
  if (!verdict.ok) return refus(409, verdict.raison);

  const deplace = await prisma.$transaction(async (tx) => {
    // L'ancien rendez-vous s'exclut lui-meme : il occupe encore son creneau, et
    // c'est precisement ce qu'on veut — sauf vis-a-vis de son propre
    // deplacement.
    const dejaPris = await tx.booking.findMany({
      where: { date, id: { not: rendezVous.id }, ...OCCUPENT },
    });

    let staffId = null;
    if (eligibles.length) {
      const libres = freeStaffAt({
        staff: eligibles,
        reservations: dejaPris,
        startMin: start,
        durationMin: duree,
        day: horaires[weekdayOf(date)],
      });
      const choisie = pickStaff(libres, dejaPris);
      if (!choisie) return null;
      staffId = choisie.id;
    } else if (!isFree(dejaPris, start, duree)) {
      return null;
    }

    // UNE SEULE ECRITURE. Le rendez-vous n'est pas annule puis recree : il
    // change de date, de debut et de personne. Il garde donc sa reference, son
    // jeton et son tarif convenu — le client n'a rien de nouveau a noter, et
    // le lien de son courriel continue de fonctionner.
    return tx.booking.update({
      where: { id: rendezVous.id },
      data: { date, startMin: start, staffId },
    });
  });

  if (!deplace) {
    return refus(409, "Ce créneau vient d'être pris. Merci d'en choisir un autre.");
  }

  res.json({ ok: true, rendezVous: await habiller(deplace) });
}));
