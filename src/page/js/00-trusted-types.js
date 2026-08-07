// ---------------------------------------------------------------------------
// LA POLITIQUE D'ECRITURE DU HTML (« Trusted Types »)
//
// ⚠️ CE BLOC DOIT RESTER LA TOUTE PREMIERE INSTRUCTION DU SITE. Il declare la
//    politique nommee `default`, et le navigateur ne l'accepte qu'une fois.
//
// La politique de contenu envoyee par le serveur contient
// `require-trusted-types-for 'script'` : sans la declaration ci-dessous, TOUTE
// ecriture de HTML par le code (innerHTML, insertAdjacentHTML) serait refusee,
// et la page resterait vide.
//
// CE QU'ELLE PROTEGE REELLEMENT
//
// Elle ne nettoie pas le HTML, et ce n'est pas son role ici : tout ce que le
// site ecrit est fabrique par lui, et chaque valeur venue de la base passe par
// `esc()` avant d'y entrer (voir js/02-utilitaires.js).
//
// Ce qu'elle apporte, c'est ce qu'elle NE FOURNIT PAS : aucune fonction
// `createScriptURL` ni `createScript`. Sous cette politique, `eval()` et
// `new Function()` deviennent inutilisables — y compris pour du code qui
// parviendrait a s'introduire dans la page par un autre chemin.
//
// C'est aussi un garde-fou de relecture : le jour ou quelqu'un ecrira ici une
// fabrique de script, il faudra qu'il l'ajoute explicitement, et cela se verra
// en revue.
// ---------------------------------------------------------------------------

if (window.trustedTypes && window.trustedTypes.createPolicy) {
  try {
    window.trustedTypes.createPolicy('default', {
      createHTML: (html) => html,
      // Volontairement absents : createScriptURL, createScript.
    });
  } catch {
    // Deja declaree (rechargement partiel, extension du navigateur) : il n'y a
    // rien a faire, et surtout rien qui justifie d'arreter le site.
  }
}
