// ---------------------------------------------------------------------------
// LE BANDEAU D'ETAT
//
// Le serveur a deja ecrit l'etat dans la page envoyee (src/lib/etat.js) : le
// bandeau est donc JUSTE A LA PREMIERE IMAGE, avant que ce fichier ne
// s'execute. Ce qui suit ne fait que le maintenir a jour.
//
// LE POINT DUR EST LA DEGRADATION, et il tient en une regle : quand l'appel
// echoue, ON NE TOUCHE A RIEN. Le bandeau garde ce que le serveur y avait
// ecrit — des horaires justes, un peu anciens. Jamais de message d'erreur,
// jamais de bandeau vide, jamais de « ... ».
//
// C'est pour cela qu'il n'y a ici ni `catch` qui efface, ni etat « chargement ».
// L'absence de code est le comportement voulu.
// ---------------------------------------------------------------------------

/** Toutes les cinq minutes. */
const PERIODE_RAFRAICHISSEMENT = 5 * 60 * 1000;

/**
 * Pose l'etat recu dans le bandeau.
 *
 * Le serveur envoie des phrases toutes faites : on remplace du texte par du
 * texte, on n'assemble rien. Une seule formulation existe dans le projet, elle
 * ne peut donc pas diverger entre la page servie et le rafraichissement.
 */
function poserEtat(etat) {
  const ligne = $('#bandeauTexte');
  if (!ligne || !etat) return;

  const morceaux = [];

  morceaux.push(`<span class="bandeau-mot" data-etat="${etat.ouvert ? 'ouvert' : 'ferme'}">${esc(etat.etat)}</span>`);
  if (etat.suite) morceaux.push(`<span class="bandeau-suite">${esc(etat.suite)}</span>`);
  if (etat.prochain) morceaux.push(`<span class="bandeau-prochain">${esc(etat.prochain)}</span>`);

  ligne.innerHTML = morceaux.join('<span class="bandeau-sep" aria-hidden="true">·</span>');
}

/**
 * Redemande l'etat au serveur.
 *
 * Silencieuse par construction : ni indicateur d'attente, ni message d'echec.
 * Un bandeau qui clignote a chaque rafraichissement serait pire que pas de
 * rafraichissement du tout.
 */
async function rafraichirEtat() {
  try {
    poserEtat(await lireEtat());
  } catch {
    // On garde ce qui est affiche. Voir l'en-tete du fichier : c'est la
    // degradation propre exigee, et elle consiste a ne rien faire.
  }
}

function brancherBandeau() {
  // Pas d'appel immediat au chargement : le serveur vient d'ecrire l'etat dans
  // la page, redemander la meme chose une seconde plus tard serait une requete
  // pour rien sur le chemin critique du premier ecran.

  setInterval(rafraichirEtat, PERIODE_RAFRAICHISSEMENT);

  // Au retour sur l'onglet. C'est le cas qui compte vraiment : un telephone
  // laisse ouvert dans une poche pendant deux heures rouvre sur un bandeau
  // perime, et « prochain créneau 16h45 » a 18h30 est pire qu'une absence
  // d'information — c'est une promesse fausse.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) rafraichirEtat();
  });

  // Apres une reservation, l'etat a change pour de bon : le creneau qu'on vient
  // de prendre n'est plus le prochain disponible. On le redemande tout de suite
  // plutot que d'attendre cinq minutes et d'afficher un creneau qu'on vient
  // soi-meme d'occuper.
  document.addEventListener('reservation-prise', rafraichirEtat);
  document.addEventListener('reservation-annulee', rafraichirEtat);
}
