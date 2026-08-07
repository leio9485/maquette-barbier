// ---------------------------------------------------------------------------
// EN-TETES DE SECURITE
//
// Des consignes envoyees au navigateur avec chaque reponse. Elles ne changent
// rien a ce que voit le visiteur : elles lui interdisent certaines choses.
//
// Pourquoi ici plutot qu'avec une brique toute faite (helmet) : cela fait cinq
// en-tetes, chacun tient en une ligne, et les ecrire nous-memes evite d'ajouter
// une dependance a surveiller. Le projet n'en compte que quatre.
//
// Un point demande une attention particuliere : la politique de contenu (CSP).
// Le site est un fichier unique, avec son style et son JavaScript ecrits
// dedans. Interdire betement "le code en ligne" fermerait donc le site
// lui-meme. On procede autrement : a chaque envoi, le serveur tire un numero au
// hasard (un "nonce"), le pose sur ses propres balises <script> et n'autorise
// que celles qui le portent. Un script glisse par un attaquant ne peut pas
// deviner le numero du jour : il ne s'executera pas.
// ---------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';

import { IS_PRODUCTION } from '../config.js';

/**
 * La politique de contenu, construite autour du numero du jour.
 *
 * `style-src` doit accepter le style en ligne : le site pose des attributs
 * `style="..."` sur les elements qu'il engendre, et un nonce ne couvre pas ces
 * attributs-la. C'est un compromis assume — un style detourne peut deformer une
 * page, la ou un script detourne peut voler une session.
 */
function politiqueContenu(nonce) {
  const regles = [
    "default-src 'self'",
    // Rien d'autre que nos propres scripts, reconnus a leur numero.
    //
    // `'unsafe-inline'` figure ici en REPLI, et ne contredit pas le nonce :
    // depuis CSP niveau 2 (2015), un navigateur qui comprend les nonces doit
    // IGNORER `'unsafe-inline'` des qu'un nonce est present. La regle effective
    // reste donc « seulement les scripts qui portent le numero du jour ».
    //
    // Ce qu'il change : un navigateur trop ancien pour les nonces ne comprend
    // pas non plus `nonce-...`, et refuserait alors tout le JavaScript du site
    // — c'est-a-dire la reservation en ligne. Il retombe sur `'unsafe-inline'`,
    // c'est-a-dire sur le comportement qu'il aurait eu sans aucune CSP. On ne
    // perd rien la ou la protection existe, et le site fonctionne la ou elle
    // n'existe pas.
    `script-src 'self' 'nonce-${nonce}' 'unsafe-inline'`,
    // Les ecritures de HTML (innerHTML et compagnie) doivent passer par une
    // politique declaree. La page en pose une, nommee `default`, en tete de son
    // JavaScript — et n'y met VOLONTAIREMENT pas de quoi fabriquer du script :
    // `eval()` et `new Function()` deviennent donc inutilisables, y compris
    // pour du code qui parviendrait a s'introduire.
    "require-trusted-types-for 'script'",
    'trusted-types default',
    "style-src 'self' 'unsafe-inline'",
    // Les polices sont servies par le site lui-meme (public/fonts/) : plus
    // aucune adresse exterieure n'est autorisee, pour rien.
    "font-src 'self'",
    "img-src 'self' data:",
    // Le site ne parle qu'a sa propre API.
    "connect-src 'self'",
    // Empeche d'afficher le site dans un cadre sur un autre site, technique
    // classique pour faire cliquer un visiteur sur autre chose que ce qu'il voit.
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];

  // En ligne, tout doit passer par une liaison chiffree.
  if (IS_PRODUCTION) regles.push('upgrade-insecure-requests');

  return regles.join('; ');
}

export function securityHeaders(req, res, next) {
  // Un numero different a chaque reponse. La page s'en sert pour marquer ses
  // propres balises <script> (voir src/lib/page.js).
  res.locals.cspNonce = randomBytes(16).toString('base64');

  res.setHeader('Content-Security-Policy', politiqueContenu(res.locals.cspNonce));

  // Le navigateur respecte le type annonce au lieu de le deviner : un fichier
  // depose par un visiteur ne peut pas se faire passer pour du JavaScript.
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Double de `frame-ancestors`, pour les navigateurs plus anciens.
  res.setHeader('X-Frame-Options', 'DENY');

  // L'adresse complete de la page n'est pas transmise aux sites exterieurs :
  // une page d'agenda ne doit pas fuiter dans les journaux d'un tiers.
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Le site n'a besoin ni de la position, ni du micro, ni de la camera.
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  // Une page ouverte depuis la notre (ou qui nous ouvre) ne partage plus notre
  // contexte : elle ne peut plus nous manipuler par `window.opener`. Le site
  // n'ouvre rien en pop-up et n'attend de reponse d'aucune fenetre — la mesure
  // ne lui coute donc rien, et ferme une porte par laquelle une page tierce
  // pourrait rediriger l'onglet du salon vers une fausse page de connexion.
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');

  // HSTS : le navigateur refuse de revenir en clair sur ce domaine pendant un
  // an. A n'envoyer qu'en production — pose en local, il rendrait
  // http://localhost inaccessible dans ce navigateur, y compris pour d'autres
  // projets, et pour longtemps.
  if (IS_PRODUCTION) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  next();
}
