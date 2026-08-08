// ---------------------------------------------------------------------------
// LES REGLAGES DU COMMERCE
//
// Ce fichier fait le pont entre deux facons d'ecrire la meme chose :
//
//   la base       heures en minutes (570), prix en centimes (3200), une ligne
//                 par jour de la semaine, des champs a plat (businessName...)
//   le site       heures en "09:30", prix en euros (32), un objet `hours`
//                 range par jour, des champs groupes (salon.name...)
//
// La forme "site" est celle de l'objet CONFIG deja present dans le HTML. La
// conserver telle quelle est deliberé : au point 6, brancher l'espace reglages
// reviendra a remplacer le contenu de `settingsStore` par des appels reseau,
// sans toucher au reste du code.
//
// On y refait aussi tous les controles de validite que le site appliquait deja.
// Le navigateur peut etre contourne ; le serveur, non.
// ---------------------------------------------------------------------------

import { prisma } from '../db.js';
import { OCCUPENT } from './annulation.js';
import { toMin, toHHMM, todayIso } from './time.js';
import { DEFAULT_CONFIG } from './defaults.js';

const JOURS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];

/**
 * Les photos de l'equipe : une image deja reduite par le navigateur, ecrite
 * dans la base sous forme de texte (voir `Staff.photo` dans le schema).
 *
 * Deux garde-fous, et ils comptent : le format est verifie caractere par
 * caractere — on n'accepte donc pas n'importe quelle "data:URL", en particulier
 * pas une image SVG, qui peut contenir du code — et la taille est bornee, sans
 * quoi un envoi de 5 Mo suffirait a alourdir chaque affichage de la page.
 *
 * 200 000 caracteres, c'est environ 150 ko : trois fois ce que produit le
 * redimensionnement du site, de quoi laisser passer une photo un peu detaillee
 * sans laisser passer un fichier brut sorti d'un appareil.
 */
const PHOTO_MAX_CARACTERES = 200000;
const PHOTO_FORMAT = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

/** Les sept jours d'une semaine sous la forme du site : `{0: null, 1: {...}}`. */
function joursDepuisLignes(lignes) {
  const parJour = {};

  for (let jour = 0; jour < 7; jour++) {
    const ligne = lignes.find((h) => h.weekday === jour);

    if (!ligne || ligne.closed) {
      parJour[jour] = null;
      continue;
    }

    parJour[jour] = {
      open: toHHMM(ligne.openMin),
      close: toHHMM(ligne.closeMin),
      pause: ligne.pauseStartMin !== null && ligne.pauseEndMin !== null
        ? [toHHMM(ligne.pauseStartMin), toHHMM(ligne.pauseEndMin)]
        : null,
    };
  }

  return parJour;
}

/** Duree lisible : 90 -> "1h30", 45 -> "45 min". */
function dureeLisible(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

// --- De la base vers le site ----------------------------------------------

/** Assemble les lignes de la base en un objet de la forme de CONFIG. */
export function dbToConfig({ settings, hours, services, staff = [], categories = [], testimonials = [] }) {
  const parJour = joursDepuisLignes(hours);

  return {
    salon: {
      name: settings.businessName,
      street: settings.street,
      postalCode: settings.postalCode,
      city: settings.city,
      phone: settings.phone,
      email: settings.email,
      // Chaines vides plutot que `null` quand rien n'est renseigne : le site
      // compare des brouillons entiers pour savoir s'ils ont ete modifies, et
      // deux ecritures du vide s'y verraient comme une difference. Meme raison
      // que pour `photo` et `category` plus bas.
      links: {
        google: settings.googleUrl ?? '',
        instagram: settings.instagramUrl ?? '',
        facebook: settings.facebookUrl ?? '',
      },
    },
    reviews: { rating: settings.ratingValue, count: settings.ratingCount },
    // Liste vide = la section « Avis » ne s'affiche pas. Rien d'autre a decider :
    // ces temoignages ne sont lus que par la vitrine.
    testimonials: testimonials.map((t) => ({
      id: t.id,
      quote: t.quote,
      author: t.author,
      meta: t.meta,
      rating: t.rating,
    })),
    hours: parJour,
    slotStep: settings.slotStepMin,
    leadTimeMinutes: settings.leadTimeMin,
    // Liste vide = commerce sans categorie, et le site retrouve exactement son
    // affichage d'origine (voir le modele Category).
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      desc: c.description,
    })),
    services: services.map((s) => ({
      id: s.id,
      name: s.name,
      desc: s.description,
      duration: s.durationMin,
      price: s.priceCents / 100,
      active: s.active,
      // Chaine vide plutot que `null` : le site compare des brouillons entiers
      // pour savoir s'ils ont ete modifies, et deux ecritures du vide s'y
      // verraient comme une difference. Meme raison que pour `photo` plus bas.
      //
      // Un rayon absent de cette vue ne doit jamais etre annonce : le site s'y
      // refererait sans pouvoir le resoudre.
      category: categories.some((c) => c.id === s.categoryId) ? s.categoryId : '',
    })),
    // Les liens vers des prestations absentes de cette vue (mises en pause dans
    // la reponse publique) sont retires : le site ne doit jamais recevoir un
    // identifiant qu'il ne peut pas resoudre.
    staff: staff.map((p) => ({
      id: p.id,
      name: p.name,
      role: p.role,
      color: p.color,
      // Chaine vide plutot que `null` : le site compare des brouillons entiers
      // pour savoir s'ils ont ete modifies, et deux ecritures du vide s'y
      // verraient comme une difference.
      photo: p.photo ?? '',
      active: p.active,
      // `services` est une liste d'identifiants : vide = elle assure tout.
      services: (p.serviceLinks ?? [])
        .map((l) => l.serviceId)
        .filter((id) => services.some((s) => s.id === id)),
      // `null` = cette personne suit les horaires du commerce. C'est le cas
      // courant, et il ne demande aucune ligne en base.
      hours: (p.hours ?? []).length ? joursDepuisLignes(p.hours) : null,
    })),
  };
}

/**
 * Les reglages tels que le site doit les voir.
 *
 * `includeInactive` distingue les deux publics : le site public ne recoit que
 * les prestations reellement proposees, l'espace commercant recoit tout, y
 * compris celles mises en pause, puisqu'il doit pouvoir les rallumer.
 */
export async function loadConfig({ includeInactive = false } = {}) {
  const [settings, hours, services, staff, categories, testimonials] = await Promise.all([
    prisma.settings.findUnique({ where: { id: 1 } }),
    prisma.openingHours.findMany(),
    prisma.service.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: { position: 'asc' },
    }),
    prisma.staff.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
      include: { serviceLinks: true, hours: true },
    }),
    prisma.category.findMany({ orderBy: [{ position: 'asc' }, { id: 'asc' }] }),
    // Les temoignages ne connaissent pas la mise en pause : ils sont affiches ou
    // supprimes. Les deux publics recoivent donc la meme liste.
    prisma.testimonial.findMany({ orderBy: [{ position: 'asc' }, { id: 'asc' }] }),
  ]);

  if (!settings) {
    throw new Error(
      "Les reglages sont absents de la base. Lancer `npm run db:seed` pour la remplir."
    );
  }

  return dbToConfig({ settings, hours, services, staff, categories, testimonials });
}

// --- Du site vers la base --------------------------------------------------

/** Texte nettoye : espaces superflus retires, longueur bornee. */
function texte(valeur, maxi) {
  if (typeof valeur !== 'string') return '';
  return valeur.trim().slice(0, maxi);
}

/** Nombre exploitable, en acceptant la virgule francaise ("32,50"). */
function nombre(valeur) {
  if (typeof valeur === 'number') return Number.isFinite(valeur) ? valeur : NaN;
  if (typeof valeur === 'string') return parseFloat(valeur.replace(',', '.'));
  return NaN;
}

/** Identifiant d'une prestation nouvellement creee, independant de son nom. */
function nouvelIdentifiant() {
  return 'svc-' + Math.random().toString(36).slice(2, 8);
}

/** Meme chose pour une personne : les rendez-vous stockent cet identifiant. */
function nouvelIdentifiantPersonne() {
  return 'stf-' + Math.random().toString(36).slice(2, 8);
}

/** Et pour un rayon du catalogue. */
function nouvelIdentifiantCategorie() {
  return 'cat-' + Math.random().toString(36).slice(2, 8);
}

/** Et pour un temoignage. */
function nouvelIdentifiantTemoignage() {
  return 'tmo-' + Math.random().toString(36).slice(2, 8);
}

/**
 * Remet en forme ce qui arrive du reseau : on ne suppose rien de la structure
 * recue, on reconstruit un objet propre champ par champ.
 */
/** Remet en forme les sept jours d'une semaine, commerce ou personne. */
function normaliserSemaine(recu) {
  const semaine = {};
  const source = recu && typeof recu === 'object' ? recu : {};

  for (let jour = 0; jour < 7; jour++) {
    const brutJour = source[jour] ?? source[String(jour)];

    if (!brutJour || typeof brutJour !== 'object') {
      semaine[jour] = null;
      continue;
    }

    const pause = Array.isArray(brutJour.pause) && brutJour.pause.length === 2
      ? [texte(brutJour.pause[0], 5), texte(brutJour.pause[1], 5)]
      : null;

    semaine[jour] = {
      open: texte(brutJour.open, 5),
      close: texte(brutJour.close, 5),
      pause,
    };
  }

  return semaine;
}

/**
 * Une adresse web saisie par le commercant, remise en forme.
 *
 * Une adresse tapee sans protocole (« instagram.com/mon-salon », ce que tout le
 * monde ecrit) se voit prefixer `https://` plutot que d'etre refusee : la
 * corriger vaut mieux que renvoyer quelqu'un a son formulaire pour cela.
 *
 * Ce qui n'est pas rattrapable est laisse TEL QUEL, et non efface en silence :
 * `validateConfig` pourra alors le refuser en le nommant. Une adresse qui
 * disparait sans un mot est le pire des deux mondes — le commercant croit
 * l'avoir enregistree.
 */
function lien(valeur) {
  const brut = texte(valeur, 300);
  if (!brut) return '';

  // Deja un protocole (quel qu'il soit) : on n'y touche pas. C'est
  // `validateConfig` qui dira si celui-la est acceptable.
  if (/^[a-z][a-z0-9+.-]*:/i.test(brut)) return brut;

  return `https://${brut}`;
}

/** Vrai si cette adresse peut etre posee dans un `href` sans danger. */
function lienAcceptable(valeur) {
  return /^https?:\/\/[^\s/]+\.[^\s/]/i.test(valeur);
}

export function normalizeConfig(brut) {
  const entree = brut && typeof brut === 'object' ? brut : {};
  const salon = entree.salon && typeof entree.salon === 'object' ? entree.salon : {};
  const liens = salon.links && typeof salon.links === 'object' ? salon.links : {};
  const reviews = entree.reviews && typeof entree.reviews === 'object' ? entree.reviews : {};

  const hours = normaliserSemaine(entree.hours);

  // Les rayons viennent en premier : les prestations juste en dessous s'y
  // referent, et un lien vers un rayon inconnu doit pouvoir etre ecarte.
  const categories = (Array.isArray(entree.categories) ? entree.categories : []).map((c) => {
    const source = c && typeof c === 'object' ? c : {};
    return {
      id: texte(source.id, 40) || nouvelIdentifiantCategorie(),
      name: texte(source.name, 120),
      desc: texte(source.desc, 600),
    };
  });

  const services = (Array.isArray(entree.services) ? entree.services : []).map((s) => {
    const source = s && typeof s === 'object' ? s : {};
    const rayon = texte(source.category, 40);
    return {
      id: texte(source.id, 40) || nouvelIdentifiant(),
      name: texte(source.name, 120),
      desc: texte(source.desc, 600),
      duration: Math.round(nombre(source.duration)),
      price: nombre(source.price),
      // Une prestation est proposee sauf mention contraire explicite : c'est la
      // regle que suivait deja le site pour les reglages enregistres avant
      // l'arrivee de la mise en pause.
      active: source.active !== false,
      // Un rayon supprime dans le meme envoi est simplement oublie : la
      // prestation retombe dans "Autres prestations" au lieu de faire echouer
      // tout l'enregistrement. Meme regle que pour les liens de l'equipe.
      category: categories.some((c) => c.id === rayon) ? rayon : '',
    };
  });

  const testimonials = (Array.isArray(entree.testimonials) ? entree.testimonials : []).map((t) => {
    const source = t && typeof t === 'object' ? t : {};
    const etoiles = Math.round(nombre(source.rating));
    return {
      id: texte(source.id, 40) || nouvelIdentifiantTemoignage(),
      quote: texte(source.quote, 400),
      author: texte(source.author, 80),
      meta: texte(source.meta, 80),
      // Cinq etoiles par defaut : c'est ce qu'on recopie de sa fiche Google dans
      // la quasi-totalite des cas, et le champ n'a alors pas a etre touche.
      rating: Number.isFinite(etoiles) ? etoiles : 5,
    };
  });

  const staff = (Array.isArray(entree.staff) ? entree.staff : []).map((p) => {
    const source = p && typeof p === 'object' ? p : {};

    // Les liens vers des prestations qui n'existent plus sont ecartes ici :
    // supprimer une prestation ne doit pas empecher d'enregistrer l'equipe.
    const assurees = (Array.isArray(source.services) ? source.services : [])
      .map((id) => texte(id, 40))
      .filter((id) => id && services.some((s) => s.id === id));

    return {
      id: texte(source.id, 40) || nouvelIdentifiantPersonne(),
      name: texte(source.name, 120),
      role: texte(source.role, 80),
      color: texte(source.color, 20),
      // Bornee a un caractere de plus que le maximum admis : la valeur trop
      // longue survit donc jusqu'a validateConfig, qui pourra la refuser avec
      // un message, au lieu d'etre tronquee en silence en une image cassee.
      photo: texte(source.photo, PHOTO_MAX_CARACTERES + 1),
      // Meme regle que pour une prestation : active sauf mention contraire.
      active: source.active !== false,
      services: [...new Set(assurees)],
      // `null` (ou absent) = suit les horaires du commerce. Un objet = horaires
      // propres, les sept jours etant alors tous decrits.
      hours: source.hours && typeof source.hours === 'object'
        ? normaliserSemaine(source.hours)
        : null,
    };
  });

  return {
    salon: {
      name: texte(salon.name, 120),
      street: texte(salon.street, 160),
      postalCode: texte(salon.postalCode, 20),
      city: texte(salon.city, 100),
      phone: texte(salon.phone, 40),
      email: texte(salon.email, 160),
      links: {
        google: lien(liens.google),
        instagram: lien(liens.instagram),
        facebook: lien(liens.facebook),
      },
    },
    reviews: {
      rating: nombre(reviews.rating),
      count: Math.round(nombre(reviews.count)),
    },
    testimonials,
    hours,
    slotStep: Number.isFinite(nombre(entree.slotStep)) ? Math.round(nombre(entree.slotStep)) : DEFAULT_CONFIG.slotStep,
    leadTimeMinutes: Number.isFinite(nombre(entree.leadTimeMinutes)) ? Math.round(nombre(entree.leadTimeMinutes)) : DEFAULT_CONFIG.leadTimeMinutes,
    categories,
    services,
    staff,
  };
}

/**
 * Verifie une semaine d'horaires, celle du commerce comme celle d'une personne.
 * `pour` complete le message ("Camille : horaires invalides pour Mardi.").
 */
function verifierSemaine(semaine, pour = '') {
  const prefixe = pour ? `${pour} : h` : 'H';

  for (let jour = 0; jour < 7; jour++) {
    const h = semaine[jour];
    if (!h) continue;

    const ouverture = toMin(h.open);
    const fermeture = toMin(h.close);

    if (ouverture === null || fermeture === null || ouverture >= fermeture) {
      return `${prefixe}oraires invalides pour ${JOURS[jour]}.`;
    }

    if (h.pause) {
      const debut = toMin(h.pause[0]);
      const fin = toMin(h.pause[1]);

      if (debut === null || fin === null || debut >= fin) {
        return `${pour ? pour + ' : p' : 'P'}ause invalide pour ${JOURS[jour]}.`;
      }
      if (debut < ouverture || fin > fermeture) {
        return `${pour ? pour + ' : l' : 'L'}a pause doit être comprise dans les horaires (${JOURS[jour]}).`;
      }
    }
  }

  return null;
}

/** Les colonnes d'une ligne d'horaire, commerce ou personne. `null` = fermé. */
function colonnesHoraire(h) {
  if (!h) {
    return { closed: true, openMin: null, closeMin: null, pauseStartMin: null, pauseEndMin: null };
  }
  return {
    closed: false,
    openMin: toMin(h.open),
    closeMin: toMin(h.close),
    pauseStartMin: h.pause ? toMin(h.pause[0]) : null,
    pauseEndMin: h.pause ? toMin(h.pause[1]) : null,
  };
}

/** Les plages d'une journee decrite a la facon du site : `{open, close, pause}`. */
function plagesDuJour(h) {
  if (!h) return [];
  return h.pause
    ? [[toMin(h.open), toMin(h.pause[0])], [toMin(h.pause[1]), toMin(h.close)]]
    : [[toMin(h.open), toMin(h.close)]];
}

/**
 * Controles de coherence, repris un a un de ceux du site.
 * Renvoie un message d'erreur, ou null si tout va bien.
 */
export function validateConfig(config) {
  const { salon, reviews, hours, services, staff, categories, testimonials } = config;

  if (!salon.name) return 'Le nom du commerce est obligatoire.';
  if (!salon.street || !salon.postalCode || !salon.city) return "L'adresse est incomplète.";
  if (!salon.phone) return 'Le téléphone est obligatoire.';
  if (!salon.email || !salon.email.includes('@')) return "L'email n'est pas valide.";

  // Les liens sont FACULTATIFS — un commerce sans Instagram n'a rien à remplir —
  // mais ceux qui sont renseignés deviennent des `href` sur la vitrine. Un
  // « javascript:… » collé dans le champ Instagram ferait exécuter du code chez
  // chaque visiteur qui cliquerait dessus : seuls http et https passent.
  const LIENS = { google: 'la fiche Google', instagram: 'Instagram', facebook: 'Facebook' };
  for (const [cle, intitule] of Object.entries(LIENS)) {
    const adresse = salon.links[cle];
    if (adresse && !lienAcceptable(adresse)) {
      return `L'adresse de ${intitule} n'est pas une adresse web valide (elle doit commencer par https://).`;
    }
  }

  if (!(reviews.rating >= 0 && reviews.rating <= 5)) return 'La note doit être comprise entre 0 et 5.';
  if (!(reviews.count >= 0)) return "Le nombre d'avis est invalide.";

  // --- Les temoignages -----------------------------------------------------
  //
  // Une liste vide est parfaitement valable : c'est le commerce qui vient
  // d'ouvrir, et la section « Avis » disparait de la vitrine. Ce qu'on refuse,
  // c'est le temoignage a moitie rempli — une citation sans nom, ou un nom sans
  // citation, laisserait une carte bancale sur la page d'accueil.
  const identifiantsTemoignages = new Set();
  for (const [index, t] of testimonials.entries()) {
    if (identifiantsTemoignages.has(t.id)) {
      return `Deux témoignages portent le même identifiant (${t.id}).`;
    }
    identifiantsTemoignages.add(t.id);

    if (!t.quote) return `Le témoignage ${index + 1} est vide : écrivez-le, ou supprimez-le.`;
    if (!t.author) return `Le témoignage ${index + 1} doit indiquer de qui il vient.`;
    if (!(t.rating >= 1 && t.rating <= 5)) {
      return `Le nombre d'étoiles du témoignage ${index + 1} doit être compris entre 1 et 5.`;
    }
  }

  if (!(config.slotStep > 0)) return 'Le pas des créneaux doit être supérieur à zéro.';
  if (!(config.leadTimeMinutes >= 0)) return 'Le délai minimum de réservation est invalide.';

  const auMoinsUnJour = [0, 1, 2, 3, 4, 5, 6].some((j) => hours[j]);
  if (!auMoinsUnJour) return 'Le commerce doit être ouvert au moins un jour.';

  const problemeHoraires = verifierSemaine(hours);
  if (problemeHoraires) return problemeHoraires;

  if (!services.length) return 'Le commerce doit proposer au moins une prestation.';
  if (!services.some((s) => s.active)) {
    return 'Au moins une prestation doit rester proposée en ligne, sinon la réservation devient impossible.';
  }

  const identifiants = new Set();
  for (const s of services) {
    if (identifiants.has(s.id)) return `Deux prestations portent le même identifiant (${s.id}).`;
    identifiants.add(s.id);
  }

  // --- Les rayons du catalogue ---------------------------------------------
  //
  // Une liste vide est parfaitement valable : c'est le commerce qui n'a pas
  // besoin de ranger ses prestations, et rien de ce qui suit ne s'applique.
  //
  // Un rayon VIDE l'est aussi : on le laisse passer. Le commercant qui vient de
  // creer "Soins" et n'a pas encore coche ses prestations serait sinon arrete au
  // milieu de son geste, alors que le site se contente de ne pas l'afficher.

  const identifiantsRayons = new Set();
  for (const [index, c] of categories.entries()) {
    if (!c.name) return `La catégorie ${index + 1} doit avoir un nom.`;
    if (identifiantsRayons.has(c.id)) return `Deux catégories portent le même identifiant (${c.id}).`;
    identifiantsRayons.add(c.id);
  }

  const nomsRayons = new Set();
  for (const c of categories) {
    const repere = c.name.toLocaleLowerCase('fr');
    if (nomsRayons.has(repere)) {
      return `Deux catégories s'appellent « ${c.name} » : impossible de les distinguer sur le site.`;
    }
    nomsRayons.add(repere);
  }

  // Plus longue plage reservable d'une semaine type : une pause coupe la
  // journee en deux. Au-dela, une prestation n'aurait jamais aucun creneau.
  let plusLongue = 0;
  for (let jour = 0; jour < 7; jour++) {
    for (const [debut, fin] of plagesDuJour(hours[jour])) {
      plusLongue = Math.max(plusLongue, fin - debut);
    }
  }

  for (const [index, s] of services.entries()) {
    if (!s.name) return `La prestation ${index + 1} doit avoir un nom.`;
    if (!(s.duration > 0)) return `Durée invalide pour ${s.name}.`;
    if (!(s.price >= 0)) return `Tarif invalide pour ${s.name}.`;
    if (s.duration > plusLongue) {
      return `La durée de « ${s.name} » (${dureeLisible(s.duration)}) dépasse la plus longue plage `
        + `d'ouverture continue (${dureeLisible(plusLongue)}) : aucun créneau ne pourrait être proposé.`;
    }
  }

  // --- L'equipe ------------------------------------------------------------
  //
  // Une equipe vide est parfaitement valable : c'est le commerce qui travaille
  // seul, et rien de ce qui suit ne s'applique.

  const identifiantsEquipe = new Set();
  for (const [index, p] of staff.entries()) {
    if (!p.name) return `La personne ${index + 1} doit avoir un nom.`;
    if (identifiantsEquipe.has(p.id)) return `Deux personnes portent le même identifiant (${p.id}).`;
    identifiantsEquipe.add(p.id);

    if (p.photo) {
      if (p.photo.length > PHOTO_MAX_CARACTERES) {
        return `La photo de ${p.name} est trop lourde. Choisissez-en une plus légère.`;
      }
      if (!PHOTO_FORMAT.test(p.photo)) {
        return `La photo de ${p.name} n'est pas dans un format accepté (JPEG, PNG ou WebP).`;
      }
    }

    if (!p.hours) continue;   // suit le commerce : rien à vérifier

    const probleme = verifierSemaine(p.hours, p.name);
    if (probleme) return probleme;

    // Des horaires propres ne peuvent que réduire ceux du commerce : le calcul
    // en fait l'intersection. Reste à écarter le réglage SANS AUCUN EFFET
    // UTILE — quelqu'un qui ne travaillerait à aucun moment d'ouverture. Il
    // n'apparaîtrait nulle part, sans que rien ne l'explique.
    let minutesUtiles = 0;
    for (let jour = 0; jour < 7; jour++) {
      for (const [debutP, finP] of plagesDuJour(p.hours[jour])) {
        for (const [debutC, finC] of plagesDuJour(hours[jour])) {
          minutesUtiles += Math.max(0, Math.min(finP, finC) - Math.max(debutP, debutC));
        }
      }
    }
    if (p.active && minutesUtiles === 0) {
      return `Les horaires de ${p.name} ne recoupent jamais ceux du commerce : `
        + 'cette personne ne pourrait recevoir aucun rendez-vous.';
    }
  }

  if (staff.length) {
    // Tout mettre en pause ramenerait silencieusement le commerce a un agenda
    // unique — les rendez-vous continueraient d'entrer, sans personne pour les
    // assurer. Mieux vaut le refuser que le laisser surprendre.
    if (!staff.some((p) => p.active)) {
      return "Au moins une personne de l'équipe doit rester active, sinon plus personne "
        + 'ne peut assurer les rendez-vous.';
    }

    // Une prestation que personne ne revendique est assuree par toute l'equipe
    // (voir dbToConfig) ; elle est donc toujours couverte. Le seul trou possible
    // est une prestation confiee a des personnes toutes mises en pause.
    for (const s of services.filter((s) => s.active)) {
      const lies = staff.filter((p) => p.services.includes(s.id));
      if (lies.length && !lies.some((p) => p.active)) {
        return `« ${s.name} » n'est plus assurée par personne d'actif : elle ne pourrait `
          + 'jamais être réservée. Confiez-la à quelqu\'un, ou mettez-la en pause.';
      }
    }
  }

  return null;
}

/**
 * Prestations sur le point de disparaitre alors qu'elles portent encore des
 * rendez-vous a venir.
 *
 * Les rendez-vous ne sont jamais supprimes : ils perdent seulement leur lien
 * (onDelete: SetNull) et s'afficheront dans l'agenda sous « Prestation retirée ».
 * Mieux vaut malgre tout prevenir avant, comme le faisait le site.
 */
export async function findRemovalsWithBookings(idsConserves) {
  const conserves = new Set(idsConserves);
  const existantes = await prisma.service.findMany();
  const supprimees = existantes.filter((s) => !conserves.has(s.id));
  if (!supprimees.length) return [];

  const aujourdhui = todayIso();
  const menacees = [];

  for (const prestation of supprimees) {
    const nombre = await prisma.booking.count({
      where: { serviceId: prestation.id, kind: 'appt', date: { gte: aujourdhui }, ...OCCUPENT },
    });
    if (nombre > 0) menacees.push({ id: prestation.id, name: prestation.name, upcoming: nombre });
  }

  return menacees;
}

/**
 * Meme garde-fou, pour les personnes.
 *
 * Il compte davantage encore que pour une prestation : les rendez-vous d'une
 * personne supprimee perdent leur `staffId` (onDelete: SetNull), et un
 * rendez-vous sans personne OCCUPE TOUT LE MONDE. Supprimer quelqu'un a la
 * legere, c'est donc voir le reste de l'equipe se retrouver bloquee sur ses
 * anciens creneaux, sans que rien n'explique pourquoi.
 */
export async function findStaffRemovalsWithBookings(idsConserves) {
  const conserves = new Set(idsConserves);
  const existantes = await prisma.staff.findMany();
  const supprimees = existantes.filter((p) => !conserves.has(p.id));
  if (!supprimees.length) return [];

  const aujourdhui = todayIso();
  const menacees = [];

  for (const personne of supprimees) {
    const nombre = await prisma.booking.count({
      where: { staffId: personne.id, kind: 'appt', date: { gte: aujourdhui }, ...OCCUPENT },
    });
    if (nombre > 0) menacees.push({ id: personne.id, name: personne.name, upcoming: nombre });
  }

  return menacees;
}

/**
 * Enregistre les reglages.
 *
 * Tout se fait d'un seul bloc : si une seule ecriture echoue, aucune n'est
 * conservee. On ne peut pas se retrouver avec des horaires mis a jour mais des
 * prestations restees dans l'ancien etat.
 */
export async function saveConfig(config) {
  await prisma.$transaction(async (tx) => {
    // Les memes colonnes a la creation et a la mise a jour : les ecrire une
    // fois evite qu'un champ ajoute plus tard ne soit oublie d'un des deux
    // cotes, ce qui ne se verrait que sur une base neuve.
    const colonnes = {
      businessName: config.salon.name,
      street: config.salon.street,
      postalCode: config.salon.postalCode,
      city: config.salon.city,
      phone: config.salon.phone,
      email: config.salon.email,
      googleUrl: config.salon.links.google,
      instagramUrl: config.salon.links.instagram,
      facebookUrl: config.salon.links.facebook,
      ratingValue: config.reviews.rating,
      ratingCount: config.reviews.count,
      slotStepMin: config.slotStep,
      leadTimeMin: config.leadTimeMinutes,
    };

    await tx.settings.upsert({
      where: { id: 1 },
      create: { id: 1, ...colonnes },
      update: colonnes,
    });

    for (let jour = 0; jour < 7; jour++) {
      const valeurs = colonnesHoraire(config.hours[jour]);

      await tx.openingHours.upsert({
        where: { weekday: jour },
        create: { weekday: jour, ...valeurs },
        update: valeurs,
      });
    }

    // Les temoignages ne dependent de rien et rien n'en depend : leur place
    // dans cette transaction n'a aucune importance. Comme partout, ceux qui
    // sont absents de l'envoi sont retires — rien d'autre ne s'y rattache, il
    // n'y a donc aucun garde-fou a prevoir avant de supprimer.
    const temoignagesConserves = config.testimonials.map((t) => t.id);
    await tx.testimonial.deleteMany({ where: { id: { notIn: temoignagesConserves } } });

    for (const [position, t] of config.testimonials.entries()) {
      const valeurs = {
        quote: t.quote,
        author: t.author,
        meta: t.meta,
        rating: t.rating,
        position,
      };

      await tx.testimonial.upsert({
        where: { id: t.id },
        create: { id: t.id, ...valeurs },
        update: valeurs,
      });
    }

    // Les rayons viennent AVANT les prestations : celles-ci pointent dessus, et
    // un rayon doit deja exister quand on ecrit la prestation qui s'y range.
    //
    // Un rayon absent de l'envoi est retire, et ses prestations survivent
    // (onDelete: SetNull) : elles repassent simplement en « Autres prestations ».
    const rayonsConserves = config.categories.map((c) => c.id);
    await tx.category.deleteMany({ where: { id: { notIn: rayonsConserves } } });

    for (const [position, c] of config.categories.entries()) {
      const valeurs = { name: c.name, description: c.desc, position };

      await tx.category.upsert({
        where: { id: c.id },
        create: { id: c.id, ...valeurs },
        update: valeurs,
      });
    }

    // Les prestations absentes de l'envoi sont retirees. Leurs rendez-vous
    // survivent (onDelete: SetNull) et basculent sur « Prestation retirée ».
    const conserves = config.services.map((s) => s.id);
    await tx.service.deleteMany({ where: { id: { notIn: conserves } } });

    // L'ordre du tableau recu est celui affiche sur le site.
    for (const [position, s] of config.services.entries()) {
      const valeurs = {
        name: s.name,
        description: s.desc,
        durationMin: s.duration,
        priceCents: Math.round(s.price * 100),
        active: s.active,
        // `null` plutot que la chaine vide : dans la base, "sans rayon" est une
        // absence de lien, pas un lien vers un rayon nomme "".
        categoryId: s.category || null,
        position,
      };

      await tx.service.upsert({
        where: { id: s.id },
        create: { id: s.id, ...valeurs },
        update: valeurs,
      });
    }

    // L'equipe vient APRES les prestations : les liens qu'on pose juste en
    // dessous designent des prestations qui doivent deja exister.
    //
    // Comme pour les prestations, les personnes absentes de l'envoi sont
    // retirees, et leurs rendez-vous survivent (onDelete: SetNull).
    const equipeConservee = config.staff.map((p) => p.id);
    await tx.staff.deleteMany({ where: { id: { notIn: equipeConservee } } });

    for (const [position, p] of config.staff.entries()) {
      const valeurs = {
        name: p.name,
        role: p.role,
        color: p.color,
        // `null` plutot que la chaine vide : dans la base, "pas de photo" est
        // une absence, pas une image de longueur nulle.
        photo: p.photo || null,
        active: p.active,
        position,
      };

      await tx.staff.upsert({
        where: { id: p.id },
        create: { id: p.id, ...valeurs },
        update: valeurs,
      });

      // Les liaisons sont reecrites en bloc. Une liste vide efface donc les
      // liens, ce qui redonne la prestation a toute l'equipe : c'est ainsi
      // qu'on revient de "seule Camille fait les couleurs" a "tout le monde
      // les fait".
      await tx.serviceStaff.deleteMany({ where: { staffId: p.id } });
      for (const serviceId of p.services) {
        await tx.serviceStaff.create({ data: { staffId: p.id, serviceId } });
      }

      // Les horaires propres sont reecrits en bloc : plus simple a suivre qu'un
      // rapprochement jour par jour, et une semaine ne fait que sept lignes.
      // Aucune ligne = suit le commerce, ce qui est le cas le plus frequent.
      await tx.staffHours.deleteMany({ where: { staffId: p.id } });
      if (p.hours) {
        for (let jour = 0; jour < 7; jour++) {
          await tx.staffHours.create({
            data: { staffId: p.id, weekday: jour, ...colonnesHoraire(p.hours[jour]) },
          });
        }
      }
    }
  });
}
