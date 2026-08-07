// ---------------------------------------------------------------------------
// L'ASSEMBLAGE DE LA PAGE
//
// Le site reste UN SEUL FICHIER pour le navigateur : une page, un style, un
// script, aucune requete supplementaire. Mais il ne s'ecrit plus dans un seul
// fichier — six mille lignes dans lesquelles retrouver la regle CSS d'un bouton
// ou le rendu d'une etape de reservation coutait plus cher que la modification
// elle-meme.
//
// Les morceaux vivent donc dans src/page/ (voir src/page/LISEZ-MOI.md), et ce
// fichier les recolle a chaque envoi de la page. Le resultat est rigoureusement
// celui d'avant le decoupage — c'est le contrat, et un test le verifie.
//
// POURQUOI RECOLLER PLUTOT QUE SERVIR DES FICHIERS SEPARES
//
// Le JavaScript du site est une seule fonction anonyme (« IIFE ») dont toutes
// les sections partagent la meme portee : `CONFIG`, `esc()`, `store`, `booking`
// s'appellent entre eux sans rien exporter. Servis en <script src> separes, ils
// ne se verraient plus. Il faudrait passer aux modules ES, donc a des imports,
// donc a une etape de construction — exactement ce que ce projet evite.
//
// Recoller le texte avant de l'envoyer preserve tout : la portee partagee, le
// nonce de la politique de contenu (une seule balise <script> a marquer),
// l'allegement de src/lib/minify.js, et les zones balisees que remplacent
// src/lib/page.js et src/lib/catalogue.js.
//
// AUCUNE ETAPE DE CONSTRUCTION : rien a lancer, rien a installer. On modifie un
// morceau, on recharge la page.
// ---------------------------------------------------------------------------

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { ROOT_DIR } from '../config.js';

/** Le dossier des morceaux. Rien n'est jamais lu en dehors. */
const DOSSIER = path.join(ROOT_DIR, 'src', 'page');

/** Le squelette : l'ordre des morceaux, et rien d'autre. */
const SQUELETTE = path.join(DOSSIER, 'index.html');

/**
 * Un appel a un morceau.
 *
 * Trois ecritures pour un seul mecanisme, afin que le marqueur reste valide
 * dans le langage qui l'entoure et qu'un editeur ne signale pas d'erreur :
 *
 *   <!--@inclure parties/galerie.html-->   dans le HTML
 *   /*@inclure styles/04-accueil.css* /    dans le <style>
 *   /*@inclure js/06-reservation.js* /     dans le <script>
 *
 * Le nom du fichier ne peut contenir que des lettres, des chiffres, un point,
 * un tiret ou une barre oblique : un `..` ne peut donc pas remonter hors de
 * src/page/. Ces chemins viennent de nos propres fichiers, mais la regle est
 * ecrite ici plutot que supposee ailleurs.
 */
const APPEL = /(?:<!--|\/\*)@inclure[ \t]+([A-Za-z0-9._/-]+)(?:-->|\*\/)/g;

/**
 * Un commentaire de maintenance, retire de la page envoyee.
 *
 * Les morceaux HTML meritent une explication en tete — ce que contient le
 * fichier, ce qu'il ne faut pas y casser. Un commentaire HTML ordinaire
 * partirait chez le visiteur a chaque visite ; celui-ci s'arrete ici.
 *
 * Les commentaires HTML ORDINAIRES sont conserves, eux : plusieurs expliquent
 * la page a qui en lit la source, et deux marquent les zones que le serveur
 * remplace. On ne touche qu'a la forme `<!--#` ... `#-->`.
 *
 * LE TERMINATEUR EST `#-->` ET NON `-->`, ET C'EST NECESSAIRE : ces
 * commentaires citent les marqueurs de la page (« ne pas retirer
 * <!--@prestations--> ») et les appels d'inclusion eux-memes. Avec un `-->`
 * ordinaire, la citation refermait le commentaire en plein milieu et le reste
 * de l'explication partait chez le visiteur.
 */
const COMMENTAIRE_DE_MAINTENANCE = /^[ \t]*<!--#[\s\S]*?#-->[ \t]*\r?\n?/gm;

/** Profondeur maximale : un morceau peut en appeler un autre, mais pas a l'infini. */
const PROFONDEUR_MAX = 5;

/**
 * Lit un morceau et retire son saut de ligne final.
 *
 * Chaque fichier se termine par un saut de ligne, comme tout fichier texte
 * normalement constitue. Mais la ligne du marqueur porte deja le sien : sans ce
 * retrait, chaque inclusion ajouterait une ligne vide a la page.
 */
async function lireMorceau(chemin) {
  const contenu = await readFile(chemin, 'utf8');
  return contenu.replace(/\r?\n$/, '');
}

/**
 * Remplace les appels d'un texte par le contenu des morceaux.
 *
 * `vus` recense les fichiers ouverts : c'est ce qui permet ensuite de savoir
 * quand l'un d'eux a change, sans avoir a maintenir une liste a la main.
 */
async function resoudre(texte, vus, profondeur = 0) {
  if (profondeur > PROFONDEUR_MAX) {
    throw new Error('Inclusions trop imbriquees dans src/page/ (boucle ?)');
  }

  // LES COMMENTAIRES DE MAINTENANCE SONT RETIRES D'ABORD, ET C'EST L'ORDRE QUI
  // COMPTE : ils CITENT des appels d'inclusion pour en expliquer la forme. Les
  // resoudre ensuite reviendrait a recopier la galerie entiere au milieu d'une
  // phrase d'explication. Constate au premier essai, et rattrape par le test
  // qui compte les marqueurs de la page servie.
  const propre = texte.replace(COMMENTAIRE_DE_MAINTENANCE, '');

  if (propre.includes('<!--#')) {
    throw new Error('Commentaire de maintenance non referme dans src/page/ (il finit par `#-->`)');
  }

  const appels = [...propre.matchAll(APPEL)];
  if (!appels.length) return propre;

  const morceaux = await Promise.all(appels.map(async (appel) => {
    const nom = appel[1];
    if (nom.includes('..')) throw new Error(`Chemin refuse dans src/page/ : ${nom}`);

    const chemin = path.join(DOSSIER, nom);
    vus.add(chemin);

    const contenu = await lireMorceau(chemin);
    return resoudre(contenu, vus, profondeur + 1);
  }));

  let i = 0;
  return propre.replace(APPEL, () => morceaux[i++]);
}

// --- Le fichier assemble, garde en memoire ---------------------------------

let cache = { contenu: null, signature: '', fichiers: [] };

/**
 * La signature des morceaux : leurs dates de modification, mises bout a bout.
 *
 * Elle sert a savoir s'il faut reassembler. En PRODUCTION on ne la calcule pas :
 * les fichiers ne changent jamais sans un redemarrage, et interroger le disque
 * une trentaine de fois par visite n'apprendrait rien. En developpement, au
 * contraire, c'est ce qui evite de redemarrer le serveur a chaque retouche.
 */
async function signature(fichiers) {
  if (process.env.NODE_ENV === 'production') return cache.signature || 'production';

  const dates = await Promise.all(fichiers.map(async (f) => {
    try {
      return (await stat(f)).mtimeMs;
    } catch {
      return 0; // fichier disparu : la signature change, on reassemble et l'erreur se dira
    }
  }));
  return dates.join(',');
}

/**
 * La page complete, morceaux recolles et allegee.
 *
 * `minifier` est passe par l'appelant (src/lib/page.js) plutot qu'importe ici :
 * l'assemblage et l'allegement sont deux choses distinctes, et c'est ce qui
 * permet a un test de verifier l'assemblage seul.
 */
export async function assemblerPage(minifier = (x) => x) {
  const fichiers = cache.fichiers.length ? cache.fichiers : [SQUELETTE];
  const empreinte = await signature(fichiers);

  if (cache.contenu !== null && empreinte === cache.signature) return cache.contenu;

  const vus = new Set([SQUELETTE]);
  const squelette = await readFile(SQUELETTE, 'utf8');
  const page = await resoudre(squelette, vus);

  cache = {
    contenu: minifier(page),
    fichiers: [...vus],
    signature: '',
  };
  // La signature est calculee APRES coup : on ne connait la liste complete des
  // morceaux qu'une fois l'assemblage fait.
  cache.signature = await signature(cache.fichiers);

  return cache.contenu;
}

/**
 * La page assemblee, sans allegement ni cache.
 *
 * Reservee aux tests et au diagnostic : c'est ce qui permet de comparer le
 * resultat du recollage a ce qu'on attend, sans que l'allegement ne brouille la
 * comparaison.
 */
export async function assemblerBrut() {
  const squelette = await readFile(SQUELETTE, 'utf8');
  return resoudre(squelette, new Set([SQUELETTE]));
}
