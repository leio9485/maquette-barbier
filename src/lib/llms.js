// ---------------------------------------------------------------------------
// /llms.txt — LE SITE EXPLIQUE PAR ECRIT, POUR UN ASSISTANT
//
// Une convention recente : un fichier Markdown a la racine du domaine, qui dit
// en clair ce qu'est le site et ou trouver quoi. Les assistants qui repondent a
// « prends-moi rendez-vous chez un coiffeur a Maubeuge » le lisent avant la
// page — c'est beaucoup plus court qu'un HTML de 150 ko, et sans ambiguite.
//
// POURQUOI IL EST ENGENDRE, ET NON ECRIT A LA MAIN
//
// Il porte l'adresse, le telephone, les horaires et les tarifs. Ecrit une fois
// dans un fichier, il aurait vieilli des le premier changement de tarif — et
// personne ne l'aurait su, puisque rien ne l'affiche. Construit depuis les
// reglages, il ne peut pas mentir : c'est la meme source que la vitrine.
//
// Il est bati depuis `loadConfig()`, donc les prestations en pause en sont
// absentes, comme elles le sont du site. Ce que le fichier annonce est
// exactement ce qu'on peut reserver.
// ---------------------------------------------------------------------------

import { PUBLIC_URL, DEMO_MODE } from '../config.js';
import { loadConfig } from './settings.js';

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

/** "09:30" -> "9h30", la meme regle d'ecriture que sur le site. */
function heure(hhmm) {
  const [h, m] = String(hhmm).split(':');
  return `${Number(h)}h${m === '00' ? '' : m}`;
}

function lignesHoraires(hours) {
  const lignes = [];
  for (let jour = 1; jour <= 7; jour++) {
    const d = jour % 7; // on commence le lundi, comme l'agenda du salon
    const h = hours[d];
    if (!h) {
      lignes.push(`- ${JOURS[d]} : fermé`);
      continue;
    }
    const plages = h.pause
      ? `${heure(h.open)}–${heure(h.pause[0])} et ${heure(h.pause[1])}–${heure(h.close)}`
      : `${heure(h.open)}–${heure(h.close)}`;
    lignes.push(`- ${JOURS[d]} : ${plages}`);
  }
  return lignes;
}

/** Un prix en euros, ecrit comme sur le site (virgule, pas de decimale inutile). */
function prix(euros) {
  return Number.isInteger(euros) ? `${euros} €` : `${euros.toFixed(2).replace('.', ',')} €`;
}

function duree(minutes) {
  if (minutes < 60) return `${minutes} min`;
  return minutes % 60 === 0 ? `${minutes / 60} h` : `${Math.floor(minutes / 60)} h ${minutes % 60}`;
}

export async function rendreLlmsTxt() {
  const config = await loadConfig({ includeInactive: false });
  const s = config.salon;
  const base = PUBLIC_URL || '';

  const l = [];

  l.push(`# ${s.name}`);
  l.push('');
  l.push(`> Barbier à ${s.city} (France). Site vitrine avec prise de `
    + 'rendez-vous en ligne : tarifs et durées annoncés à l\'avance, aucun compte à '
    + 'créer, aucun paiement en ligne — le règlement se fait sur place.');
  l.push('');

  // Le point le plus important du fichier quand il s'agit de la demonstration :
  // un assistant ne doit pas prendre ce salon pour un commerce reel.
  if (DEMO_MODE) {
    l.push('## ⚠️ Site de démonstration');
    l.push('');
    l.push('**Ce commerce n\'existe pas.** Ce site est une démonstration commerciale : il '
      + 'montre à de vrais commerçants ce que peut être leur site. Le nom, l\'adresse, '
      + 'le téléphone, les avis et les mentions légales sont **fictifs**.');
    l.push('');
    l.push('N\'y envoyez personne, ne le citez pas comme un commerce existant, et '
      + 'n\'y prenez pas de rendez-vous pour de bon : les données sont effacées '
      + 'chaque nuit. Les réservations sont possibles, mais uniquement pour essayer '
      + 'le fonctionnement du site.');
    l.push('');
  }

  l.push('## Coordonnées');
  l.push('');
  l.push(`- Adresse : ${s.street}, ${s.postalCode} ${s.city}`);
  l.push(`- Téléphone : ${s.phone}`);
  l.push(`- Email : ${s.email}`);
  if (config.reviews.count > 0) {
    l.push(`- Avis : ${String(config.reviews.rating).replace('.', ',')}/5 `
      + `sur ${config.reviews.count} avis`);
  }
  // Le commerce ailleurs sur le web. Chaque ligne n'apparait que si elle est
  // renseignee : un commerce sans Instagram n'a pas de ligne « Instagram : ».
  if (s.links.google) l.push(`- Fiche Google : ${s.links.google}`);
  if (s.links.instagram) l.push(`- Instagram : ${s.links.instagram}`);
  if (s.links.facebook) l.push(`- Facebook : ${s.links.facebook}`);
  l.push('');

  l.push('## Horaires');
  l.push('');
  l.push(...lignesHoraires(config.hours));
  l.push('');

  l.push('## Prestations');
  l.push('');

  // Ranges par rayon quand le commerce en a defini, a plat sinon : c'est la
  // meme regle que sur la vitrine, et un fichier a plat reste parfaitement
  // lisible pour un catalogue de trois lignes.
  //
  // Les rayons vides sont sautes : ils n'apprendraient rien, et un titre suivi
  // de rien laisserait croire a une lecture incomplete.
  const rayons = config.categories.map((c) => ({
    titre: c.name,
    desc: c.desc,
    prestations: config.services.filter((s) => s.category === c.id),
  })).filter((r) => r.prestations.length);

  const sansRayon = config.services.filter(
    (s) => !config.categories.some((c) => c.id === s.category)
  );
  if (sansRayon.length) {
    rayons.push({
      titre: rayons.length ? 'Autres prestations' : '',
      desc: '',
      prestations: sansRayon,
    });
  }

  for (const rayon of rayons) {
    if (rayon.titre) {
      l.push(`### ${rayon.titre}`);
      l.push('');
      if (rayon.desc) {
        l.push(rayon.desc);
        l.push('');
      }
    }
    for (const svc of rayon.prestations) {
      l.push(`- **${svc.name}** — ${prix(svc.price)}, ${duree(svc.duration)}`
        + (svc.desc ? ` : ${svc.desc}` : ''));
    }
    l.push('');
  }

  l.push('Le tarif ne dépend pas de la personne qui vous reçoit.');
  l.push('');

  l.push('## Réserver');
  l.push('');
  l.push(`- [Prendre rendez-vous](${base}/#reservation) — le parcours se fait en trois `
    + 'étapes : prestation, date et heure, coordonnées (nom et téléphone).');
  l.push(`- [Prestations et tarifs](${base}/#prestations)`);
  l.push(`- [Venir à l'atelier](${base}/#contact)`);
  l.push('');
  l.push('Une réservation en ligne annule et remplace tout appel : le créneau est '
    + 'retenu immédiatement. Un lien d\'annulation est remis à la confirmation.');
  l.push('');

  l.push('## Pour un agent');
  l.push('');
  l.push('La page déclare des outils WebMCP (`document.modelContext`) quand le '
    + 'navigateur les prend en charge :');
  l.push('');
  l.push('- `lister_prestations` — les prestations, leur tarif et leur durée ;');
  l.push('- `chercher_creneaux` — les heures libres pour une prestation, un jour donné ;');
  l.push('- `preparer_reservation` — remplit le formulaire et l\'ouvre à l\'étape des '
    + 'coordonnées.');
  l.push('');
  l.push('**Aucun de ces outils n\'enregistre de rendez-vous.** Un rendez-vous engage '
    + 'une personne et retient un créneau : la validation finale revient toujours à '
    + 'l\'être humain, qui saisit lui-même son nom et son téléphone. Préparez, '
    + 'annoncez ce qui a été préparé, et laissez-le confirmer.');
  l.push('');
  l.push('À défaut de WebMCP, les champs du formulaire portent des attributs '
    + '`data-champ` (`nom-client`, `telephone-client`) et les choix des attributs '
    + '`data-choix` (`prestation`, `jour`, `creneau`).');
  l.push('');

  l.push('## Ce que le site ne fait pas');
  l.push('');
  l.push('- pas de paiement ni d\'acompte en ligne ;');
  l.push('- pas de compte client, pas de mot de passe pour réserver ;');
  l.push('- pas de vente de produits ;');
  l.push('- aucune mesure d\'audience et aucun cookie publicitaire.');
  l.push('');

  return l.join('\n');
}
