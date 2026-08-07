// ---------------------------------------------------------------------------
// ALLEGEMENT DU CSS ET DU JAVASCRIPT, AU MOMENT DE SERVIR
//
// Le site est un seul fichier, abondamment commente : c'est ce qui le rend
// relisable un an plus tard, et cela ne doit pas changer. Mais le visiteur, lui,
// n'a que faire des commentaires et de l'indentation — il les telecharge, puis
// le navigateur les analyse pour rien.
//
// D'ou ce fichier : la SOURCE reste telle quelle, et c'est la COPIE ENVOYEE qui
// est allegee. Pas d'etape de construction, pas d'outil a installer, rien a
// penser avant de deployer — exactement comme l'en-tete, deja reconstruit a
// chaque envoi (src/lib/page.js).
//
// ---------------------------------------------------------------------------
// CE QUI EST FAIT, ET SURTOUT CE QUI NE L'EST PAS
//
// On ne renomme aucune variable, on ne reecrit aucune expression, on ne
// supprime aucun saut de ligne dans le JavaScript. Uniquement :
//   - les commentaires ;
//   - l'indentation et les lignes vides.
//
// Les sauts de ligne sont GARDES a dessein. JavaScript rajoute des
// point-virgules la ou il croit en manquer ("insertion automatique de
// point-virgule") ; recoller deux lignes peut donc changer le sens du programme
// sans que rien ne le signale. Les garder rend cette classe d'erreur
// impossible. On y perd quelques centaines d'octets — que la compression
// reprend presque entierement, ces sauts de ligne se compressant tres bien.
//
// Le gain reel est modeste (la reponse est deja compressee, voir
// src/middleware/compression.js) : quelques kilo-octets, et surtout un peu moins
// de travail d'analyse pour le telephone qui affiche la page.
//
// ---------------------------------------------------------------------------
// POURQUOI UN PARCOURS CARACTERE PAR CARACTERE
//
// La facon evidente — chercher `//` et couper la fin de la ligne — casse le
// site au premier `"https://..."` venu : les deux barres obliques d'une adresse
// ne sont pas un commentaire. Meme piege avec `/*` dans un texte, ou avec les
// expressions regulieres, qui commencent elles aussi par une barre oblique.
//
// On lit donc le fichier caractere par caractere en sachant a tout instant ou
// l'on se trouve : dans du code, dans un texte entre guillemets, dans un
// gabarit entre accents graves, dans une expression reguliere, ou dans un
// commentaire. Un commentaire n'est reconnu que dans le premier de ces etats.
// ---------------------------------------------------------------------------

/**
 * Un `/` ouvre-t-il une expression reguliere, ou est-ce une division ?
 *
 * La question n'a pas de reponse parfaite sans analyser toute la grammaire du
 * langage, mais la regle habituelle suffit largement ici : une expression
 * reguliere ne peut apparaitre que la ou une VALEUR est attendue. Apres un nom,
 * un nombre, une parenthese fermante ou un crochet fermant, on vient de lire une
 * valeur — le `/` est donc une division. Partout ailleurs (apres `(`, `,`, `=`,
 * `return`...), c'est une expression reguliere.
 *
 * Le fichier n'en contient que deux, toutes deux ecrites juste apres `replace(`,
 * donc apres une parenthese ouvrante : le cas est tranche sans ambiguite.
 */
function attendUneValeur(codeDejaEcrit) {
  // On remonte au dernier caractere qui compte, en sautant les espaces.
  let i = codeDejaEcrit.length - 1;
  while (i >= 0 && /\s/.test(codeDejaEcrit[i])) i--;
  if (i < 0) return true;

  const c = codeDejaEcrit[i];
  if (/[A-Za-z0-9_$)\]]/.test(c)) {
    // Un nom peut etre un mot-cle : `return /x/` est bien une expression
    // reguliere, alors que `total /x/` serait une division.
    const mot = (codeDejaEcrit.slice(0, i + 1).match(/[A-Za-z_$][A-Za-z0-9_$]*$/) || [''])[0];
    return ['return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void', 'instanceof']
      .includes(mot);
  }
  return true;
}

/**
 * Retire les commentaires d'un JavaScript, sans jamais toucher a ce qui se
 * trouve dans un texte, un gabarit ou une expression reguliere.
 */
function retirerCommentairesJs(source) {
  let sortie = '';
  let i = 0;

  while (i < source.length) {
    const c = source[i];
    const suivant = source[i + 1];

    // --- Commentaire de fin de ligne : jusqu'au saut de ligne, exclu.
    if (c === '/' && suivant === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }

    // --- Commentaire en bloc : remplace par une espace, et non par rien.
    // `a/**/b` doit rester deux mots ; les coller donnerait `ab`.
    if (c === '/' && suivant === '*') {
      const fin = source.indexOf('*/', i + 2);
      if (fin === -1) break; // commentaire jamais referme : on s'arrete la
      // Les sauts de ligne du commentaire sont conserves, pour que les numeros
      // de ligne d'une erreur en console restent ceux de la source.
      const sautsDeLigne = source.slice(i, fin).split('\n').length - 1;
      sortie += sautsDeLigne > 0 ? '\n'.repeat(sautsDeLigne) : ' ';
      i = fin + 2;
      continue;
    }

    // --- Texte entre guillemets (simples ou doubles) et gabarit.
    // On recopie tel quel jusqu'a la fermeture, en respectant les echappements.
    if (c === '"' || c === "'" || c === '`') {
      const ouvrant = c;
      sortie += c;
      i++;
      while (i < source.length) {
        if (source[i] === '\\') { sortie += source.slice(i, i + 2); i += 2; continue; }
        sortie += source[i];
        if (source[i] === ouvrant) { i++; break; }
        i++;
      }
      continue;
    }

    // --- Expression reguliere.
    if (c === '/' && attendUneValeur(sortie)) {
      sortie += c;
      i++;
      let dansUneClasse = false; // entre [ et ], un / n'est pas la fin
      while (i < source.length) {
        if (source[i] === '\\') { sortie += source.slice(i, i + 2); i += 2; continue; }
        if (source[i] === '[') dansUneClasse = true;
        else if (source[i] === ']') dansUneClasse = false;
        else if (source[i] === '/' && !dansUneClasse) { sortie += source[i]; i++; break; }
        else if (source[i] === '\n') break; // pas de saut de ligne dans une regex
        sortie += source[i];
        i++;
      }
      continue;
    }

    sortie += c;
    i++;
  }

  return sortie;
}

/**
 * Le JavaScript envoye au navigateur : commentaires retires, indentation et
 * lignes vides supprimees. Les sauts de ligne restants sont conserves.
 */
export function minifierJs(source) {
  return retirerCommentairesJs(source)
    .split('\n')
    .map((ligne) => ligne.trim())
    .filter((ligne) => ligne.length > 0)
    .join('\n');
}

/**
 * Le CSS envoye au navigateur.
 *
 * Plus simple que le JavaScript : pas d'expressions regulieres, pas
 * d'insertion automatique de point-virgule, donc on peut vraiment tout mettre
 * sur une ligne. Les textes (`content:"..."`, `url(...)`) restent intouches,
 * pour la meme raison que plus haut.
 */
export function minifierCss(source) {
  let sortie = '';
  let i = 0;

  while (i < source.length) {
    const c = source[i];

    if (c === '/' && source[i + 1] === '*') {
      const fin = source.indexOf('*/', i + 2);
      if (fin === -1) break;
      i = fin + 2;
      continue;
    }

    if (c === '"' || c === "'") {
      const ouvrant = c;
      sortie += c;
      i++;
      while (i < source.length) {
        if (source[i] === '\\') { sortie += source.slice(i, i + 2); i += 2; continue; }
        sortie += source[i];
        if (source[i] === ouvrant) { i++; break; }
        i++;
      }
      continue;
    }

    sortie += c;
    i++;
  }

  return sortie
    // Toute suite d'espaces devient une seule espace.
    .replace(/\s+/g, ' ')
    // Puis on retire celles qui n'apportent rien, autour de la ponctuation.
    // `>`, `+` et `~` sont exclus a dessein : ce sont des combinateurs de
    // selecteurs, et `a >b` n'est pas equivalent a `a>b` dans tous les moteurs
    // anciens. On ne prend pas ce risque pour deux octets.
    .replace(/\s*([{}:;,])\s*/g, '$1')
    // Un point-virgule juste avant une accolade fermante ne sert a rien.
    .replace(/;}/g, '}')
    .trim();
}

/**
 * Allege les blocs <style> et <script> d'une page HTML.
 *
 * Le HTML lui-meme n'est pas touche : entre deux balises, une espace peut etre
 * signifiante (elle separe deux mots a l'ecran), et la compression s'en charge
 * bien mieux que nous sans aucun risque.
 *
 * Les `<script>` porteurs d'un attribut — `type="application/ld+json"`, les
 * donnees structurees — sont laisses tels quels : ce n'est pas du JavaScript.
 */
export function minifierPage(html) {
  return html
    .replace(/<style>([\s\S]*?)<\/style>/g, (_, css) => `<style>${minifierCss(css)}</style>`)
    .replace(/<script>([\s\S]*?)<\/script>/g, (_, js) => `<script>\n${minifierJs(js)}\n</script>`);
}
