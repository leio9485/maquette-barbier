// ---------------------------------------------------------------------------
// « AJOUTER A MON AGENDA » — le fichier .ics, fabrique DANS LE NAVIGATEUR
//
// L'ecran de confirmation demandait au client de noter une heure et une
// reference sur un bout de papier. Le rendez-vous est pris a un moment ou il a
// deja son telephone en main : le poser dans son agenda est le geste qui evite
// l'oubli, et un oubli coute une place vide au commercant.
//
// >>> RIEN NE PART SUR LE RESEAU. <<< Tout ce qu'il faut est deja a l'ecran :
// la prestation, le jour, l'heure, la duree, l'adresse, le telephone, la
// reference. Le fichier est ecrit ici, remis au navigateur par une adresse
// `blob:`, et l'application d'agenda du telephone s'en occupe. Aucune adresse
// « /calendrier.ics » a servir, aucun envoi de courriel, aucune dependance —
// et surtout aucune donnee du client qui reparte quelque part.
//
// LE FORMAT EST UNE NORME ANCIENNE ET STABLE (RFC 5545, 1998 puis 2009). C'est
// exactement le genre de chose qu'on peut ecrire a la main sans crainte : elle
// ne bougera pas, et elle est lue par iOS, Android, Outlook et Thunderbird.
// Trois de ses regles ne se devinent pas, et un fichier qui les ignore
// s'ouvre chez les uns et pas chez les autres :
//
//   1. LES FINS DE LIGNE SONT CRLF. Pas `\n` seul.
//   2. LES LIGNES SE PLIENT A 75 OCTETS, la suite commencant par une espace.
//   3. LA VIRGULE, LE POINT-VIRGULE ET LA CONTRE-OBLIQUE S'ECHAPPENT, et le
//      saut de ligne s'ecrit `\n` en toutes lettres.
//
// L'HEURE EST ECRITE EN UTC, et c'est le point delicat — voir `instantUtc()`.
// ---------------------------------------------------------------------------

/** Le fuseau du commerce, avec un repli sur celui de la France. */
function fuseauCommerce() {
  return CONFIG?.fuseau || 'Europe/Paris';
}

/**
 * L'ecart entre un instant donne et l'heure murale d'un fuseau, en
 * millisecondes.
 *
 * `Intl` est la seule chose du navigateur qui connaisse les regles d'heure
 * d'ete de chaque pays, et elle les connait a jour. On lui demande donc de
 * formater un instant DANS le fuseau du commerce, on relit les nombres qu'elle
 * rend, et la difference avec l'instant de depart est l'ecart cherche.
 */
function ecartFuseau(instant, fuseau) {
  const parties = new Intl.DateTimeFormat('en-US', {
    timeZone: fuseau,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(instant));

  const p = {};
  for (const { type, value } of parties) p[type] = value;

  // ⚠️ `hour` PEUT VALOIR « 24 ». Certaines versions d'ICU ecrivent minuit de
  //    cette facon en horloge sur 24 heures. Non corrige, un rendez-vous pris
  //    a minuit se decalerait d'un jour entier.
  const heure = p.hour === '24' ? 0 : Number(p.hour);

  const mural = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day),
    heure, Number(p.minute), Number(p.second));

  return mural - instant;
}

/**
 * L'instant reel (UTC) d'une heure murale du commerce.
 *
 * >>> C'EST ICI QUE SE JOUE LE FUSEAU, ET C'EST LA SEULE PARTIE DIFFICILE. <<<
 *
 * Le site ne transporte que des heures murales : `date` vaut « 2026-08-13 » et
 * `minutes` vaut 510, c'est-a-dire 8h30 A BAVAY. Pour ecrire un `.ics` en UTC,
 * il faut savoir combien vaut l'ecart CE JOUR-LA — une heure l'hiver, deux
 * l'ete — et l'ecart depend de l'instant, qui depend de l'ecart.
 *
 * D'ou les deux passes : la premiere lit l'ecart en supposant que l'heure
 * murale est deja de l'UTC, la seconde le relit a l'instant corrige. Deux
 * suffisent partout, y compris la nuit du changement d'heure, sauf pendant
 * l'heure qui existe deux fois en octobre — ou aucune methode ne peut trancher,
 * puisque l'heure murale y designe reellement deux instants.
 *
 * ⚠️ NE PAS REMPLACER PAR `new Date(date + 'T' + heure)`. Cette ecriture-la est
 *    interpretee dans le fuseau DU VISITEUR : un client qui reserve depuis un
 *    telephone reste a l'heure de Montreal se retrouverait avec un rendez-vous
 *    a 14h30 dans son agenda. C'est exactement le genre d'erreur qui ne se voit
 *    jamais depuis la France.
 */
function instantUtc(date, minutes) {
  const fuseau = fuseauCommerce();
  const [a, m, j] = String(date).split('-').map(Number);
  const h = Math.floor(minutes / 60);
  const mn = minutes % 60;

  const mural = Date.UTC(a, m - 1, j, h, mn, 0);

  let instant = mural;
  for (let passe = 0; passe < 2; passe++) {
    instant = mural - ecartFuseau(instant, fuseau);
  }

  return instant;
}

/** « 20260813T063000Z » — la forme que la norme attend. */
function horodatageIcs(instant) {
  return new Date(instant).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * L'echappement de la norme, sur une valeur de propriete.
 *
 * La contre-oblique EN PREMIER : la traiter apres doublerait celles que les
 * trois autres remplacements viennent d'ecrire.
 */
function echapperIcs(valeur) {
  return String(valeur ?? '')
    .replaceAll('\\', '\\\\')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Le pliage a 75 octets.
 *
 * ⚠️ OCTETS, PAS CARACTERES. « Référence » et « L'Établi » comptent des
 *    caracteres accentues, qui pesent deux octets en UTF-8 : un pliage
 *    compte en caracteres laisserait passer des lignes trop longues, et
 *    certains agendas tronquent alors la valeur sans rien dire.
 *
 * Et on ne coupe pas au milieu d'un caractere : la continuation reprend au
 * caractere entier suivant, sans quoi l'accent devient un losange noir.
 */
function plierIcs(ligne) {
  const encodeur = new TextEncoder();
  if (encodeur.encode(ligne).length <= 75) return ligne;

  const morceaux = [];
  let courant = '';
  let poids = 0;
  // La premiere ligne tient 75 octets, les suivantes 74 : l'espace de
  // continuation en occupe un.
  let plafond = 75;

  for (const caractere of ligne) {
    const taille = encodeur.encode(caractere).length;
    if (poids + taille > plafond) {
      morceaux.push(courant);
      courant = '';
      poids = 0;
      plafond = 74;
    }
    courant += caractere;
    poids += taille;
  }
  morceaux.push(courant);

  return morceaux.join('\r\n ');
}

/**
 * Le contenu du fichier, pour le rendez-vous qui vient d'etre confirme.
 *
 * Renvoie `null` s'il manque de quoi ecrire un evenement juste : mieux vaut
 * pas de bouton qu'un fichier qui pose la mauvaise heure dans un agenda.
 */
function fabriquerIcs({ date, start, duree, prestation, avec, reference }) {
  if (!date || !Number.isFinite(start) || !Number.isFinite(duree)) return null;

  const salon = CONFIG?.salon ?? {};
  const debut = instantUtc(date, start);
  const fin = debut + duree * 60 * 1000;

  const adresse = [salon.street, [salon.postalCode, salon.city].filter(Boolean).join(' ')]
    .filter(Boolean).join(', ');

  const titre = [prestation, salon.name].filter(Boolean).join(' — ');

  const description = [
    avec ? `Avec ${avec}.` : '',
    reference ? `Référence : ${reference}.` : '',
    salon.phone ? `Téléphone : ${salon.phone}.` : '',
    reference ? `Annuler ou déplacer : ${location.origin}/annuler` : '',
  ].filter(Boolean).join('\n');

  // L'IDENTIFIANT DE L'EVENEMENT. La reference du rendez-vous en fait un bon :
  // elle est unique, et un client qui reprend le fichier deux fois voit son
  // agenda METTRE A JOUR l'evenement au lieu d'en creer un second.
  const uid = `${reference || debut}@${location.hostname}`;

  const lignes = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${echapperIcs(salon.name || 'Réservation')}//Rendez-vous//FR`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${echapperIcs(uid)}`,
    `DTSTAMP:${horodatageIcs(Date.now())}`,
    `DTSTART:${horodatageIcs(debut)}`,
    `DTEND:${horodatageIcs(fin)}`,
    `SUMMARY:${echapperIcs(titre)}`,
    adresse ? `LOCATION:${echapperIcs(adresse)}` : '',
    description ? `DESCRIPTION:${echapperIcs(description)}` : '',
    // Un rappel la veille au soir plutot qu'un quart d'heure avant : ce qui
    // sauve un rendez-vous chez le barbier, c'est de pouvoir encore le
    // decaler, pas d'apprendre qu'on est en retard.
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER:-PT12H',
    `DESCRIPTION:${echapperIcs(titre)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean);

  // ⚠️ CRLF, ET UN CRLF FINAL. Sans lui, Outlook refuse le fichier entier.
  return lignes.map(plierIcs).join('\r\n') + '\r\n';
}

/** « letabli-13-08-2026.ics » — un nom qui se retrouve dans un dossier. */
function nomFichierIcs(date) {
  const base = (CONFIG?.salon?.name || 'rendez-vous')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const [a, m, j] = String(date).split('-');
  return `${base || 'rendez-vous'}-${j}-${m}-${a}.ics`;
}

/**
 * Remettre le fichier au navigateur.
 *
 * ⚠️ UNE ADRESSE `blob:`, PAS UNE `data:`. Les deux marchent sur un ordinateur ;
 *    sur iOS, une `data:` de type calendrier ouvre une page blanche au lieu de
 *    proposer l'ajout. Le `blob:` passe par la feuille de partage, qui est le
 *    chemin attendu sur telephone.
 *
 * ⚠️ L'ADRESSE SE LIBERE, mais PAS DANS LA FOULEE : Safari n'a pas fini de lire
 *    le fichier quand le clic revient, et la revoquer tout de suite annule le
 *    telechargement. Une seconde suffit, et l'onglet ne garde rien de plus.
 */
function telechargerIcs(texte, nom) {
  const blob = new Blob([texte], { type: 'text/calendar;charset=utf-8' });
  const adresse = URL.createObjectURL(blob);

  const lien = document.createElement('a');
  lien.href = adresse;
  lien.download = nom;
  lien.rel = 'noopener';
  document.body.appendChild(lien);
  lien.click();
  lien.remove();

  setTimeout(() => URL.revokeObjectURL(adresse), 1000);
}

/**
 * Le clic sur « Ajouter à mon agenda ».
 *
 * ⚠️ IL LIT `RESERVATION.pourAgenda`, ET NON `RESERVATION.confirmee`. Les deux
 *    chemins qui menent a l'ecran de confirmation ne remplissent pas le meme
 *    objet : une reservation neuve pose `confirmee`, un DEPLACEMENT venu de
 *    /annuler ne le pose pas — il n'a pas de jeton a garder. Le bouton se serait
 *    donc affiche sans rien faire apres un deplacement. Les deux chemins
 *    remplissent maintenant `pourAgenda`, qui ne porte que ce que le fichier
 *    demande, et c'est la seule source lue ici.
 */
function ajouterAMonAgenda() {
  const rdv = RESERVATION.pourAgenda;
  if (!rdv) return;

  const texte = fabriquerIcs(rdv);
  if (!texte) return;

  telechargerIcs(texte, nomFichierIcs(rdv.date));
}

/**
 * Le bouton n'existe que si le navigateur sait faire.
 *
 * Trois choses lui sont necessaires : fabriquer un `Blob`, en tirer une
 * adresse, et telecharger par l'attribut `download`. Un navigateur qui n'a pas
 * les trois ne doit pas voir un bouton qui ne fera rien — la degradation, ici
 * comme pour le bandeau d'etat, consiste a ne rien montrer.
 */
function preparerBoutonAgenda() {
  const bouton = $('#ajouterAgenda');
  if (!bouton) return;

  const capable = typeof Blob === 'function'
    && typeof URL?.createObjectURL === 'function'
    && 'download' in document.createElement('a');

  if (!capable) {
    bouton.remove();
    return;
  }

  bouton.addEventListener('click', ajouterAMonAgenda);
}
