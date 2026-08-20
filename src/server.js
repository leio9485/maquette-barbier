// ---------------------------------------------------------------------------
// Serveur de L'Etabli — barbier.
//
// Un "serveur", ici, c'est ce programme : il tourne en continu et attend qu'on
// lui parle. Il fait deux choses.
//
//   1. Il sert le site. Quand quelqu'un ouvre l'adresse du salon, c'est lui qui
//      recolle les morceaux de src/page/ et renvoie la page (voir
//      src/lib/assemblage.js et src/page/LISEZ-MOI.md).
//   2. Il expose une API, c'est-a-dire une liste d'adresses commencant par
//      /api/, que le site appelle pour lire et ecrire les vraies donnees.
//
// Le site et l'API sont servis par le meme serveur, a la meme adresse : le site
// peut donc appeler /api/... directement, sans configuration particuliere.
//
// Ce fichier ne fait qu'assembler les morceaux ; la logique vit dans src/lib/
// et les adresses dans src/routes/.
// ---------------------------------------------------------------------------

import express from 'express';
import path from 'node:path';

import { PORT, ROOT_DIR, TIMEZONE, IS_PRODUCTION, DEMO_MODE, PUBLIC_URL } from './config.js';
import { prisma } from './db.js';
import { startDemo } from './lib/demo.js';
import { rendreLlmsTxt } from './lib/llms.js';
import { renderIndex, renderAnnuler, renderEspace, renderIntrouvable } from './lib/page.js';
import { lireVariante, emplacementConnu } from './lib/photos.js';
import { icone, ico, manifeste, TAILLES } from './lib/icones.js';
import { lirePlan, planifierPlan } from './lib/plan.js';
import { startRetention } from './lib/retention.js';
import { compression } from './middleware/compression.js';
import { securityHeaders } from './middleware/securityHeaders.js';
import { plafondEcrituresAdmin } from './middleware/plafondAdmin.js';
import { purgeExpiredSessions } from './lib/sessions.js';
import { authRouter } from './routes/auth.js';
import { bookingsRouter } from './routes/bookings.js';
import { rendezVousRouter } from './routes/rendezvous.js';
import { tableauDeBordRouter } from './routes/tableaudebord.js';
import { settingsRouter } from './routes/settings.js';

const app = express();

// >>> ON N'ANNONCE PAS AVEC QUOI LE SITE EST FAIT. <<< Express pose de
// lui-meme un en-tete `X-Powered-By: Express` sur CHAQUE reponse. Ce n'est pas
// une faille — connaitre le cadre ne donne aucun acces — mais c'est un
// renseignement gratuit offert a qui cherche des cibles par version de
// bibliotheque, et il ne rend service a personne d'autre.
app.disable('x-powered-by');

// En production, le site est place derriere un serveur relais (l'hebergeur).
// Sans cette ligne, toutes les requetes sembleraient venir de ce relais : la
// limitation des tentatives de connexion compterait les echecs de tout le monde
// dans le meme panier. A n'activer que derriere un relais de confiance, sans
// quoi l'adresse annoncee pourrait etre falsifiee.
if (IS_PRODUCTION) app.set('trust proxy', 1);

// Consignes de securite posees sur toutes les reponses, avant tout le reste :
// une reponse d'erreur doit les porter comme les autres.
app.use(securityHeaders);

// La page et les reponses JSON partent compressees. Le site tient en un seul
// fichier de 220 ko : non compresse, c'est lui qui faisait attendre le visiteur
// avant toute autre chose. Pose tot, pour couvrir toutes les routes qui suivent.
app.use(compression);

// La vitrine de demonstration reste hors des moteurs de recherche.
//
// Elle presente un salon qui n'existe pas, a une adresse reelle, avec des
// mentions legales fictives : indexee, elle ferait passer un commerce imaginaire
// pour un vrai. Elle serait aussi le double mot pour mot du site du premier
// client mis en ligne, ce que Google penalise — et c'est le site du client qui
// en patirait.
//
// Un en-tete plutot qu'un `Disallow` dans robots.txt : `Disallow` interdit de
// LIRE la page, si bien qu'une adresse partagee quelque part peut tout de meme
// figurer dans les resultats, sans description. Ici on laisse lire, et ce que le
// robot lit lui dit de ne pas retenir la page. Un en-tete, enfin, plutot qu'une
// balise dans la page : il part avec chaque reponse, meme celles ou l'en-tete de
// la page n'a pas pu etre reconstruit.
if (DEMO_MODE) {
  app.use((req, res, next) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    next();
  });
}

// Autorise le site a envoyer des donnees au format JSON (le format d'echange
// standard entre un site et son serveur). La limite de taille evite qu'une
// requete enorme vienne saturer la memoire du serveur.
//
// 2 Mo, et non 100 ko comme au depart : les reglages transportent desormais les
// photos de l'equipe, ecrites dans le JSON lui-meme. Le navigateur les reduit
// avant l'envoi (environ 20 ko chacune) et le serveur refuse tout ce qui depasse
// 200 000 caracteres par personne (src/lib/settings.js) : la limite ci-dessous
// n'est donc pas ce qui protege, seulement ce qui laisse passer une equipe
// nombreuse.
app.use(express.json({ limit: '2mb' }));

// Test de vie : ouvrir http://localhost:3000/api/health dans un navigateur
// permet de verifier d'un coup d'oeil que le serveur tourne bien.
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'letabli-barbier',
    fuseau: TIMEZONE,
    heure: new Date().toISOString(),
  });
});

// Ce qu'une adresse peut ECRIRE dans l'espace commercant en une minute.
//
// Pose avant les routeurs d'administration, et sur ce chemin-la seulement : il
// ne voit ni la vitrine, ni les creneaux, ni /api/rendez-vous, qui ont leurs
// propres plafonds. Les LECTURES le traversent sans etre comptees — voir
// src/middleware/plafondAdmin.js pour les trois decisions.
app.use('/api/admin', plafondEcrituresAdmin);

// Connexion et deconnexion de l'espace commercant.
app.use('/api', authRouter);

// Les adresses de reservation (creneaux, prise de rendez-vous, agenda).
app.use('/api', bookingsRouter);

// Retrouver, annuler ou deplacer son propre rendez-vous, depuis /annuler.
// A part des adresses de reservation : elles ont leur propre facon de prouver
// qui l'on est, et leur propre compteur de tentatives.
app.use('/api', rendezVousRouter);

// Le tableau de bord, l'export et le pointage des absences.
app.use('/api', tableauDeBordRouter);

// Les adresses de reglages (coordonnees, horaires, prestations).
app.use('/api', settingsRouter);

// Toute autre adresse en /api/ n'existe pas : on le dit clairement en JSON,
// plutot que de renvoyer la page d'accueil du site, qui n'aurait aucun sens ici.
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Adresse inconnue.' });
});

// La page d'accueil n'est pas envoyee telle quelle : son en-tete (titre,
// description, donnees structurees) est reconstruit depuis les reglages du
// salon. C'est ce que lisent les moteurs de recherche et les apercus de lien,
// et eux n'attendent pas que le JavaScript de la page s'execute.
//
// ⚠️ `Cache-Control: no-cache`, ET CE N'EST PAS UNE INADVERTANCE COMBLEE. <<<
// Les trois documents (ici, /annuler, /espace-salon) n'avaient AUCUN en-tete
// de cache : un navigateur, un CDN ou un relais reste alors libre d'appliquer
// sa propre heuristique et de garder une reponse HTML sans jamais revalider.
// Chaque page porte un nonce CSP DIFFERENT a chaque envoi (securityHeaders.js)
// et incorpore les reglages du commerce a l'instant de la requete : la servir
// depuis un cache serait au mieux une page qui n'execute plus son script (nonce
// perime), au pire un tarif ou un horaire que le commercant vient de changer et
// que le visiteur ne voit pas. `no-cache` n'interdit pas de GARDER une copie —
// contrairement a `no-store` — il oblige a la revalider avant de s'en servir ;
// sans validateur (ETag, Last-Modified) sur ce document engendre a la volee,
// revalider revient en pratique a redemander, ce qui est le comportement voulu.
// Les photos, elles, portent deja leur propre regle de cache (voir plus bas) :
// `?v=` autorise un an, son absence force la revalidation — c'est le mecanisme
// que l'audit avait raison de vouloir, sauf qu'il existait deja.
app.get(['/', '/index.html'], async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(await renderIndex(res.locals.cspNonce));
  } catch (erreur) {
    next(erreur);
  }
});

/**
 * Les mentions légales et la confidentialité — lot D, point D3.
 *
 * >>> DES ADRESSES REELLES, PAS SEULEMENT UN BOUTON. <<< Elles ouvraient une
 * surimpression depuis un `<button>` sans la moindre adresse : ni
 * partageables, ni indexables, ni ouvrables dans un nouvel onglet — et pour
 * des mentions légales, l'usage attendu est une adresse propre.
 *
 * Ces deux routes servent EXACTEMENT le même document que `/` (voir
 * `renderIndex`), la surimpression déjà ouverte : « une adresse qui répond »,
 * pas un second document qui dupliquerait le tunnel, les prestations et les
 * avis. Le pied de page pointe désormais vers ces adresses avec de vrais
 * `<a href>` ; le JavaScript intercepte le clic pour ouvrir la surimpression
 * SANS rechargement quand la page est déjà chargée (`ouvrirLegalDepuisLien()`,
 * js/05-navigation.js) — « une interception au clic », en plus de l'adresse.
 */
app.get('/mentions-legales', async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(await renderIndex(res.locals.cspNonce, 'mentions'));
  } catch (erreur) {
    next(erreur);
  }
});

app.get('/confidentialite', async (req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(await renderIndex(res.locals.cspNonce, 'confidentialite'));
  } catch (erreur) {
    next(erreur);
  }
});

/**
 * La page d'annulation.
 *
 * `/annulation` est un alias : c'est l'autre mot que les gens tapent, et le
 * courriel de confirmation, lui, ne portera jamais que `/annuler`. Deux
 * adresses pour une page ne genent personne — la page ne s'indexe pas, il n'y a
 * donc pas de contenu duplique a redouter.
 *
 * `X-Robots-Tag` ici en plus de la balise dans la page, et sans dependre de
 * `DEMO_MODE` : une adresse d'annulation n'a rien a faire dans les resultats de
 * recherche, chez un vrai client comme sur la demonstration. Elle reste
 * parfaitement lisible ; c'est l'indexation qu'on refuse.
 */
app.get(['/annuler', '/annulation'], async (req, res, next) => {
  try {
    res.setHeader('X-Robots-Tag', 'noindex, follow');
    // Meme regle que / : voir le commentaire au-dessus de cette route.
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(await renderAnnuler(res.locals.cspNonce));
  } catch (erreur) {
    next(erreur);
  }
});

/**
 * L'espace commercant.
 *
 * >>> UN DOCUMENT A PART, ET C'EST TOUT LE SUJET DU LOT 4. <<<
 *
 * Ce balisage, ce style et ce JavaScript partaient dans la meme page que la
 * vitrine, chez CHAQUE visiteur : 58 154 octets sur 164 244, soit 35 % du poids
 * d'une page de barbier occupes par un agenda que personne d'autre que lui ne
 * verra. Ce n'etait pas une fuite — les conteneurs sont vides, et les
 * rendez-vous ne sortent que de /api/admin/… derriere une session — mais
 * c'etait du poids, du JavaScript a analyser, et un bouton offert a tout le
 * monde en bas de page.
 *
 * `X-Robots-Tag` SANS CONDITION, contrairement a celui de la demonstration :
 * l'agenda d'un vrai client n'a pas plus a figurer dans Google que celui de la
 * demonstration. Il s'ajoute a la balise `<meta name="robots">` de la page et
 * au `Disallow` de robots.txt — trois garde-fous, aucun ne dependant des deux
 * autres.
 *
 * ⚠️ ET `noindex` N'EST PAS UN CONTROLE D'ACCES. Ce qui protege l'agenda, c'est
 *    `requireAdmin` sur /api/admin/… : cette page-ci n'est qu'un formulaire de
 *    connexion et des conteneurs vides. Un robot qui l'indexerait n'y lirait
 *    aucun rendez-vous.
 */
app.get('/espace-salon', async (req, res, next) => {
  try {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    // Meme regle que / : voir le commentaire au-dessus de cette route.
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(await renderEspace(res.locals.cspNonce));
  } catch (erreur) {
    next(erreur);
  }
});

/**
 * Le nom d'un fichier de la route ci-dessous, decompose.
 *
 * Deux formes : `<emplacement>.<jpg|webp>` (la largeur pleine — `hero.jpg`,
 * `hero.webp`) ou `<emplacement>-<largeur>.<jpg|webp>` (une variante reduite —
 * `hero-800.jpg`, voir src/lib/photos.js). Tout le reste, y compris un nom qui
 * ne correspond a AUCUN emplacement connu, renvoie `null` : `emplacementConnu`
 * est la meme liste fermee qui protege deja le depot d'une photo, et elle
 * empeche ici aussi qu'un nom recu du reseau designe un fichier ailleurs sur
 * le disque.
 */
function analyserNomPhoto(brut) {
  const nom = path.basename(brut);
  const correspondance = /^(.+)\.(jpg|webp)$/i.exec(nom);
  if (!correspondance) return null;

  const [, base, format] = correspondance;
  const formatBas = format.toLowerCase();

  if (emplacementConnu(base)) return { emplacement: base, largeur: null, format: formatBas };

  const avecLargeur = /^(.+)-(\d+)$/.exec(base);
  if (avecLargeur && emplacementConnu(avecLargeur[1])) {
    return { emplacement: avecLargeur[1], largeur: Number(avecLargeur[2]), format: formatBas };
  }

  return null;
}

/**
 * Les photos de la vitrine, plein format ou en variante (largeur reduite,
 * WebP — voir src/lib/photos.js).
 *
 * Une route a nous plutot que le service de fichiers d'Express, parce qu'elle
 * doit regarder a DEUX endroits : la photo deposee par le commercant
 * (data/photos), puis, a defaut, celle livree avec le site (public/photos).
 *
 * La mise en cache tient en une regle : l'adresse donnee par les reglages porte
 * un numero de version (la date du fichier). Quand il est la, l'image ne
 * changera plus jamais a cette adresse-la, et on autorise le navigateur a la
 * garder un an. Sans lui — quelqu'un qui tape l'adresse a la main — on ne prend
 * pas ce risque et on la fait revalider.
 */
app.get('/photos/:fichier', async (req, res, next) => {
  try {
    const analyse = analyserNomPhoto(req.params.fichier);
    if (!analyse) return res.status(404).json({ error: 'Photo inconnue.' });

    const photo = await lireVariante(analyse.emplacement, analyse.largeur, analyse.format);
    if (!photo) return res.status(404).json({ error: 'Photo inconnue.' });

    res.type(analyse.format === 'webp' ? 'image/webp' : 'jpeg');
    res.setHeader('Cache-Control', req.query.v
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=0, must-revalidate');
    res.setHeader('ETag', `"${Math.round(photo.mtime)}"`);

    if (req.headers['if-none-match'] === `"${Math.round(photo.mtime)}"`) {
      return res.status(304).end();
    }

    res.send(photo.contenu);
  } catch (erreur) {
    next(erreur);
  }
});

/**
 * Le plan du quartier, dessine par le serveur depuis l'adresse du salon
 * (src/lib/plan.js).
 *
 * Meme regle de cache que les photos, et pour la meme raison : l'adresse porte
 * un numero de version, et c'est lui qui autorise a le garder un an. Sans ce
 * parametre, on fait revalider.
 *
 * Un SVG, donc du texte : il part compresse comme la page (~6 ko).
 *
 * L'ADRESSE EST RELUE ICI, et ce n'est pas superflu : un plan n'est servi que
 * s'il a ete dessine pour l'adresse actuelle (voir src/lib/plan.js). La page ne
 * demandera pas cette image quand ce n'est pas le cas — `listerPlan()` ne lui
 * en donne alors pas l'adresse — mais quelqu'un qui tape /plan.svg a la main,
 * ou un apercu de lien, ne passe pas par la page. Le controle est donc a la
 * source. Une lecture de la base par requete, sur une image mise en cache un
 * an : sans consequence.
 */
app.get('/plan.svg', async (req, res, next) => {
  try {
    const reglages = await prisma.settings.findUnique({ where: { id: 1 } });
    if (!reglages) return res.status(404).json({ error: 'Aucun plan.' });

    const plan = await lirePlan(reglages);
    if (!plan) return res.status(404).json({ error: 'Aucun plan.' });

    res.type('image/svg+xml');
    res.setHeader('Cache-Control', req.query.v
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=0, must-revalidate');
    res.setHeader('ETag', `"${Math.round(plan.mtime)}"`);

    if (req.headers['if-none-match'] === `"${Math.round(plan.mtime)}"`) {
      return res.status(304).end();
    }

    res.send(plan.contenu);
  } catch (erreur) {
    next(erreur);
  }
});

/**
 * Le plan du site, pour les moteurs de recherche.
 *
 * Une seule adresse — le site tient en une page — mais ce n'est pas pour autant
 * inutile : c'est ce qu'on depose dans la Search Console de Google pour lui
 * demander de passer, et le `lastmod` lui dit quand le commerce a change quelque
 * chose (nouveaux tarifs, nouveaux horaires) sans qu'il ait a le deviner.
 *
 * DEUX CONDITIONS, et elles vont de soi :
 *   - `PUBLIC_URL` doit etre connue. Un plan de site ne peut porter que des
 *     adresses absolues, et le serveur ne devine pas la sienne.
 *   - pas en demonstration : cette vitrine-la se retire des moteurs (voir
 *     l'en-tete X-Robots-Tag plus haut). Lui fabriquer un plan de site
 *     reviendrait a l'y inviter de l'autre main.
 *
 * Absent, il renvoie 404 : c'est la reponse juste, et elle n'empeche rien —
 * Google trouve tres bien une page unique sans plan de site.
 */
const SITEMAP_SERVI = Boolean(PUBLIC_URL) && !DEMO_MODE;

app.get('/sitemap.xml', async (req, res, next) => {
  if (!SITEMAP_SERVI) return next();

  try {
    // La date du dernier changement de reglages : c'est ce qui bouge sur ce
    // site. Absente sur une base qui n'a pas encore ete remplie.
    const reglages = await prisma.settings.findUnique({
      where: { id: 1 },
      select: { updatedAt: true },
    });

    const lastmod = reglages?.updatedAt
      ? `\n    <lastmod>${reglages.updatedAt.toISOString().slice(0, 10)}</lastmod>`
      : '';

    // TROIS ADRESSES : la vitrine, et les deux pages legales (lot D, D3).
    //
    // ⚠️ /annuler N'Y FIGURE PAS, ET C'EST UN ECART ASSUME PAR RAPPORT A LA
    //    MISSION. Elle demandait d'y ajouter /annuler en plus des pages
    //    legales ; /annuler porte pourtant `X-Robots-Tag: noindex` ET un
    //    `Disallow` dans robots.txt (voir plus haut), deux garde-fous poses
    //    et testes deliberement lors d'un lot precedent. L'inscrire ici
    //    demanderait a Google de passer sur une page qu'on lui interdit par
    //    ailleurs de retenir — exactement l'avertissement « URL envoyee
    //    comportant une balise noindex » que ce fichier evite depuis le
    //    depart. Les deux instructions se contredisent ; celle qui a un test
    //    et un raisonnement ecrit l'emporte.
    //
    // /mentions-legales et /confidentialite, elles, sont de vraies pages
    // indexables (aucun `noindex`, voir les routes correspondantes) : les
    // inscrire ici n'a pas le meme defaut.
    //
    // Les ancres de la page (#prestations, #reserver) n'y figurent pas :
    // un plan de site liste des DOCUMENTS. Une ancre n'est pas une adresse
    // distincte, et Google la trouve en lisant la page.
    res.type('application/xml');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(
      '<?xml version="1.0" encoding="UTF-8"?>\n'
      + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
      + '  <url>\n'
      + `    <loc>${PUBLIC_URL}/</loc>${lastmod}\n`
      + '  </url>\n'
      + '  <url>\n'
      + `    <loc>${PUBLIC_URL}/mentions-legales</loc>${lastmod}\n`
      + '  </url>\n'
      + '  <url>\n'
      + `    <loc>${PUBLIC_URL}/confidentialite</loc>${lastmod}\n`
      + '  </url>\n'
      + '</urlset>\n'
    );
  } catch (erreur) {
    next(erreur);
  }
});

/**
 * LES ICONES DE L'ECRAN D'ACCUEIL, ET LE MANIFESTE — lot D, point D4.
 *
 * >>> « AJOUTER A L'ECRAN D'ACCUEIL » DONNAIT UNE ICONE VIDE SUR IPHONE. <<<
 * Le site n'avait qu'un favicon SVG en `data:`, qu'iOS ignore, et
 * /manifest.webmanifest comme /favicon.ico repondaient 404. Pour un outil de
 * prise de rendez-vous consulte au telephone, c'est le raccourci que le client
 * garde sous les yeux qui n'avait pas de visage.
 *
 * Dessinees par le serveur (src/lib/icones.js) : quatre rectangles, aucune
 * dependance ajoutee, et rien a regenerer a la main le jour ou une couleur de
 * la charte bouge.
 *
 * Un an de cache : a taille donnee, ce dessin ne changera pas — et s'il change,
 * c'est que la charte a change, ce qui ne se fait pas sans redeployer.
 */
app.get('/icone-:taille.png', (req, res, next) => {
  const taille = Number(req.params.taille);
  if (!TAILLES.has(taille)) return next();

  res.type('image/png');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(icone(taille));
});

/**
 * Le vieux `/favicon.ico`, demande SANS que la page le declare — par les
 * navigateurs anciens et par les agregateurs de liens. Il repondait 404 a
 * chaque visite, et une 404 qui revient a chaque visite est un bruit qu'on
 * finit par ne plus lire dans un journal.
 */
app.get('/favicon.ico', (req, res) => {
  res.type('image/x-icon');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(ico());
});

/**
 * Le manifeste : ce que le systeme lit quand on pose le site sur l'ecran
 * d'accueil.
 *
 * ⚠️ LE NOM VIENT DES REGLAGES. C'est lui qui s'affiche sous l'icone : chez un
 *    client, ce doit etre le nom de SA boutique, et il doit suivre s'il en
 *    change. La base illisible retombe sur un nom generique plutot que sur une
 *    erreur — un manifeste absent retire l'icone, la couleur et le mode
 *    « application » d'un seul coup.
 */
app.get('/manifest.webmanifest', async (req, res) => {
  let nom = '';
  try {
    const reglages = await prisma.settings.findUnique({
      where: { id: 1 },
      select: { businessName: true },
    });
    nom = reglages?.businessName ?? '';
  } catch (erreur) {
    console.error('Manifeste engendre sans le nom du commerce :', erreur.message);
  }

  res.type('application/manifest+json');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.send(JSON.stringify(manifeste(nom), null, 2));
});

// Ce que les moteurs de recherche ont le droit de faire.
app.get('/robots.txt', (req, res) => {
  // `Disallow` sur l'espace commercant et sur la page d'annulation : ni l'un ni
  // l'autre n'a quoi que ce soit a offrir a un moteur de recherche, et une
  // adresse d'annulation qui remonte dans les resultats est une invitation a
  // s'y perdre pour qui cherchait simplement le salon.
  //
  // ⚠️ `Disallow` INTERDIT DE LIRE, ce qui n'empeche pas l'adresse elle-meme de
  //    figurer dans les resultats, sans description. C'est pourquoi ces deux
  //    routes portent EN PLUS un en-tete `X-Robots-Tag: noindex` : celui-la se
  //    lit, et il dit de ne pas retenir. Les deux sont complementaires, aucun ne
  //    remplace l'autre.
  const lignes = [
    'User-agent: *',
    'Disallow: /espace-salon',
    'Disallow: /annuler',
    'Disallow: /annulation',
    'Allow: /',
  ];

  // On n'annonce le plan du site que s'il existe reellement : renvoyer un robot
  // vers une adresse en 404 est le genre de detail qui remonte en avertissement
  // dans la Search Console, pour rien.
  if (SITEMAP_SERVI) lignes.push('', `Sitemap: ${PUBLIC_URL}/sitemap.xml`);

  res.type('text/plain').send(lignes.join('\n') + '\n');
});

/**
 * Le site resume pour un assistant (src/lib/llms.js).
 *
 * Engendre depuis les reglages, et non ecrit dans un fichier : il porte des
 * tarifs et des horaires, qui changent. Un fichier fige aurait vieilli sans que
 * personne ne s'en apercoive, puisque rien ne l'affiche.
 *
 * En cas de pepin, on ne renvoie pas d'erreur : mieux vaut pas de fichier du
 * tout qu'un fichier a moitie faux. L'assistant lira la page, comme avant.
 */
app.get('/llms.txt', async (req, res, next) => {
  try {
    res.type('text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(await rendreLlmsTxt());
  } catch (erreur) {
    console.error('llms.txt non engendre :', erreur.message);
    res.status(503).type('text/plain').send('');
  }
});

/**
 * Les polices du site (public/fonts/).
 *
 * Servies avant le reste de public/ pour porter leur propre duree de cache : un
 * an, car leur contenu ne change jamais a nom de fichier donne. Le nom porte la
 * graisse et le style, pas de numero de version — en changer une demande donc de
 * la renommer (c'est ecrit dans public/fonts/LISEZ-MOI.md).
 *
 * Un an, alors que les photos n'y ont droit qu'avec un `?v=` : la difference
 * tient a qui choisit le nom. Une photo est deposee par le commercant a une
 * adresse fixe et peut etre remplacee demain ; une police est posee par nous.
 */
app.use('/fonts', express.static(path.join(ROOT_DIR, 'public', 'fonts'), {
  maxAge: '1y',
  immutable: true,
  index: false,
}));

// Le reste du dossier public/ est servi tel quel (images, fichiers a venir).
// `index: false` : la ligne ci-dessus est la seule a repondre pour la page.
app.use(express.static(path.join(ROOT_DIR, 'public'), { index: false }));

/**
 * TOUTE ADRESSE QUI N'EXISTE PAS, ET C'EST LE DERNIER MOT DU SERVEUR.
 *
 * Sans ce gestionnaire, Express repondait `Cannot GET /adresse` : du Times New
 * Roman, en anglais, sur fond blanc, code 404. Les adresses en /api/ avaient
 * deja leur 404 en JSON (voir plus haut) — l'incoherence n'etait donc que du
 * cote des pages, c'est-a-dire du seul cote qu'un visiteur regarde.
 *
 * >>> DEUX PUBLICS, DEUX REPONSES, ET C'EST L'EN-TETE `Accept` QUI TRANCHE. <<<
 * Un navigateur qui demande une page annonce `text/html` : il recoit la page.
 * Tout le reste — un appel programme, un `fetch`, un moniteur — recoit le meme
 * JSON que les adresses en /api/, avec le meme message. Une page HTML envoyee
 * a un programme qui attendait du JSON est une erreur de plus a diagnostiquer,
 * pas une amabilite.
 *
 * ⚠️ IL VIENT APRES TOUT LE RESTE, y compris apres les fichiers de public/ :
 *    place plus haut, il repondrait a la place d'une photo ou d'une police.
 *
 * ⚠️ ET IL NE PASSE PAS PAR `next(erreur)` EN CAS DE PEPIN. Le filet ci-dessous
 *    repond 500 ; or ce qui est demande ici n'existe toujours pas. On retombe
 *    donc sur le JSON, avec le bon code.
 */
app.use(async (req, res) => {
  res.status(404);
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Robots-Tag', 'noindex, follow');

  const veutUnePage = String(req.headers.accept || '').includes('text/html');
  if (!veutUnePage) return res.json({ error: 'Adresse inconnue.' });

  try {
    res.type('html').send(await renderIntrouvable(res.locals.cspNonce));
  } catch (erreur) {
    console.error('Page introuvable non rendue :', erreur.message);
    res.json({ error: 'Adresse inconnue.' });
  }
});

// Filet de securite : si une route echoue de facon imprevue, on trace l'erreur
// complete dans la console du serveur mais on n'en renvoie rien au visiteur.
// Le detail d'une panne peut trahir la structure interne du site.
app.use((erreur, req, res, next) => {
  console.error(`Erreur sur ${req.method} ${req.originalUrl} :`, erreur);
  if (res.headersSent) return next(erreur);
  res.status(500).json({ error: 'Une erreur interne est survenue.' });
});

/**
 * Verifie que les reglages de mise en ligne se tiennent entre eux.
 *
 * Une instance en ligne mais demarree sans NODE_ENV=production fonctionne en
 * apparence : le site s'affiche, on se connecte, tout semble normal. Deux choses
 * manquent pourtant en silence — le cookie de session n'est plus marque "Secure",
 * et le serveur ne sait pas qu'il est derriere le relais de l'hebergeur, si bien
 * que les tentatives de connexion de tous les visiteurs sont comptees dans le
 * meme panier. Un oubli qui ne se voit pas est un oubli qui dure : on le dit.
 */
function verifierMiseEnLigne() {
  if (PUBLIC_URL.startsWith('https://') && !IS_PRODUCTION) {
    console.log('');
    console.log('  ATTENTION : PUBLIC_URL designe un site en ligne, mais NODE_ENV n\'est');
    console.log('  pas "production". Le cookie de session n\'est donc pas marque Secure,');
    console.log('  et le relais de l\'hebergeur n\'est pas pris en compte.');
    console.log('  Poser NODE_ENV=production dans les variables de l\'hebergeur.');
    console.log('');
  }

  if (IS_PRODUCTION && !PUBLIC_URL) {
    console.log('');
    console.log('  Note : PUBLIC_URL n\'est pas renseignee. Le site fonctionne, mais sa');
    console.log('  page ne porte ni adresse canonique ni og:url — les moteurs de');
    console.log('  recherche et les apercus de lien s\'en servent.');
    console.log('');
  }
}

app.listen(PORT, async () => {
  console.log(`L'Etabli : serveur demarre sur http://localhost:${PORT}`);
  console.log(`Test de vie      : http://localhost:${PORT}/api/health`);

  verifierMiseEnLigne();

  // Menage des sessions perimees, et rappel si l'espace commercant n'a pas
  // encore de compte : sans compte, il est tout simplement inaccessible.
  try {
    const perimees = await purgeExpiredSessions();
    if (perimees > 0) console.log(`Sessions expirees supprimees : ${perimees}`);

    // Vitrine de demonstration : compte d'acces public, base reconstruite si
    // elle est vide, remise a zero programmee chaque nuit.
    if (DEMO_MODE) await startDemo();

    // Suppression des rendez-vous trop anciens, comme l'annonce la page de
    // confidentialite.
    startRetention();

    // Le plan du quartier, si l'adresse a change ou s'il n'existe pas encore.
    //
    // Ici plutot qu'a la premiere visite : il faut une dizaine de secondes et
    // deux appels a des services exterieurs, personne ne doit les attendre. Sur
    // une instance sans disque persistant (la demonstration), c'est aussi ce qui
    // le redessine a chaque redemarrage. `planifierPlan` ne leve jamais et ne
    // fait rien si le plan est deja a jour.
    const reglages = await prisma.settings.findUnique({ where: { id: 1 } });
    if (reglages) {
      planifierPlan({
        street: reglages.street,
        postalCode: reglages.postalCode,
        city: reglages.city,
      });
    }

    const comptes = await prisma.adminUser.count();
    if (comptes === 0) {
      console.log('');
      console.log('  ATTENTION : aucun compte pour l\'espace commercant.');
      console.log('  Le creer avec :  npm run admin:create -- <identifiant>');
      console.log('');
    }
  } catch (erreur) {
    console.error('Verification au demarrage impossible :', erreur.message);
  }
});
