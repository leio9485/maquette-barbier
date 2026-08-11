// ---------------------------------------------------------------------------
// TESTS DES PLAFONDS DE RESERVATION
//
//     npm run test:debit      (aucun serveur necessaire)
//
// >>> POURQUOI CES TESTS NE PASSENT PAS PAR HTTP. <<<
//
// Le plafond ne s'applique pas a la machine elle-meme hors production, et cette
// exemption n'est pas un contournement : `npm test` envoie QUARANTE-TROIS
// demandes de reservation en QUINZE SECONDES depuis la meme adresse — mesure,
// pas estime. C'est exactement le profil qu'un plafond existe pour arreter.
// Aucune valeur ne laisse passer la suite tout en protegeant quelque chose : il
// faudrait un plafond superieur a quarante-trois par quart d'heure, autant dire
// aucun plafond.
//
// Trois niveaux, du plus fin au plus complet :
//
//   1. LA REGLE D'EXEMPTION (`limiteApplicable`) — la decision sensible. Les
//      quatre combinaisons, dont celle qui compte : en production, RIEN n'est
//      exempte, pas meme une requete venue de la machine.
//
//   2. LE COMPTEUR (`passageDisponible` / `noterPassage`) — plafond, fenetre
//      fixe, expiration, independance des cles.
//
//   3. >>> LA ROUTE ELLE-MEME, EN HTTP. <<< Cette suite monte son propre
//      serveur, sur un autre port, avec `trust proxy` — exactement comme en
//      production. Elle peut alors se presenter avec une adresse PUBLIQUE via
//      `X-Forwarded-For`, sortir de l'exemption, et voir le plafond mordre pour
//      de vrai. Aucune porte derobee : c'est le reglage de production qui rend
//      l'en-tete digne de foi, et c'est ce reglage-la qu'on reproduit.
// ---------------------------------------------------------------------------

import express from 'express';

import { creerVerificateur, prochainJourOuvert } from './helpers.mjs';
import { prisma } from '../src/db.js';
import { bookingsRouter } from '../src/routes/bookings.js';
import {
  limiteApplicable,
  passageDisponible,
  noterPassage,
  oublierPassages,
} from '../src/lib/rateLimit.js';
import {
  RESERVATIONS_RAFALE_MAX,
  RESERVATIONS_HEURE_MAX,
  RESERVATIONS_TENTATIVES_MAX,
} from '../src/config.js';

const { verifie, bilan } = creerVerificateur();

// --- 1. La regle d'exemption ------------------------------------------------
console.log('1. Qui est soumis aux plafonds');
{
  const LOCALES = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];

  for (const ip of LOCALES) {
    verifie(`hors production, ${ip} est exempte`,
      limiteApplicable(ip, { production: false }) === false, ip);
  }

  // >>> LE TEST QUI COMPTE. <<< Si cette ligne passe au rouge un jour, la
  //     protection n'existe plus la ou elle sert.
  for (const ip of LOCALES) {
    verifie(`EN PRODUCTION, ${ip} est plafonne comme tout le monde`,
      limiteApplicable(ip, { production: true }) === true, ip);
  }

  for (const production of [true, false]) {
    verifie(`une adresse publique est toujours plafonnee (production=${production})`,
      limiteApplicable('92.184.1.2', { production }) === true, production);
  }

  // Une adresse absente ou vide ne doit pas ouvrir une porte par accident.
  for (const bizarre of [undefined, null, '', 'pas-une-adresse']) {
    verifie(`une adresse inattendue (${JSON.stringify(bizarre)}) reste plafonnee`,
      limiteApplicable(bizarre, { production: false }) === true, bizarre);
  }
}

// --- 2. Les valeurs par defaut ---------------------------------------------
console.log('\n2. Les plafonds livres');
{
  verifie('la rafale est serree (5 ou moins)', RESERVATIONS_RAFALE_MAX <= 5, RESERVATIONS_RAFALE_MAX);
  verifie('l\'heure est large (20 ou plus)', RESERVATIONS_HEURE_MAX >= 20, RESERVATIONS_HEURE_MAX);
  verifie('les tentatives sont plus larges que les reussites',
    RESERVATIONS_TENTATIVES_MAX > RESERVATIONS_HEURE_MAX,
    [RESERVATIONS_TENTATIVES_MAX, RESERVATIONS_HEURE_MAX]);
}

// --- 3. Le compteur ---------------------------------------------------------
console.log('\n3. Le compteur de passages');
{
  const cle = 'test:compteur:' + Math.random();
  oublierPassages(cle);

  verifie('une cle neuve n\'est pas bloquee',
    passageDisponible(cle, { max: 3 }).bloque === false, '');
  verifie('et annonce la place restante',
    passageDisponible(cle, { max: 3 }).restant === 3, passageDisponible(cle, { max: 3 }).restant);

  noterPassage(cle, { fenetreMs: 60000 });
  noterPassage(cle, { fenetreMs: 60000 });

  verifie('apres deux passages sur trois, ca passe encore',
    passageDisponible(cle, { max: 3 }).bloque === false, '');
  verifie('et il reste une place',
    passageDisponible(cle, { max: 3 }).restant === 1, passageDisponible(cle, { max: 3 }).restant);

  noterPassage(cle, { fenetreMs: 60000 });

  const bloque = passageDisponible(cle, { max: 3 });
  verifie('>>> LE TROISIEME PASSAGE FERME LA PORTE <<<', bloque.bloque === true, bloque);
  verifie('et le refus dit combien de temps attendre',
    bloque.secondes > 0 && bloque.secondes <= 60, bloque.secondes);

  oublierPassages(cle);
}
{
  // ⚠️ LA FENETRE NE SE REPOUSSE PAS. C'est la difference avec le compteur
  //    d'echecs de la page de connexion, et elle protege les adresses
  //    partagees : derriere le reseau mobile d'un operateur, une fenetre qui se
  //    repousse a chaque passage enfermerait dehors des dizaines de clients
  //    innocents, indefiniment.
  const cle = 'test:fenetre:' + Math.random();
  oublierPassages(cle);

  noterPassage(cle, { fenetreMs: 60000 });
  const premier = passageDisponible(cle, { max: 10 }).secondes;

  await new Promise((r) => setTimeout(r, 1100));

  noterPassage(cle, { fenetreMs: 60000 });
  noterPassage(cle, { fenetreMs: 60000 });

  // On force le blocage pour pouvoir lire `secondes`.
  const apres = passageDisponible(cle, { max: 3 });
  verifie('la fin de fenetre ne recule pas quand on continue de passer',
    apres.bloque === true && apres.secondes <= 59,
    [premier, apres.secondes]);

  oublierPassages(cle);
}
{
  const cle = 'test:expiration:' + Math.random();
  oublierPassages(cle);

  // Une fenetre de 200 ms : on verifie qu'elle rend la main.
  noterPassage(cle, { fenetreMs: 200 });
  noterPassage(cle, { fenetreMs: 200 });
  verifie('deux passages sur deux ferment la porte',
    passageDisponible(cle, { max: 2 }).bloque === true, '');

  await new Promise((r) => setTimeout(r, 260));

  verifie('la fenetre passee, la porte se rouvre',
    passageDisponible(cle, { max: 2 }).bloque === false, '');

  oublierPassages(cle);
}
{
  // Deux adresses differentes ne se genent pas : c'est ce qui fait qu'un
  // acharne ne bloque pas le reste du monde.
  const une = 'test:cle-a:' + Math.random();
  const autre = 'test:cle-b:' + Math.random();
  oublierPassages(une);
  oublierPassages(autre);

  for (let i = 0; i < 5; i++) noterPassage(une, { fenetreMs: 60000 });

  verifie('la premiere cle est bloquee', passageDisponible(une, { max: 5 }).bloque === true, '');
  verifie('la seconde ne l\'est pas', passageDisponible(autre, { max: 5 }).bloque === false, '');

  oublierPassages(une);
  oublierPassages(autre);
}
{
  // Le plafond de rafale, avec sa vraie valeur : c'est celui qui protege.
  const cle = 'test:rafale:' + Math.random();
  oublierPassages(cle);

  for (let i = 0; i < RESERVATIONS_RAFALE_MAX; i++) {
    verifie(`reservation ${i + 1} sur ${RESERVATIONS_RAFALE_MAX} : elle passe`,
      passageDisponible(cle, { max: RESERVATIONS_RAFALE_MAX }).bloque === false, i + 1);
    noterPassage(cle, { fenetreMs: 3 * 60 * 1000 });
  }

  verifie(`>>> LA ${RESERVATIONS_RAFALE_MAX + 1}e EST REFUSEE <<<`,
    passageDisponible(cle, { max: RESERVATIONS_RAFALE_MAX }).bloque === true, '');

  oublierPassages(cle);
}

// --- 4. La route, en HTTP, vue depuis une adresse publique ------------------
//
// C'est le test qui vaut pour tous les autres : il ne verifie pas un rouage, il
// verifie que la porte est fermee.
console.log('\n4. La route de reservation, depuis une adresse publique');

const PORT_SONDE = 3999;
const IP_PUBLIQUE = '92.184.1.2';

const app = express();
// `trust proxy` : le reglage de production (src/server.js). C'est LUI qui rend
// `X-Forwarded-For` digne de foi — sans lui, Express l'ignore et `req.ip`
// resterait l'adresse locale, donc exemptee.
app.set('trust proxy', 1);
app.use(express.json());
app.use('/api', bookingsRouter);

const serveur = app.listen(PORT_SONDE);
const BASE = `http://127.0.0.1:${PORT_SONDE}`;
const crees = [];

try {
  const JOUR = prochainJourOuvert();

  // ⚠️ ON RELIT LES DISPONIBILITES AVANT CHAQUE ENVOI, comme le ferait un vrai
  //    client. Une premiere version prenait la liste une fois et reservait
  //    `libres[0]`, `libres[1]`, `libres[2]`… Elle passait seule et echouait
  //    dans la suite complete : le lanceur met l'equipe de cote, le commerce
  //    n'a plus qu'une ressource, et un rendez-vous en occupe alors un
  //    deuxieme creneau sur deux. Le test se refusait ses propres creneaux et
  //    lisait un 409 la ou il attendait un 201.
  const premierLibre = async () => {
    const creneaux = await fetch(`${BASE}/api/slots?date=${JOUR}&serviceId=coupe-homme`)
      .then((r) => r.json());
    return (creneaux.slots ?? []).find((c) => c.free) ?? null;
  };

  const auDepart = await fetch(`${BASE}/api/slots?date=${JOUR}&serviceId=coupe-homme`)
    .then((r) => r.json());
  verifie('assez de creneaux libres pour eprouver le plafond',
    (auDepart.slots ?? []).filter((c) => c.free).length > RESERVATIONS_RAFALE_MAX,
    (auDepart.slots ?? []).filter((c) => c.free).length);

  const reserver = async (rang, entete = { 'X-Forwarded-For': IP_PUBLIQUE }) => {
    const creneau = await premierLibre();
    if (!creneau) return { status: 0, donnees: { error: 'plus aucun creneau libre' } };

    const r = await fetch(`${BASE}/api/bookings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...entete },
      body: JSON.stringify({
        date: JOUR, start: creneau.start, serviceId: 'coupe-homme',
        name: `Plafond ${rang}`, phone: '06 39 98 99 99',
      }),
    });
    const donnees = await r.json();
    if (donnees.id) crees.push(donnees.id);
    return { status: r.status, donnees };
  };

  for (let i = 1; i <= RESERVATIONS_RAFALE_MAX; i++) {
    const r = await reserver(i);
    verifie(`reservation ${i} : elle passe`, r.status === 201, [r.status, r.donnees.error]);
  }

  const refusee = await reserver(RESERVATIONS_RAFALE_MAX + 1);

  verifie(`>>> LA ${RESERVATIONS_RAFALE_MAX + 1}e EST REFUSEE, EN HTTP <<<`,
    refusee.status === 429, refusee.status);
  verifie('le refus est une phrase en francais',
    /Trop de réservations/.test(refusee.donnees.error ?? ''), refusee.donnees.error);
  verifie('il dit combien de temps attendre',
    /\d+ minute/.test(refusee.donnees.error ?? ''), refusee.donnees.error);
  verifie('il donne une sortie : appeler le salon',
    /appelez le salon/.test(refusee.donnees.error ?? ''), refusee.donnees.error);

  // ⚠️ ET IL NE DIT PAS LEQUEL DES TROIS PLAFONDS A MORDU : l'apprendre
  //    apprendrait aussi comment passer entre.
  verifie('il ne nomme aucun plafond',
    !/rafale|tentative|heure|plafond/i.test(refusee.donnees.error ?? ''), refusee.donnees.error);

  verifie('et RIEN n\'a ete enregistre pour cette requete',
    !refusee.donnees.id, refusee.donnees.id);

  // La machine elle-meme, SANS en-tete de relais : toujours exemptee hors
  // production, alors que l'adresse publique vient d'etre fermee. C'est la
  // preuve que les deux chemins sont bien distincts.
  const locale = await reserver(0, {});

  verifie('la machine elle-meme passe encore (exemption hors production)',
    locale.status === 201, [locale.status, locale.donnees.error]);
} finally {
  for (const id of crees) {
    await prisma.booking.delete({ where: { id } }).catch(() => {});
  }
  serveur.close();
  await prisma.$disconnect();
}

process.exitCode = bilan() === 0 ? 0 : 1;
