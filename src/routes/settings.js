// ---------------------------------------------------------------------------
// API DES REGLAGES
//
// Remplace le module `settingsStore` du site.
//
//   GET  /api/config                    ouvert a tous : ce qu'affiche le site
//   GET  /api/admin/settings            commercant : tout, prestations en pause comprises
//   PUT  /api/admin/settings            commercant : enregistrer
//   POST /api/admin/settings/reset      commercant : revenir aux valeurs d'origine
//
// Pourquoi deux lectures ? Parce qu'une prestation mise en pause a ete
// volontairement retiree de la vitrine : elle n'a rien a faire dans la reponse
// publique. Le commercant, lui, doit continuer a la voir pour pouvoir la
// rallumer ou la caler a la main.
// ---------------------------------------------------------------------------

import express from 'express';
import { prisma } from '../db.js';
import { OCCUPENT } from '../lib/annulation.js';
import { DEMO_MODE } from '../config.js';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { todayIso } from '../lib/time.js';
import { DEFAULT_CONFIG } from '../lib/defaults.js';
import { DEMO_USERNAME, DEMO_PASSWORD, resetDemo } from '../lib/demo.js';
import {
  loadConfig,
  normalizeConfig,
  validateConfig,
  saveConfig,
  findRemovalsWithBookings,
  findStaffRemovalsWithBookings,
} from '../lib/settings.js';
import {
  EMPLACEMENTS, listerPhotos, deposerPhoto, retirerPhoto,
  listerLegendes, ecrireLegende, listerDescriptions, ecrireDescription,
} from '../lib/photos.js';
import { listerPlan, engendrerPlan, planifierPlan } from '../lib/plan.js';

export const settingsRouter = express.Router();

/**
 * Nombre de rendez-vous a venir, par prestation et par personne.
 *
 * Affiche dans l'espace reglages pour que le commercant mesure ce qu'il casse
 * avant de supprimer ou de mettre en pause l'une ou l'autre.
 */
async function comptesAVenir() {
  const aujourdhui = todayIso();
  const encours = { kind: 'appt', date: { gte: aujourdhui }, ...OCCUPENT };

  const [parService, parPersonne] = await Promise.all([
    prisma.booking.groupBy({ by: ['serviceId'], where: encours, _count: { _all: true } }),
    prisma.booking.groupBy({ by: ['staffId'], where: encours, _count: { _all: true } }),
  ]);

  const compter = (lignes, champ) => {
    const total = {};
    for (const ligne of lignes) {
      if (ligne[champ]) total[ligne[champ]] = ligne._count._all;
    }
    return total;
  };

  return {
    services: compter(parService, 'serviceId'),
    staff: compter(parPersonne, 'staffId'),
  };
}

/** Ajoute a chaque prestation et a chaque personne son nombre de rendez-vous. */
function avecCompteurs(config, compte) {
  return {
    ...config,
    services: config.services.map((s) => ({ ...s, upcoming: compte.services[s.id] ?? 0 })),
    staff: config.staff.map((p) => ({ ...p, upcoming: compte.staff[p.id] ?? 0 })),
  };
}

/**
 * GET /api/config — les reglages tels que le site public doit les voir.
 *
 * `demo` dit au site s'il tourne sur la vitrine de demonstration : c'est ce qui
 * lui fait afficher les identifiants d'acces sur l'ecran de connexion. Chez un
 * client, ce drapeau est faux et rien de tout cela n'apparait.
 */
settingsRouter.get('/config', async (req, res, next) => {
  try {
    const [config, photos, legendes, descriptions] = await Promise.all([
      loadConfig({ includeInactive: false }),
      // Les photos ne vivent pas dans la base mais sur le disque : elles sont
      // ajoutees ici, ou le site les attend, plutot que dans `loadConfig()` qui
      // ne traduit que la base. Les legendes de la galerie les accompagnent, et
      // arrivent a part : une case sans photo garde son degrade, mais garde
      // aussi sa legende.
      listerPhotos(),
      listerLegendes(),
      // Les descriptions lues a voix haute : la vitrine les pose en `alt` sur
      // chaque photo (lot 5).
      listerDescriptions(),
    ]);

    // Le plan du quartier, un fichier lui aussi — mais il a besoin de l'adresse :
    // un plan n'est servi que s'il a ete dessine pour celle-ci. `null` sinon,
    // et le bloc « Venir au salon » garde son degrade tout en restant cliquable
    // (voir src/lib/plan.js).
    const plan = await listerPlan(config.salon);

    const complet = { ...config, photos, legendes, descriptions, plan };
    res.json(DEMO_MODE
      ? { ...complet, demo: { username: DEMO_USERNAME, password: DEMO_PASSWORD } }
      : complet);
  } catch (erreur) {
    next(erreur);
  }
});

/**
 * POST /api/admin/demo/reset — remet la demonstration dans son etat de depart.
 *
 * Double du menage automatique de la nuit, pour que le visiteur suivant (ou
 * vous, avant un rendez-vous) retrouve une vitrine propre sans attendre.
 * N'existe pas hors demonstration : chez un client, cela effacerait son agenda.
 */
settingsRouter.post('/admin/demo/reset', requireAdmin, async (req, res, next) => {
  try {
    if (!DEMO_MODE) return res.status(404).json({ error: 'Adresse inconnue.' });

    await resetDemo();
    res.json({ ok: true, message: 'Démonstration remise à zéro.' });
  } catch (erreur) {
    next(erreur);
  }
});

/** GET /api/admin/settings — tout, y compris les prestations en pause. */
settingsRouter.get('/admin/settings', requireAdmin, async (req, res, next) => {
  try {
    const [config, compte] = await Promise.all([
      loadConfig({ includeInactive: true }),
      comptesAVenir(),
    ]);

    res.json(avecCompteurs(config, compte));
  } catch (erreur) {
    next(erreur);
  }
});

// --- Les photos de la vitrine ----------------------------------------------
//
// A part des reglages, et volontairement : ce sont des fichiers, pas des
// champs. Ils s'enregistrent donc au moment ou on les choisit, sans passer par
// le brouillon ni par le bouton « Enregistrer » (l'ecran le dit explicitement).
// Les melanger obligerait a transporter 500 ko d'images a chaque enregistrement
// d'un numero de telephone.

/**
 * PUT /api/admin/photos/:emplacement
 *   { data: "data:image/jpeg;base64,…", variantes: [{ largeur, format, donnees }] }
 *
 * La photo arrive deja reduite par le navigateur, et `variantes` porte les
 * largeurs supplementaires et les equivalents WebP qu'il a pu produire (voir
 * `reduireImage()` et `produireVariantes()`, js/08-reglages.js) — la liste
 * peut etre absente ou vide, un navigateur qui ne sait pas encoder du WebP
 * n'envoyant alors que la photo principale. Le serveur ne s'y fie pas pour
 * autant : il revoit le format et le poids de chaque piece, et n'ecrit que
 * dans les emplacements qu'il connait (src/lib/photos.js).
 */
settingsRouter.put('/admin/photos/:emplacement', requireAdmin, async (req, res, next) => {
  try {
    const resultat = await deposerPhoto(req.params.emplacement, req.body?.data, req.body?.variantes);
    if (resultat.erreur) return res.status(400).json({ error: resultat.erreur });

    res.json({ ok: true, photos: await listerPhotos() });
  } catch (erreur) {
    next(erreur);
  }
});

/**
 * DELETE /api/admin/photos/:emplacement
 *
 * Retire la photo deposee. On retombe alors sur celle livree avec le site, ou
 * sur le degrade : rien ne disparait vraiment, d'ou l'absence de confirmation.
 */
settingsRouter.delete('/admin/photos/:emplacement', requireAdmin, async (req, res, next) => {
  try {
    const resultat = await retirerPhoto(req.params.emplacement);
    if (resultat.erreur) return res.status(400).json({ error: resultat.erreur });

    res.json({ ok: true, photos: await listerPhotos() });
  } catch (erreur) {
    next(erreur);
  }
});

/**
 * GET /api/admin/photos — l'etat de chaque emplacement, pour l'ecran de depot.
 *
 * `EMPLACEMENTS` accompagne la reponse : la page y lit les intitules, les
 * conseils de cadrage et les dimensions attendues. Ainsi, ajouter une case a la
 * galerie un jour ne demandera de toucher qu'a src/lib/photos.js.
 */
settingsRouter.get('/admin/photos', requireAdmin, async (req, res, next) => {
  try {
    const [photos, legendes, descriptions] = await Promise.all([
      listerPhotos(), listerLegendes(), listerDescriptions(),
    ]);
    res.json({ emplacements: EMPLACEMENTS, photos, legendes, descriptions });
  } catch (erreur) {
    next(erreur);
  }
});

/**
 * PUT /api/admin/photos/:emplacement/legende  { texte: "L'espace salon" }
 *
 * La legende affichee sous une case de la galerie. Elle s'enregistre tout de
 * suite, comme la photo qu'elle accompagne, et non avec le brouillon des
 * reglages : les deux se modifient dans le meme geste, il serait deroutant que
 * l'une parte a l'instant et l'autre au bouton « Enregistrer ».
 */
settingsRouter.put('/admin/photos/:emplacement/legende', requireAdmin, async (req, res, next) => {
  try {
    const resultat = await ecrireLegende(req.params.emplacement, req.body?.texte);
    if (resultat.erreur) return res.status(400).json({ error: resultat.erreur });

    res.json({ ok: true, legendes: await listerLegendes() });
  } catch (erreur) {
    next(erreur);
  }
});

/**
 * PUT /api/admin/photos/:emplacement/description  { texte: "La devanture …" }
 *
 * LA DESCRIPTION LUE A VOIX HAUTE — l'attribut `alt`. Ce n'est PAS la legende :
 * celle-ci s'affiche sous la photo, celle-la la remplace pour qui ne la voit
 * pas. Les cinq photos du site avaient `alt=""`, c'est-a-dire « cette image
 * n'apporte rien », ce qui est faux de la devanture d'un commerce.
 *
 * Le visuel d'accueil l'accepte aussi, alors qu'il refuse une legende : il n'a
 * pas de texte sous lui, mais c'est la plus grande image du site.
 *
 * ⚠️ UNE DESCRIPTION VIDEE RETOMBE SUR CELLE LIVREE, contrairement a la
 *    legende. `alt=""` a un sens precis en HTML — « image decorative, ne
 *    l'annonce pas » — et ce n'est vrai d'aucune photo d'ici.
 */
settingsRouter.put('/admin/photos/:emplacement/description', requireAdmin, async (req, res, next) => {
  try {
    const resultat = await ecrireDescription(req.params.emplacement, req.body?.texte);
    if (resultat.erreur) return res.status(400).json({ error: resultat.erreur });

    res.json({ ok: true, descriptions: await listerDescriptions() });
  } catch (erreur) {
    next(erreur);
  }
});

/**
 * POST /api/admin/plan — redessiner le plan du quartier, tout de suite.
 *
 * Le plan se refait tout seul quand l'adresse change ; cette adresse-ci sert
 * aux deux cas ou cela ne suffit pas : les services d'OpenStreetMap n'ont pas
 * repondu ce jour-la, ou le plan est centre sur la mairie parce que la rue
 * n'etait pas encore cartographiee et qu'elle l'est depuis. Sans elle, le
 * commercant n'aurait aucun recours — il faudrait ressaisir son adresse pour
 * faire semblant de la changer.
 *
 * On ATTEND le resultat, contrairement a l'enregistrement des reglages : ici,
 * c'est precisement ce qu'on est venu faire, et un bouton qui rend la main sans
 * rien dire laisserait croire a un echec.
 */
settingsRouter.post('/admin/plan', requireAdmin, async (req, res, next) => {
  try {
    const config = await loadConfig({ includeInactive: true });
    const resultat = await engendrerPlan(config.salon, { force: true });

    if (!resultat.ok) return res.status(502).json({ error: resultat.erreur });

    res.json({ ok: true, precision: resultat.precision, plan: await listerPlan(config.salon) });
  } catch (erreur) {
    next(erreur);
  }
});

/**
 * Enregistre un jeu de reglages apres validation.
 * Partage par l'enregistrement normal et par la reinitialisation.
 */
async function enregistrer(brut, { confirmRemovals }, res) {
  const config = normalizeConfig(brut);

  // LE CHAMP PART AVEC LE MESSAGE. L'ecran s'en sert pour marquer la case
  // fautive et l'amener sous les yeux : dans un formulaire de quarante champs,
  // une phrase sans adresse laisse chercher (voir `refus()`, src/lib/settings.js).
  const probleme = validateConfig(config);
  if (probleme) return res.status(400).json({ error: probleme.message, champ: probleme.champ });

  // Prevenir avant de faire disparaitre une prestation ou une personne encore
  // attendue. Les deux listes partent ensemble : un commercant qui reorganise
  // son salon peut fort bien retirer les deux d'un coup, et il vaut mieux lui
  // montrer l'ardoise complete que le faire confirmer deux fois de suite.
  const [prestationsMenacees, equipeMenacee] = await Promise.all([
    findRemovalsWithBookings(config.services.map((s) => s.id)),
    findStaffRemovalsWithBookings(config.staff.map((p) => p.id)),
  ]);

  if ((prestationsMenacees.length || equipeMenacee.length) && confirmRemovals !== true) {
    const quoi = [
      prestationsMenacees.length ? 'des prestations' : null,
      equipeMenacee.length ? 'des personnes' : null,
    ].filter(Boolean).join(' et ');

    return res.status(409).json({
      error: `Sur le point d'être supprimées, ${quoi} portent encore des rendez-vous à venir.`,
      needsConfirmation: true,
      removals: prestationsMenacees,
      staffRemovals: equipeMenacee,
    });
  }

  await saveConfig(config);

  // Le plan du quartier suit l'adresse, mais SANS FAIRE ATTENDRE : le dessin
  // demande deux appels a des services exterieurs et une dizaine de secondes.
  // Les attendre ici ferait patienter un commercant qui vient de corriger son
  // numero de telephone, pour un plan qu'il ne regarde pas a cet instant.
  // `planifierPlan` ne fait rien si l'adresse n'a pas bouge.
  planifierPlan(config.salon);

  const [enregistre, compte] = await Promise.all([
    loadConfig({ includeInactive: true }),
    comptesAVenir(),
  ]);

  return res.json(avecCompteurs(enregistre, compte));
}

/** PUT /api/admin/settings — enregistrement depuis le formulaire. */
settingsRouter.put('/admin/settings', requireAdmin, async (req, res, next) => {
  try {
    await enregistrer(req.body, { confirmRemovals: req.body?.confirmRemovals }, res);
  } catch (erreur) {
    next(erreur);
  }
});

/**
 * POST /api/admin/settings/reset — retour aux valeurs d'origine.
 * Ces valeurs sont celles de src/lib/defaults.js, le fichier adapte par client.
 */
settingsRouter.post('/admin/settings/reset', requireAdmin, async (req, res, next) => {
  try {
    await enregistrer(DEFAULT_CONFIG, { confirmRemovals: req.body?.confirmRemovals }, res);
  } catch (erreur) {
    next(erreur);
  }
});
