// ---------------------------------------------------------------------------
// TESTS DU FRANCAIS ECRIT (lot 3b)
//
//     npm start             (terminal 1, laisse ouvert)
//     npm run test:francais (terminal 2)
//
// CE QUE CETTE SUITE PROTEGE. L'agenda affichait « Journee bloquee » — une
// chaine ASCII ecrite en dur cote serveur. Sur un produit francais dont
// l'argument est le soin typographique, c'est le detail qui fait douter d'un
// acheteur de tout le reste : il ne se dit pas « il manque un accent », il se
// dit « qu'est-ce qui est bacle ailleurs ? ».
//
// ⚠️ ELLE NE LIT PAS LES SOURCES, ELLE LIT LES PAGES SERVIES. La difference est
//    tout l'interet :
//
//      - les COMMENTAIRES et les NOMS DE VARIABLES sont volontairement en ASCII
//        dans ce depot (voir CLAUDE.md). Une suite qui lirait src/ signalerait
//        deux cent soixante-quatorze faux positifs, personne ne la regarderait
//        plus, et elle finirait desactivee ;
//      - l'allegement retire les commentaires avant l'envoi. Ce qui reste dans
//        la page servie, c'est le balisage et les chaines de caracteres du
//        JavaScript : exactement ce qu'un utilisateur peut lire, et rien d'autre.
//
// Les messages que le serveur renvoie en JSON ne figurent pas dans ces pages ;
// ils sont couverts par les autres suites, qui verifient plusieurs d'entre eux
// mot pour mot.
// ---------------------------------------------------------------------------

import { creerVerificateur, BASE } from './helpers.mjs';

const { verifie, bilan } = creerVerificateur();

/**
 * Des mots qui, en francais, PORTENT un accent. On les cherche sans.
 *
 * La liste est volontairement courte et SURE : chaque entree est un mot dont la
 * forme sans accent n'existe pas en francais et n'est pas un nom technique
 * anglais. « Ferme » n'y est pas (le verbe fermer s'ecrit ainsi), « Reserve »
 * non plus (la reserve d'une boutique), « Duree » si.
 */
const SANS_ACCENT = [
  'Journee', 'journee', 'Journees', 'journees',
  'Duree', 'duree', 'Durees', 'durees',
  'Creneau', 'creneau', 'Creneaux', 'creneaux',
  'Reglage', 'reglage', 'Reglages', 'reglages',
  'Periode', 'periode', 'Periodes', 'periodes',
  'Telephone', 'telephone', 'Numero', 'numero',
  'Categorie', 'categorie', 'Categories', 'categories',
  'Prefere', 'prefere', 'Preferee', 'preferee',
  'Bloquee', 'bloquee', 'Annulee', 'annulee', 'Fermee', 'fermee',
  'Reservee', 'reservee', 'Creee', 'creee',
  'Deja', 'deja', 'Apres', 'apres', 'Derniere', 'derniere', 'Premiere', 'premiere',
  'Reference', 'reference',
];

/**
 * Ce qu'un utilisateur peut lire dans un document servi, ligne a ligne.
 *
 * Deux gisements, et un seul est evident : le texte du balisage, bien sur, mais
 * aussi les chaines de caracteres du JavaScript — c'est la que vivent les
 * libelles de l'agenda, des fiches et des confirmations, qui n'existent nulle
 * part dans le HTML.
 *
 * QUATRE FILTRES, ET ILS COMPTENT AUTANT QUE LA LISTE DE MOTS. Sans eux, la
 * suite signale `data-liste="categories"`, `class="creneau"` et
 * `const { bloc, periode } = ...` — trois noms de code, aucun n'est lu par
 * personne, et une suite qui crie a tort ne sert plus a rien.
 *
 *   1. les interpolations `${...}` sont retirees : ce qu'elles contiennent est
 *      du code, et le nom d'une variable n'a jamais eu d'accent ici ;
 *   2. le balisage est retire de chaque chaine : il ne reste que le texte
 *      qu'elle affiche — c'est ce qui garde `« Période bloquée »` sous
 *      surveillance tout en ecartant l'attribut qui l'entoure ;
 *   3. ce qui ressemble a du code est ecarte : une phrase francaise ne contient
 *      ni `=`, ni `;`, ni accolade, ni tiret bas ;
 *   4. LES SELECTEURS CSS SONT ECARTES. Le troisieme filtre les laissait
 *      passer des qu'ils portaient un espace : `'#rdvHeures .creneau'`, ecrit
 *      dans un `$$()`, etait releve comme un « creneau » sans accent. C'est un
 *      nom de classe, personne ne le lit, et le renommer pour faire taire la
 *      suite aurait casse le style. La regle est celle qui distingue un
 *      selecteur d'une phrase sans exception : AUCUNE phrase francaise ne
 *      commence par `#`, `.` ou `[`.
 */
function lignesLisibles(html) {
  const brut = [];

  // Le JavaScript et le style, mis de cote pour etre traites a part.
  const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const sansCode = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/g, ' ')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/g, ' ');

  // 1. Le texte du balisage, hors balises.
  brut.push(sansCode.replace(/<[^>]*>/g, '\n'));

  // 2. Les attributs que quelqu'un LIT ou ENTEND.
  for (const m of sansCode.matchAll(/(?:aria-label|title|placeholder|alt|content)="([^"]*)"/g)) {
    brut.push(m[1]);
  }

  // 3. Les chaines de caracteres du JavaScript.
  for (const script of scripts) {
    for (const m of script.matchAll(/'([^'\\\n]*)'|"([^"\\\n]*)"|`([^`\\]*)`/g)) {
      brut.push(m[1] ?? m[2] ?? m[3] ?? '');
    }
  }

  return brut
    .map((t) => t.replace(/\$\{[^}]*\}/g, ' ').replace(/<[^>]*>/g, ' '))
    .flatMap((t) => t.split('\n'))
    .map((t) => t.trim())
    .filter((t) => t.includes(' '))
    .filter((t) => !/[=;{}_$]/.test(t))
    .filter((t) => !/^[#.[]/.test(t));
}

/** Les mots sans accent d'une ligne, avec la phrase ou ils se trouvent. */
function fautes(ligne) {
  return SANS_ACCENT
    .filter((mot) => new RegExp(`(?<![\\w-])${mot}(?![\\w-])`).test(ligne))
    .map((mot) => ({ mot, ligne: ligne.slice(0, 100) }));
}

const DOCUMENTS = [
  ['la vitrine', '/'],
  ['l\'espace commercant', '/espace-salon'],
  ['la page d\'annulation', '/annuler'],
];

console.log('1. Aucune chaine visible sans accents');

for (const [nom, chemin] of DOCUMENTS) {
  const html = await (await fetch(BASE + chemin)).text();

  const releve = lignesLisibles(html).flatMap(fautes);

  verifie(`${nom} n'affiche aucun mot francais sans accents`,
    releve.length === 0, releve.slice(0, 12));
}

// --- 2. Le libelle qui a motive ce lot --------------------------------------
//
// « Journee bloquee » etait ecrit en dur dans src/routes/bookings.js. Le
// verifier ici en plus de tests/blocages.mjs a un interet propre : celui-la
// teste la valeur enregistree, celui-ci teste ce que le navigateur recoit.
console.log('\n2. Le libelle par defaut d\'un blocage');
{
  const espace = await (await fetch(`${BASE}/espace-salon`)).text();

  verifie('« Journee bloquee » ne figure nulle part dans l\'espace',
    !espace.includes('Journee bloquee'), 'chaine trouvee dans la page servie');
}

process.exitCode = bilan();
