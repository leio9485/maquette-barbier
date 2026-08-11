// ---------------------------------------------------------------------------
// TESTS DE PORTEE — chaque document appelle-t-il seulement ce qu'il embarque ?
//
//     npm run test:portees      (aucun serveur necessaire)
//
// >>> POURQUOI CETTE SUITE EXISTE. <<<
//
// Le site n'avait qu'un document : tout le JavaScript partageait une seule
// portee, et n'importe quelle fonction pouvait en appeler n'importe quelle
// autre. Depuis qu'il y en a trois (lot 4), ce n'est plus vrai — et RIEN NE LE
// SIGNALE. Une fonction appelee mais absente du document leve une
// `ReferenceError` a l'execution, pas au chargement : la page s'affiche, tout
// semble normal, et c'est le clic sur « Enregistrer » qui ne fait rien.
//
// Trois de ces bogues ont ete introduits pendant le decoupage, et AUCUN n'a ete
// trouve en naviguant :
//
//   `peindreVitrine()`  appele apres l'enregistrement des reglages — les
//                       reglages partaient bien, le message de confirmation
//                       etait avale ;
//   `peindrePhotos()`   apres le depot d'une photo, meme symptome ;
//   `initiales()`       au milieu du formulaire des reglages — la moitie du
//                       volet ne se dessinait plus, et le message d'erreur
//                       n'apparaissait que dans un coin de l'ecran.
//
// COMMENT ELLE PROCEDE. Elle recolle le JavaScript de chaque document, releve
// tout ce qui y est declare, puis cherche les appels a ce qui ne l'est pas.
// C'est une analyse grossiere — pas un interpreteur — et elle ne pretend pas
// tout voir. Elle voit exactement la classe de bogue ci-dessus, qui est celle
// qui s'est produite trois fois.
// ---------------------------------------------------------------------------

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { creerVerificateur } from './helpers.mjs';
import { ROOT_DIR } from '../src/config.js';

const { verifie, bilan } = creerVerificateur();

const DOSSIER = path.join(ROOT_DIR, 'src', 'page');

/** Les fichiers JavaScript d'un squelette, dans l'ordre ou il les recolle. */
async function morceauxJs(squelette) {
  const html = await readFile(path.join(DOSSIER, squelette), 'utf8');
  return [...html.matchAll(/\/\*@inclure[ \t]+(js\/[A-Za-z0-9._/-]+)\*\//g)].map((m) => m[1]);
}

/**
 * Tout ce qu'un morceau declare : fonctions, const, let, var, ET PARAMETRES.
 *
 * ⚠️ LES PARAMETRES COMPTENT AUTANT QUE LE RESTE. Sans eux, le
 *    `new Promise((resoudre, rejeter) => …)` de la reduction d'image faisait
 *    remonter « resoudre » et « rejeter » comme des fonctions manquantes. Deux
 *    faux positifs suffisent a rendre un test inutilisable : on finit par
 *    l'ignorer, puis par le desactiver.
 */
function declarations(code) {
  const noms = new Set();

  for (const m of code.matchAll(/^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) noms.add(m[1]);
  for (const m of code.matchAll(/^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) noms.add(m[1]);

  // Les listes de parametres : celles d'une fonction fleche, d'une fonction
  // nommee ou anonyme, et d'un `catch`. Le contenu est decoupe grossierement —
  // on ne cherche que des identifiants, la destructuration et les valeurs par
  // defaut se laissent traverser sans dommage.
  const listes = [
    ...code.matchAll(/\(([^()]*)\)\s*=>/g),
    ...code.matchAll(/(?:async\s+)?function\s*[A-Za-z_$\w]*\s*\(([^()]*)\)/g),
    ...code.matchAll(/catch\s*\(([^()]*)\)/g),
  ];

  for (const m of listes) {
    for (const mot of m[1].matchAll(/[A-Za-z_$][\w$]*/g)) noms.add(mot[0]);
  }

  // Un parametre seul sans parentheses : `valeur => …`.
  for (const m of code.matchAll(/(?<![\w$)])([A-Za-z_$][\w$]*)\s*=>/g)) noms.add(m[1]);

  return noms;
}

/**
 * Le code debarrasse de ses commentaires et du TEXTE de ses chaines.
 *
 * >>> LES `${…}` DES GABARITS SONT CONSERVES, ET C'EST TOUT L'ENJEU. <<<
 *
 * Premiere version de ce test : elle effacait les gabarits en entier, d'un
 * `replace(/`…`/g, '')`. Elle passait au vert sur le bogue meme qu'elle etait
 * ecrite pour attraper — parce que l'appel fautif etait
 * `${initiales(p.name)}`, et que presque tout le code de ce projet construit
 * son HTML dans des gabarits. Un test qui ne peut pas echouer ne protege rien.
 *
 * Les conserver entierement ne marche pas non plus : « Coupe (25 min) » dans du
 * texte ressemble a un appel de la fonction « Coupe ». On parcourt donc le
 * fichier caractere par caractere — une expression reguliere ne sait pas
 * suivre l'imbrication d'un `${ … `…` … }`.
 */
function sansTexte(code) {
  let sortie = '';
  let i = 0;

  // Les gabarits ouverts, avec la profondeur d'accolades atteinte dans leur
  // `${}` courant. Une pile, parce qu'un gabarit peut en contenir un autre.
  const gabarits = [];
  let accolades = 0;

  const dansTexteDeGabarit = () =>
    gabarits.length > 0 && gabarits[gabarits.length - 1] === null;

  while (i < code.length) {
    const c = code[i];
    const suivant = code[i + 1];

    // Commentaires
    if (!gabarits.length && c === '/' && suivant === '*') {
      const fin = code.indexOf('*/', i + 2);
      i = fin === -1 ? code.length : fin + 2;
      sortie += ' ';
      continue;
    }
    if (!gabarits.length && c === '/' && suivant === '/') {
      const fin = code.indexOf('\n', i);
      i = fin === -1 ? code.length : fin;
      sortie += ' ';
      continue;
    }

    // Chaines ordinaires : leur contenu ne nous interesse jamais.
    if (!dansTexteDeGabarit() && (c === "'" || c === '"')) {
      i += 1;
      while (i < code.length && code[i] !== c) i += code[i] === '\\' ? 2 : 1;
      i += 1;
      sortie += '""';
      continue;
    }

    // Ouverture d'un gabarit.
    if (c === '`') {
      if (dansTexteDeGabarit()) gabarits.pop();
      else gabarits.push(null);
      i += 1;
      sortie += ' ';
      continue;
    }

    // Entree dans un `${` : ce qui suit est du CODE, on le garde.
    if (dansTexteDeGabarit() && c === '$' && suivant === '{') {
      gabarits[gabarits.length - 1] = accolades;
      accolades += 1;
      i += 2;
      sortie += ' ';
      continue;
    }

    // Sortie d'un `${`.
    if (gabarits.length && gabarits[gabarits.length - 1] !== null) {
      if (c === '{') accolades += 1;
      if (c === '}') {
        accolades -= 1;
        if (accolades === gabarits[gabarits.length - 1]) {
          gabarits[gabarits.length - 1] = null;
          i += 1;
          sortie += ' ';
          continue;
        }
      }
    }

    // Le texte d'un gabarit est remplace par un espace ; le reste est garde.
    sortie += dansTexteDeGabarit() ? ' ' : c;
    i += 1;
  }

  return sortie;
}

/** Tout ce qu'un morceau appelle : `nom(` en position d'appel. */
function appels(code) {
  const trouves = new Set();

  // `nom(` non precede d'un point (sinon c'est une methode d'objet).
  //
  // ⚠️ UNE ASSERTION ARRIERE, ET SURTOUT PAS UN GROUPE CAPTURANT. Le motif
  //    s'ecrivait `(^|[^.\w$])(nom)\(` : il CONSOMMAIT le caractere qui
  //    precede, si bien qu'un appel imbrique — `esc(initiales(p.name))` —
  //    passait inapercu, la parenthese ouvrante ayant deja servi au premier
  //    appel. C'est exactement la forme du bogue que ce test existe pour
  //    attraper, et il le manquait. Verifie en le reintroduisant.
  for (const m of sansTexte(code).matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
    trouves.add(m[1]);
  }
  return trouves;
}

/**
 * Ce que le navigateur fournit, plus les mots-cles qui ressemblent a un appel.
 *
 * Liste tenue a la main : une liste exhaustive des globales du navigateur
 * n'apporterait rien de plus, et celle-ci se lit.
 */
const CONNUS = new Set([
  // mots-cles et constructions
  'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function',
  'await', 'async', 'new', 'delete', 'void', 'in', 'of', 'do', 'else', 'try',
  // globales du navigateur
  'fetch', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
  'requestAnimationFrame', 'queueMicrotask', 'structuredClone',
  'Number', 'String', 'Boolean', 'Array', 'Object', 'Math', 'JSON', 'Date',
  'Map', 'Set', 'Promise', 'Error', 'RegExp', 'Intl', 'Symbol', 'BigInt',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURIComponent',
  'decodeURIComponent', 'encodeURI', 'decodeURI',
  'URLSearchParams', 'URL', 'FormData', 'Blob', 'FileReader', 'Image',
  // `TextEncoder` sert au pliage du fichier .ics, qui se compte en OCTETS et
  // non en caracteres (js/07-mon-agenda.js).
  'TextEncoder',
  'CustomEvent', 'Event', 'MutationObserver', 'AbortController', 'AbortSignal',
  'document', 'window', 'navigator', 'localStorage', 'sessionStorage',
  'console', 'alert', 'confirm', 'prompt', 'CSS',
]);

console.log('Portée du JavaScript, document par document\n');

for (const squelette of ['index.html', 'espace.html', 'annuler.html']) {
  const morceaux = await morceauxJs(squelette);

  const codes = await Promise.all(
    morceaux.map((m) => readFile(path.join(DOSSIER, m), 'utf8')),
  );

  const declares = new Set(CONNUS);
  for (const code of codes) for (const nom of declarations(code)) declares.add(nom);

  const manquants = new Map();
  for (const [i, code] of codes.entries()) {
    for (const nom of appels(code)) {
      if (declares.has(nom)) continue;
      if (!manquants.has(nom)) manquants.set(nom, []);
      manquants.get(nom).push(morceaux[i]);
    }
  }

  console.log(`${squelette} — ${morceaux.length} morceaux, ${declares.size - CONNUS.size} déclarations`);

  verifie(`${squelette} : chaque fonction appelée est embarquée`,
    manquants.size === 0,
    [...manquants].map(([nom, ou]) => `${nom} (appelé dans ${ou.join(', ')})`));
}

// --- La réciproque : aucun document ne charge un morceau d'un autre ---------
//
// Elle ne se déduit pas de ce qui précède : embarquer js/07-tunnel.js dans
// l'espace commerçant ferait passer tous les tests ci-dessus, et rendrait
// simplement le document plus lourd de vingt-deux kilo-octets.
console.log('');
{
  const vitrine = await morceauxJs('index.html');
  const espace = await morceauxJs('espace.html');
  const annuler = await morceauxJs('annuler.html');

  const PROPRE_A_LA_VITRINE = ['js/04-contenu-statique.js', 'js/06-bandeau-etat.js',
    'js/07-tunnel.js', 'js/12-mon-rendez-vous.js', 'js/13-demarrage.js'];
  const PROPRE_A_L_ESPACE = ['js/08-reglages.js', 'js/09-agenda.js', 'js/10-chiffres.js',
    'js/11-mon-compte.js', 'js/espace/etat.js', 'js/espace/donnees.js'];

  verifie('la vitrine ne charge aucun morceau de l\'espace',
    PROPRE_A_L_ESPACE.every((m) => !vitrine.includes(m)),
    PROPRE_A_L_ESPACE.filter((m) => vitrine.includes(m)));

  verifie('l\'espace ne charge aucun morceau de la vitrine',
    PROPRE_A_LA_VITRINE.every((m) => !espace.includes(m)),
    PROPRE_A_LA_VITRINE.filter((m) => espace.includes(m)));

  verifie('la page d\'annulation ne charge ni l\'un ni l\'autre',
    [...PROPRE_A_LA_VITRINE, ...PROPRE_A_L_ESPACE].every((m) => !annuler.includes(m)),
    [...PROPRE_A_LA_VITRINE, ...PROPRE_A_L_ESPACE].filter((m) => annuler.includes(m)));
}

process.exitCode = bilan() === 0 ? 0 : 1;
