# src/page/ — la façade

Le navigateur reçoit **une seule page** : un fichier, un style, un script,
aucune requête supplémentaire. Mais elle ne s'écrit pas dans un seul fichier —
sept mille lignes dans lesquelles retrouver la règle CSS d'un bouton coûtait
plus cher que la modification elle-même.

Les morceaux vivent donc ici, et le serveur les recolle à chaque envoi
(`src/lib/assemblage.js`). **Aucune étape de construction** : on modifie un
morceau, on recharge la page.

## Le squelette

`index.html` ne contient ni style ni script : il dit dans quel ordre les
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
instruction et le démarrage (`11`) la dernière.

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

Une valeur de couleur ou d'espacement écrite en dur ailleurs que dans
`02-jetons.css` est un bogue : elle échappera au prochain réglage et se
découvrira six mois plus tard, sur un écran qu'on n'avait pas.

## Les trois zones remplacées par le serveur

Le serveur réécrit trois morceaux de la page à chaque envoi
(`src/lib/page.js`). Ce qui est écrit entre leurs marqueurs dans les fichiers
`parties/` est du **contenu de secours** : il ne s'affiche que si la base est
injoignable.

| Marqueurs | Contenu | Écrit par |
|---|---|---|
| `<!--@reglages-->` | titre, description, JSON-LD | `src/lib/page.js` |
| `<!--@prestations-->` | la liste tarifaire | `src/lib/catalogue.js` |
| `<!--@temoignages-->` | la section « Avis » entière | `src/lib/temoignages.js` |
| `<!--@bandeau-->` | l'état du moment | `src/lib/etat.js` |

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

| Fichier | Rôle |
|---|---|
| `00-trusted-types.js` | la politique d'écriture du HTML. **Première instruction.** |
| `01-configuration.js` | tout ce que la page garde en mémoire, en un seul endroit |
| `02-utilitaires.js` | échappement, dates, formats. Ne connaît rien du barbier. |
| `03-donnees.js` | tous les échanges avec le serveur, et eux seuls |
| `04-contenu-statique.js` | la vitrine, peinte depuis les réglages |
| `05-navigation.js` | surimpressions, passage vitrine ↔ espace |
| `06-bandeau-etat.js` | le rafraîchissement du bandeau |
| `07-tunnel.js` | les quatre étapes de la réservation |
| `08-reglages.js` | le brouillon et son enregistrement |
| `09-agenda.js` | l'agenda du commerçant |
| `10-mon-compte.js` | connexion, déconnexion, onglets |
| `11-demarrage.js` | l'ordre d'allumage. **Dernier fichier.** |

Rien n'est écrit dans le navigateur : ni `localStorage`, ni cookie côté page.
Les données vivent sur le serveur, et une visite ne laisse aucune trace sur la
machine du visiteur.
