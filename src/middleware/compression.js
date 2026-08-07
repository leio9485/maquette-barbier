// ---------------------------------------------------------------------------
// COMPRESSION DES REPONSES
//
// Le site tient en un seul fichier, et ce fichier pese 220 ko. Jusqu'ici il
// partait tel quel : sur un telephone en 4G lente, c'est plusieurs secondes
// avant que la premiere ligne ne s'affiche. Compresse, il en fait environ 45.
//
// Ecrit a la main plutot qu'avec la brique habituelle (`compression`) : Node
// sait deja le faire (`node:zlib`), et le projet tient a ne pas ajouter de
// dependance pour ce qu'il a sous la main.
//
// On n'intercepte que `res.send`, pas les flux. C'est volontaire, et suffisant :
//   - la page et toutes les reponses JSON passent par `res.send` (`res.json`
//     l'appelle) — ce sont les seules choses volumineuses et compressibles ;
//   - les fichiers servis tels quels (polices woff2, photos jpeg) sont deja
//     compresses dans leur format. Les repasser dans gzip les alourdirait.
//
// Envelopper les flux aurait demande de reecrire `res.write` et `res.end`, avec
// tout ce que cela comporte de cas particuliers, pour ne rien gagner ici.
// ---------------------------------------------------------------------------

import { brotliCompress, gzip, constants } from 'node:zlib';
import { promisify } from 'node:util';

const brotli = promisify(brotliCompress);
const gz = promisify(gzip);

/**
 * En dessous, compresser ne rapporte rien : l'en-tete de compression et le temps
 * de calcul coutent plus cher que les quelques octets economises.
 */
const SEUIL_OCTETS = 1024;

/** Ce qui gagne a etre compresse : du texte, sous une forme ou une autre. */
const TYPES_COMPRESSIBLES = /^(?:text\/|application\/(?:json|javascript|xml)|image\/svg)/;

/**
 * Qualite brotli : 5, et non le maximum (11).
 *
 * Le maximum est concu pour des fichiers compresses une fois pour toutes, a
 * l'avance. Ici la page est fabriquee a chaque envoi : passer 300 ms a gagner
 * 3 ko ferait perdre plus de temps qu'il n'en fait gagner. A 5, on compresse en
 * quelques millisecondes pour un resultat tres proche.
 */
const OPTIONS_BROTLI = {
  params: {
    [constants.BROTLI_PARAM_QUALITY]: 5,
    [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT,
  },
};

/** Le meilleur format accepte par ce navigateur, ou rien du tout. */
function formatAccepte(req) {
  const accepte = String(req.headers['accept-encoding'] || '');
  if (accepte.includes('br')) return 'br';
  if (accepte.includes('gzip')) return 'gzip';
  return null;
}

export function compression(req, res, next) {
  const envoyer = res.send.bind(res);

  res.send = function (corps) {
    // `Vary` se pose dans tous les cas, meme quand on ne compresse pas : il
    // previent les caches intermediaires que la reponse depend de ce que le
    // navigateur accepte. Sans lui, un cache pourrait servir une reponse
    // compressee a un client qui ne sait pas la lire.
    res.vary('Accept-Encoding');

    const format = formatAccepte(req);
    const compressible = typeof corps === 'string' || Buffer.isBuffer(corps);

    // Une reponse deja encodee (ou trop courte, ou d'un type inadapte) repart
    // par le chemin normal, sans y toucher.
    if (!format || !compressible || res.getHeader('Content-Encoding')) return envoyer(corps);

    const brut = Buffer.isBuffer(corps) ? corps : Buffer.from(corps, 'utf8');
    if (brut.length < SEUIL_OCTETS) return envoyer(corps);

    // Le type n'est connu qu'ici : Express le pose au moment de l'envoi.
    const type = String(res.getHeader('Content-Type') || '');
    if (!TYPES_COMPRESSIBLES.test(type)) return envoyer(corps);

    const compresser = format === 'br' ? brotli(brut, OPTIONS_BROTLI) : gz(brut);

    compresser
      .then((reduit) => {
        // Le cas ou la compression fait grossir (donnees deja compactes) existe
        // vraiment : on garde alors l'original.
        if (reduit.length >= brut.length) return envoyer(corps);

        res.setHeader('Content-Encoding', format);
        res.setHeader('Content-Length', reduit.length);
        envoyer(reduit);
      })
      .catch((erreur) => {
        // Une panne de compression ne doit jamais couter la page elle-meme.
        console.error('Compression impossible :', erreur.message);
        envoyer(corps);
      });

    return res;
  };

  next();
}
