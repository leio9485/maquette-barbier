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

/** Les `n` prochains jours d'ouverture, a partir de demain. */
function prochainsJoursOuverts(n) {
  const jours = [];
  const curseur = new Date();
  let garde = 0;

  while (jours.length < n && garde < 60) {
    curseur.setDate(curseur.getDate() + 1);
    garde++;
    if (DEFAULT_CONFIG.hours[curseur.getDay()]) jours.push(isoDate(curseur));
  }
  return jours;
}

/**
 * Des rendez-vous credibles pour la semaine qui vient.
 *
 * Ni trop peu (un agenda desert ne donne pas envie), ni complet (le visiteur
 * doit pouvoir reserver et voir son rendez-vous apparaitre). Un melange de
 * « en ligne » et de « telephone », pour montrer que les deux coexistent.
 */
export function rendezVousDemo({ equipe = [] } = {}) {
  const j = prochainsJoursOuverts(4);
  const rdv = [];

  // Chaque rendez-vous designe la personne qui l'assure — mais seulement si
  // l'equipe existe. Sur une base sans equipe (le cas d'un commerce qui travaille
  // seul), `equipe` est vide et `qui()` renvoie null.
  //
  // Cela compte pour la demonstration : un rendez-vous sans personne occupe
  // TOUT LE MONDE. Les laisser non attribues remplirait l'agenda de bandeaux
  // « bloque toute l'equipe » et donnerait a voir un defaut, pas une fonction.
  const qui = (id) => (equipe.includes(id) ? id : null);

  // ⚠️ LES JOURNEES N'ONT PAS TOUTES LES MEMES HEURES ICI : nocturne le vendredi
  // jusqu'a 21h, samedi en journee continue qui ferme a 17h, et Yanis a ses
  // propres horaires (absent le mardi, part a 18h).
  //
  // Or `j[0]`... `j[3]` designent les quatre prochains jours d'ouverture : selon
  // le jour ou la demonstration est remise a zero, le meme rendez-vous tombe un
  // mercredi ou un samedi. Ecrit a l'aveugle, un rendez-vous de 18h00 finirait
  // regulierement une heure apres la fermeture — et c'est l'agenda, la premiere
  // chose qu'un prospect ouvre, qui montrerait l'incoherence.
  //
  // On verifie donc que chaque rendez-vous tient reellement dans une plage
  // ouverte, pour la personne qui l'assure. Ceux qui ne tiennent pas sont
  // simplement omis : un agenda un peu plus creux vaut mieux qu'un agenda faux.
  const HORAIRES_PROPRES = new Map(
    DEFAULT_CONFIG.staff.filter((p) => p.hours).map((p) => [p.id, p.hours])
  );

  /** Les plages continues d'une journee, en minutes : [[debut, fin], ...]. */
  function plages(staffId, dateIso) {
    const jour = new Date(`${dateIso}T12:00:00`).getDay();
    const horaires = (staffId && HORAIRES_PROPRES.get(staffId)) || DEFAULT_CONFIG.hours;
    const h = horaires[jour];
    if (!h) return [];

    return h.pause
      ? [[toMin(h.open), toMin(h.pause[0])], [toMin(h.pause[1]), toMin(h.close)]]
      : [[toMin(h.open), toMin(h.close)]];
  }

  /** Pose un rendez-vous, sauf s'il ne tient pas dans une plage ouverte. */
  const poser = (date, heure, duree, serviceId, staffId, nom, tel, source) => {
    const debut = toMin(heure);
    const tient = plages(staffId, date).some(([o, f]) => debut >= o && debut + duree <= f);
    if (!tient) return;
    rdv.push({
      date,
      startMin: debut,
      durationMin: duree,
      serviceId,
      staffId: qui(staffId),
      customerName: nom,
      customerPhone: tel,
      source,
    });
  };

  // Les numeros sont dans la plage reservee a la fiction (06/07 39 98 XX XX) :
  // une demonstration ne fait sonner le telephone de personne.
  if (j[0]) {
    poser(j[0], '09:00', 25, 'coupe-homme', 'stf-remi',
      'Damien Carpentier', '06 39 98 14 07', 'phone');
    // Meme heure, quelqu'un d'autre : c'est ce qui montre d'un coup d'oeil que
    // le commerce recoit plusieurs clients a la fois.
    poser(j[0], '09:00', 45, 'coupe-barbe', 'stf-karim',
      'Anthony Vasseur', '06 39 98 52 31', 'online');
    poser(j[0], '14:00', 40, 'rasage-coupe-chou', 'stf-remi',
      'Bruno Leclercq', '07 39 98 03 66', 'online');
    poser(j[0], '17:30', 15, 'coupe-tondeuse', 'stf-yanis',
      'Kévin Legrand', '06 39 98 77 12', 'online');
  }
  if (j[1]) {
    poser(j[1], '10:00', 20, 'barbe-taille', 'stf-karim',
      'Sébastien Mahieu', '06 39 98 41 90', 'phone');
    // Une heure pleine : la plus longue prestation du catalogue, qui fait voir
    // que les creneaux tiennent compte de la duree reelle.
    poser(j[1], '14:00', 60, 'coupe-rasage', 'stf-remi',
      'Ludovic Wattiez', '07 39 98 25 48', 'online');
    poser(j[1], '16:00', 25, 'coupe-homme', 'stf-yanis',
      'Jordan Delattre', '06 39 98 60 15', 'online');
  }
  if (j[2]) {
    poser(j[2], '09:30', 20, 'coupe-enfant', 'stf-yanis',
      'Nathan (9 ans)', '06 39 98 88 04', 'phone');
    poser(j[2], '11:00', 30, 'barbe-serviette', 'stf-karim',
      'Mickaël Dhaine', '06 39 98 19 73', 'online');
    poser(j[2], '15:00', 45, 'pere-fils', 'stf-remi',
      'Olivier Fontaine', '07 39 98 34 21', 'online');
  }
  if (j[3]) {
    poser(j[3], '10:30', 30, 'coloration-barbe', 'stf-karim',
      'Pascal Dhennin', '06 39 98 07 55', 'online');
    poser(j[3], '18:00', 45, 'coupe-barbe', 'stf-remi',
      'Fabrice Leroy', '06 39 98 92 38', 'phone');
  }
  return rdv;
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
  if (probleme) throw new Error(`Valeurs de demonstration invalides : ${probleme}`);

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

  const rdv = rendezVousDemo({ equipe: config.staff.map((p) => p.id) })
    .map((r) => ({
      ...r,
      priceCents: tarif(r.serviceId),
      ...(r.source === 'online'
        ? { reference: referenceNeuve(), cancelToken: randomBytes(32).toString('base64url') }
        : {}),
    }));

  await prisma.booking.createMany({ data: rdv });
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
