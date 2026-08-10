# src/page/ — la façade

Le navigateur reçoit **un seul fichier par page** : un style, un script, aucune
requête supplémentaire. Mais une page ne s'écrit pas dans un seul fichier —
sept mille lignes dans lesquelles retrouver la règle CSS d'un bouton coûtait
plus cher que la modification elle-même.

Les morceaux vivent donc ici, et le serveur les recolle à chaque envoi
(`src/lib/assemblage.js`). **Aucune étape de construction** : on modifie un
morceau, on recharge la page.

## Trois documents, pas un

Le site en comptait un seul : la vitrine et l'espace commerçant cohabitaient
dans le même `<body>`, et un bouton masquait l'un pour montrer l'autre. Le
balisage de l'agenda partait donc chez chaque visiteur — 35 % du poids de la
page.

| Squelette | Servi par | Ce qu'il contient |
|---|---|---|
| `index.html` | `/` | la vitrine, et elle seule |
| `espace.html` | `/espace-salon` | l'agenda, les chiffres, les réglages |
| `annuler.html` | `/annuler` | annuler ou déplacer son rendez-vous |

Ils **ne partagent que des morceaux, jamais un résultat** : chacun a son propre
cache d'assemblage. Un fichier employé par plusieurs documents doit vivre dans
un endroit neutre — `02-jetons.css`, `03-fondations.css`, `05-controles.css`,
`js/00-*`, `js/02-utilitaires.js`. Une feuille propre à l'un des trois qu'on
inclut dans un autre « pour avoir tout sous la main » annule le découpage.

⚠️ **Un test compte les octets et cherche les chaînes interdites** dans chaque
document (`tests/espace.mjs`). Une régression ici serait invisible : le site
marcherait pareil, il serait seulement redevenu lourd.

## Le squelette

Un squelette ne contient ni style ni script : il dit dans quel ordre les
morceaux se recollent. C'est la table des matières — on l'ouvre pour savoir où
aller, pas pour modifier.

Un morceau s'appelle par `@inclure`, dans la forme du langage qui l'entoure :

```
<!--@inclure parties/galerie.html-->     dans le HTML
/*@inclure styles/08-accueil.css*/       dans le <style>
/*@inclure js/07-tunnel.js*/             dans le <script>
```

⚠️ **L'ordre compte.** Pour le CSS, c'est l'ordre de la cascade. Pour le
JavaScript, la politique Trusted Types (`00`) doit rester la toute première
instruction et le démarrage la dernière — `13-demarrage.js` pour la vitrine,
`js/espace/demarrage.js` et `js/annuler/03-demarrage.js` pour les deux autres.

## Où aller pour quoi

| Je veux changer… | Fichier |
|---|---|
| une couleur, une taille, un espacement | `styles/02-jetons.css`, **et lui seul** |
| une police | `styles/01-polices.css` (+ le `preload` du squelette) |
| la grille et le rail | `styles/04-grille-et-rail.css` |
| un bouton, un champ, une fiche | `styles/05-controles.css` |
| le bandeau d'état | `styles/06-bandeau-etat.css` + `js/06-bandeau-etat.js` + `src/lib/etat.js` |
| le tunnel | `parties/tunnel.html` + `styles/13-tunnel.css` + `js/07-tunnel.js` |
| l'agenda | `styles/15-agenda.css` + `js/09-agenda.js` |
| les chiffres | `styles/17-chiffres.css` + `js/10-chiffres.js` + `src/lib/statistiques.js` |
| la page d'annulation | `parties/annuler.html` + `styles/20-annuler.css` + `js/annuler/` |

Une valeur de couleur ou d'espacement écrite en dur ailleurs que dans
`02-jetons.css` est un bogue : elle échappera au prochain réglage et se
découvrira six mois plus tard, sur un écran qu'on n'avait pas.

## Les zones remplacées par le serveur

Le serveur réécrit certains morceaux à chaque envoi (`src/lib/page.js`). Ce qui
est écrit entre leurs marqueurs dans les fichiers `parties/` est du **contenu de
secours** : il ne s'affiche que si la base est injoignable.

| Marqueurs | Contenu | Écrit par |
|---|---|---|
| `<!--@reglages-->` | titre, description, JSON-LD | `src/lib/page.js` |
| `<!--@prestations-->` | la liste tarifaire | `src/lib/catalogue.js` |
| `<!--@temoignages-->` | la section « Avis » entière | `src/lib/temoignages.js` |
| `<!--@bandeau-->` | l'état du moment | `src/lib/etat.js` |
| `<!--@espace-lien-->` | l'entrée de l'espace, **vidée hors démonstration** | `src/lib/page.js` |
| `<!--@annuler-entete-->` | le titre de `/annuler` | `src/lib/page.js` |
| `<!--@espace-entete-->` | le titre de `/espace-salon` | `src/lib/page.js` |

⚠️ **Ne jamais retirer un marqueur** : sans lui, la zone cesse de suivre les
réglages, sans que rien ne le signale.

⚠️ **Le balisage est écrit à deux endroits** pour les prestations et les avis :
côté serveur (pour ceux qui n'exécutent pas de JavaScript) et dans
`js/04-contenu-statique.js` (pour la mise à jour sans rechargement). Les deux
doivent produire **exactement** le même HTML — un commentaire le rappelle des
deux côtés, et un test le vérifie.

## Le JavaScript

Une seule fonction anonyme, ouverte dans le squelette et refermée plus bas.
Toutes les sections partagent donc la même portée : c'est ce qui leur permet de
s'appeler entre elles sans rien exporter, et c'est pourquoi elles sont recollées
plutôt que servies en fichiers séparés.

| Fichier | Documents | Rôle |
|---|---|---|
| `00-trusted-types.js` | les trois | la politique d'écriture du HTML. **Première instruction.** |
| `00-libelles.js` | les trois | les noms de jours et de mois, écrits une fois |
| `00-memoire.js` | vitrine, annuler | le rappel du rendez-vous, gardé dans le navigateur |
| `01-configuration.js` | vitrine, espace | ce que les deux partagent en mémoire |
| `02-utilitaires.js` | les trois | échappement, dates, formats. Ne connaît rien du barbier. |
| `03-donnees.js` | vitrine, espace | `api()` et les appels **publics** |
| `04-contenu-statique.js` | vitrine | la vitrine, peinte depuis les réglages |
| `05-navigation.js` | vitrine, espace | les surimpressions |
| `06-bandeau-etat.js` | vitrine | le rafraîchissement du bandeau |
| `07-tunnel.js` | vitrine | les quatre étapes de la réservation, et le déplacement |
| `08-reglages.js` | espace | le brouillon et son enregistrement |
| `09-agenda.js` | espace | l'agenda et le pointage des absences |
| `10-chiffres.js` | espace | le tableau de bord |
| `11-mon-compte.js` | espace | connexion, déconnexion, onglets |
| `12-mon-rendez-vous.js` | vitrine | le rappel sous l'en-tête |
| `13-demarrage.js` | vitrine | l'ordre d'allumage. **Dernier fichier de la vitrine.** |
| `espace/etat.js` | espace | ce que l'espace garde en mémoire |
| `espace/donnees.js` | espace | les appels **réservés au commerçant** |
| `espace/demarrage.js` | espace | **dernier fichier de l'espace** |
| `annuler/*.js` | annuler | les quatre écrans de l'annulation |

⚠️ **Un fichier de la colonne « espace » ne doit jamais réapparaître dans la
vitrine**, et réciproquement. C'est ce que vérifie `tests/espace.mjs`.

⚠️ **Un piège qui s'est produit deux fois** : du code de l'espace appelait
`peindreVitrine()` et `peindrePhotos()` pour rafraîchir la vitrine derrière.
Dans un document qui n'en a pas, c'est une `ReferenceError` — levée **après**
l'enregistrement, donc les données partaient bien et le message de confirmation
était avalé. Avant d'appeler une fonction depuis `08`, `09`, `10` ou `11`,
vérifier qu'elle est dans la colonne « espace ».

**Une seule chose est écrite dans le navigateur**, et seulement après une
réservation : le rappel du rendez-vous pris (`00-memoire.js`) — référence,
jeton, jour, heure, prestation, barbier. Ni nom, ni téléphone, ni courriel. Ni
cookie côté page, ni mesure d'audience. La page de confidentialité le décrit
exactement ; **si ce qui est gardé change, ce texte change avec lui.**

## Mettre un site en production : la manœuvre du `noindex`

⚠️ **C'est la seule opération de ce dépôt qui, oubliée, ne se voit pas et coûte
tout.** Un site de client livré en `noindex` fonctionne parfaitement, se
partage, prend des rendez-vous — et n'apparaît jamais dans Google. Personne ne
s'en aperçoit avant des semaines.

Le retrait des moteurs est piloté par **`DEMO_MODE`, et par lui seul** :

```js
// src/server.js
if (DEMO_MODE) {
  app.use((req, res, next) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    next();
  });
}
```

Chez un vrai client, la manœuvre tient en deux lignes de configuration :

1. **Ne pas poser `DEMO_MODE`.** Pas `DEMO_MODE=false` : *absente*. La variable
   n'est vraie que pour la chaîne exacte `"true"`, donc `false` marcherait
   aussi — mais une variable qu'on lit dans la console de l'hébergeur et qui
   dit « demo » sur un site de client finit toujours par inquiéter quelqu'un.
2. **Poser `PUBLIC_URL`.** Sans elle : ni adresse canonique, ni `og:image`, ni
   plan de site, ni `potentialAction` dans les données structurées. Le site
   marche, il est simplement muet pour tout ce qui le lit de l'extérieur.

### Vérifier, en trois commandes

```bash
curl -sI https://le-site-du-client.fr | grep -i x-robots-tag
```

Aucune ligne ne doit sortir. Si `noindex` apparaît, `DEMO_MODE` traîne encore.

```bash
curl -s https://le-site-du-client.fr/robots.txt
```

Doit contenir `Allow: /`, `Sitemap: …`, et **uniquement** les trois `Disallow`
des routes privées (`/espace-salon`, `/annuler`, `/annulation`).

```bash
curl -s https://le-site-du-client.fr/sitemap.xml | head -5
```

Doit répondre du XML. Un 404 signifie que `PUBLIC_URL` manque.

### Ce qui reste en `noindex` chez tout le monde

`/espace-salon` et `/annuler`, indépendamment de `DEMO_MODE` : l'agenda d'un
vrai client n'a pas plus à figurer dans Google que celui de la démonstration.
Ces deux-là portent leur en-tête **et** une balise `<meta name="robots">` dans
la page. `noindex` n'est pas un contrôle d'accès — ce qui protège l'agenda est
`requireAdmin` sur `/api/admin/…`.
