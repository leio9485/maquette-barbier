// ---------------------------------------------------------------------------
// LE PARAGRAPHE « HEBERGEMENT » DES MENTIONS LEGALES
//
// >>> IL ETAIT ECRIT EN DUR, ET IL ETAIT FAUX. <<<
//
// La page affirmait : « Le site est hébergé en Allemagne (Francfort), au sein
// de l'Union européenne. Aucune donnée n'est transférée hors de l'Union. » Les
// en-tetes de l'instance en ligne disent autre chose — `server: cloudflare`,
// un `cf-ray` passe par Paris, un `rndr-id` : un relais mondial devant une
// origine Render. Le texte decrivait l'hebergeur VISE par CLAUDE.md, pas celui
// qui sert reellement la page.
//
// Sur la demonstration, c'est une incoherence. Chez un client, c'est une
// declaration RGPD inexacte — sur l'hebergement ET sur les transferts.
//
// D'OU LA REGLE DE CE FICHIER, ET ELLE TIENT EN UNE PHRASE : on n'ecrit que ce
// qui a ete configure. Rien de configure, rien d'affirme.
//
//   - hebergeur nomme        -> « Le site est hébergé par X (pays). »
//   - rien de renseigne      -> une mention neutre et verifiable, qui renvoie
//                               a la configuration du deploiement ;
//   - transferts hors UE     -> UNE SEULE FACON DE L'ECRIRE : poser
//                               HEBERGEUR_UE=true. C'est une affirmation
//                               juridique ; elle ne se deduit pas d'un nom de
//                               region, et surtout pas d'un defaut.
//
// Les valeurs vivent dans les variables d'environnement de l'instance
// (render.yaml pour la demonstration, .env.example pour le modele) et non ici :
// le code ne sait pas ou il tourne, et un defaut ecrit dans le code est
// exactement ce qui a produit la phrase fausse qu'on remplace.
// ---------------------------------------------------------------------------

/**
 * Echappement local, et non celui de src/lib/page.js.
 *
 * Six lignes recopiees plutot qu'un import : ce fichier doit pouvoir etre lu et
 * teste seul, et page.js garde les siennes privees. Ces valeurs viennent de
 * l'hebergeur, pas d'Internet — l'echappement n'est donc pas ce qui protege du
 * pire, seulement ce qui evite qu'une esperluette casse la page.
 */
function echapper(valeur) {
  return String(valeur ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** Une adresse qu'on accepte de poser dans un `href`. Rien d'autre que http(s). */
function adresse(brut) {
  const valeur = String(brut ?? '').trim();
  return /^https?:\/\/[^\s"'<>]+$/.test(valeur) ? valeur : '';
}

/**
 * Le paragraphe, en HTML, pret a etre pose dans la page.
 *
 * `source` est un objet simple — { nom, pays, url, ue } — et non les variables
 * d'environnement directement : c'est ce qui rend cette fonction testable sans
 * relancer un serveur avec un autre environnement.
 *
 * ⚠️ LA PHRASE SUR LES TRANSFERTS N'EST EMISE QUE SI `ue` VAUT VRAI, et jamais
 *    parce que le pays annonce se trouve en Europe. Un hebergeur europeen peut
 *    parfaitement faire transiter les requetes par un relais mondial — c'est
 *    precisement le cas de l'instance de demonstration.
 */
export function paragrapheHebergement(source = {}) {
  const nom = String(source.nom ?? '').trim();
  const pays = String(source.pays ?? '').trim();
  const url = adresse(source.url);
  const ue = source.ue === true;

  if (!nom) {
    // MENTION NEUTRE ET VERIFIABLE. Elle n'affirme rien qu'on ne puisse
    // montrer, et elle dit ou regarder — ce qu'une phrase fausse ne fait pas.
    return '<p data-champ="hebergement">Hébergement : voir la configuration du déploiement.</p>';
  }

  const nomAffiche = url
    ? `<a href="${echapper(url)}" rel="noopener">${echapper(nom)}</a>`
    : echapper(nom);

  const phrases = [`Le site est hébergé par ${nomAffiche}${pays ? ` (${echapper(pays)})` : ''}.`];

  if (ue) {
    phrases.push("Les serveurs et les sauvegardes restent au sein de l'Union "
      + "européenne : aucune donnée n'est transférée hors de l'Union.");
  }

  return `<p data-champ="hebergement">${phrases.join(' ')}</p>`;
}
