// ---------------------------------------------------------------------------
// LES ECHANGES AVEC LE SERVEUR, POUR LA PAGE D'ANNULATION.
//
// Le meme contrat que js/03-donnees.js sur la vitrine : `api()` leve, et ce
// qu'elle leve est deja en francais et deja lisible par un client — le serveur
// ecrit ses refus pour etre affiches tels quels.
//
// Ecrit ici plutot qu'inclus : ce document n'a besoin que de trois adresses, et
// js/03-donnees.js en declare une trentaine dont vingt-cinq exigent une session
// de commercant. Les recopier n'apporterait rien et ferait croire, a la
// lecture, que cette page peut lire un agenda.
// ---------------------------------------------------------------------------

/** Ce qu'on dit quand le serveur n'a rien dit d'utilisable. */
const PANNE = "La connexion a échoué. Réessayez dans un instant.";

async function api(chemin, corps) {
  let reponse;

  try {
    reponse = await fetch(chemin, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corps),
      credentials: 'same-origin',
    });
  } catch {
    throw new Error(PANNE);
  }

  let donnees = null;
  try {
    donnees = await reponse.json();
  } catch {
    if (reponse.ok) return null;
    throw new Error(PANNE);
  }

  if (!reponse.ok) {
    const erreur = new Error(donnees?.error || PANNE);
    erreur.code = reponse.status;
    // Le serveur joint le rendez-vous a certains refus — « deja annule »,
    // « deja passe » — pour que la page puisse le montrer plutot que de se
    // contenter d'une phrase. C'est ce qui distingue un refus utile d'un mur.
    erreur.rendezVous = donnees?.rendezVous ?? null;
    throw erreur;
  }

  return donnees;
}

/**
 * La preuve que le rendez-vous est bien le sien.
 *
 * Deux formes possibles, jamais melangees : le jeton du lien direct, ou les
 * quatre derniers chiffres du telephone. `PREUVE` est remplie une fois — par le
 * formulaire ou par l'adresse — et rejouee a chaque appel : le serveur ne garde
 * aucun etat entre deux requetes, et c'est ce qui rend un onglet laisse ouvert
 * une heure parfaitement inoffensif.
 */
const PREUVE = { reference: '', telephone: '', jeton: '' };

/** Ce qu'on envoie au serveur, sans les champs vides. */
function corpsDePreuve(extra = {}) {
  const corps = { reference: PREUVE.reference, ...extra };
  if (PREUVE.jeton) corps.jeton = PREUVE.jeton;
  else corps.telephone = PREUVE.telephone;
  return corps;
}

function retrouverRendezVous() {
  return api('/api/rendez-vous/retrouver', corpsDePreuve());
}

function annulerRendezVous() {
  return api('/api/rendez-vous/annuler', corpsDePreuve());
}
