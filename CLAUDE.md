# CLAUDE.md — L'Établi (site vitrine d'un barbier)

## Ce que c'est

Une **seconde démonstration commerciale**, destinée aux barbiers et coiffeurs
homme. La première est Studio Cassandre (salon de coiffure féminin).

Les deux servent le même argument de vente auprès de commerçants d'une même
zone. D'où la contrainte qui gouverne tout ce dépôt :

> **Un visiteur qui voit les deux démos ne doit pas pouvoir deviner qu'elles
> sortent de la même main — sauf au niveau de soin.**

Si deux boutiques de la même rue reconnaissent le même site sous deux
habillages, les deux prospects sont perdus.

Second objectif, aussi contraignant : le site doit **tenir cinq ans sans
retouche esthétique**. Un barbier ne refait pas son site tous les deux ans.

## L'héritage, et ce qui a été refait

| Repris tel quel de Studio Cassandre | Réécrit intégralement |
|---|---|
| Express, Prisma/SQLite | `src/page/` **en entier** — style, balisage, JavaScript |
| authentification scrypt, sessions, `requireAdmin` | `src/lib/catalogue.js` (produit du balisage de façade) |
| calcul de disponibilité (`src/lib/availability.js`) | `src/lib/temoignages.js` (idem) |
| en-têtes de sécurité, nonces CSP, limitation de débit | les couleurs de `src/lib/plan.js` |
| l'architecture d'assemblage (`@inclure`) | |

Rien du style, du balisage ni des formulations de Cassandre n'a été repris. Le
serveur, lui, est du travail déjà payé, invisible du visiteur, et c'est la partie
où un bogue coûte cher.

**La clé `salon` a été conservée** dans la base et toute la couche serveur
(`config.salon.name`, `data/commerce.db`). Elle est invisible du visiteur ; la
renommer aurait cassé dix migrations et 400 tests pour un mot que personne ne lit.

## La direction artistique : l'atelier

Le monde de référence n'est **pas** le « barbershop » mais l'atelier d'artisan :
l'établi, l'outil rangé, la fiche de travail, l'heure affichée à la porte. Sobre,
utile, propre. Ça vieillit bien parce que ça n'a jamais été à la mode.

### Ce qui est interdit, et pourquoi

**Les clichés du barbier** — c'est ce que font tous les concurrents, donc c'est
exactement ce qui ne différencie pas : noir + or, enseigne tricolore, textures
vieillies, papier kraft, effet cuir, planches de bois, typographies western ou
tatouage, fausse ancienneté (« Est. 1923 »), vocabulaire « gentleman »,
« grooming », « bespoke ».

**Les tics qui datent une page** (ils vieillissent en dix-huit mois) : dégradés,
halos néon, verre dépoli, neumorphisme, ombres portées diffuses, grands rayons
d'arrondi, cartes flottantes, parallaxe, apparitions au défilement, compteurs
animés, emoji dans l'interface, packs d'icônes génériques.

**Tout ce qui rappelle Cassandre** : pas d'ivoire, pas de prune, pas de doré, pas
de serif italique, pas de section centrée à sur-titre en petites capitales, pas
de grille de cartes de prestations.

### Les règles positives

- **Cinq couleurs**, déclinées par fond. Tous les jetons sont dans
  `src/page/styles/02-jetons.css`, avec leur contraste **mesuré** en commentaire.
- **Trois familles de polices**, trois rôles : Archivo pour les titres,
  Source Sans 3 pour le texte, **Source Code Pro pour toute donnée** — tarifs,
  durées, heures, dates, téléphone. Cette dernière règle n'a pas d'exception :
  dans un site de réservation, les chiffres *sont* le contenu.
- **Six espacements** : 8 / 16 / 24 / 40 / 64 / 96. Jamais un septième.
- **Angles droits.** Rayon 0 partout, 2 px sur les champs de saisie.
- **Aucune ombre portée.** La hiérarchie se fait par aplats pleins bord à bord
  et par les blancs.
- **Aligné à gauche, jamais centré.**
- **Presque aucun mouvement** : 150 ms sur les états interactifs, rien d'autre.

### L'élément signature

**Le bandeau d'état**, collé en haut de chaque page (`src/lib/etat.js`) :

```
OUVERT · FERME À 19H00 · PROCHAIN CRÉNEAU AUJOURD'HUI 16H45   [ RÉSERVER ]
FERMÉ · OUVRE DEMAIN 9H00 · PROCHAIN CRÉNEAU DEMAIN 9H30      [ RÉSERVER ]
```

C'est là que passe **toute** l'audace du site, et nulle part ailleurs. Il se
justifie sur trois plans : la question qu'on se pose en arrivant sur la page d'un
barbier est « je peux venir quand ? » ; ça démontre en trois secondes qu'il y a
un vrai serveur derrière ; et une information utile ne se démode pas.

⚠️ **Les phrases sont composées côté serveur et renvoyées toutes faites.** Le
navigateur remplace du texte par du texte, il n'assemble rien : une seule
formulation existe dans le projet, elle ne peut donc pas diverger.

⚠️ **La dégradation consiste à ne rien faire.** Si `/api/status` échoue, le
bandeau garde ce que le serveur y avait écrit au chargement. Jamais de message
d'erreur, jamais de bandeau vide, jamais de « chargement… ».

### Le ton des textes

Phrases courtes, voix active, minuscules après la première lettre. On dit ce que
le bouton fait : « Réserver ce créneau », pas « Continuer ». Les messages
d'erreur disent ce qui s'est passé et quoi faire, sans s'excuser. Aucun adjectif
de vente.

## L'architecture

Le navigateur reçoit **une seule page**, sans framework et **sans étape de
construction**. Les morceaux vivent dans `src/page/` et le serveur les recolle à
chaque envoi. Le mode d'emploi complet est dans `src/page/LISEZ-MOI.md` — le lire
avant de toucher à la façade.

```
src/
  server.js          les routes
  config.js          les réglages d'instance (une seule source)
  lib/
    etat.js          ← le bandeau d'état. Ajouté pour ce site.
    availability.js  toute la règle métier des créneaux
    catalogue.js     la liste tarifaire, écrite dans la page servie
    temoignages.js   la section « Avis », idem
    plan.js          le plan du quartier, dessiné depuis l'adresse
    defaults.js      >>> LE FICHIER À ADAPTER POUR CHAQUE CLIENT <<<
  page/              la façade — voir src/page/LISEZ-MOI.md
```

## Les pièges, appris à la construction

**`DEMO_MODE` ne se pose jamais en local.** Une partie de la suite vérifie
qu'une instance ordinaire ne porte aucune trace du mode démonstration. Pire : le
compte `demo` **reste en base** après désactivation, un test s'y connecte pour
vérifier qu'il n'existe pas, obtient une session valide, et six contrôles d'accès
passent alors au vert à tort. Si des tests d'autorisation échouent
inexplicablement, chercher d'abord un compte `demo` résiduel.

**Les journées n'ont pas toutes les mêmes heures.** Nocturne le vendredi
jusqu'à 21 h, samedi en journée continue de 8 h 30 à 17 h. Tout code qui écrit
une heure en dur — un test, un rendez-vous de démonstration — doit vérifier
qu'elle tient dans une plage ouverte ce jour-là, sinon il casse un vendredi sur
deux. `prochainJourOuvert()` est pour cette raison forcé sur mardi–jeudi, les
trois jours aux horaires identiques.

**Le balisage des prestations et des avis est écrit à deux endroits** — côté
serveur pour ceux qui n'exécutent pas de JavaScript, côté page pour la mise à
jour sans rechargement. Les deux doivent produire exactement le même HTML. Un
commentaire le rappelle des deux côtés, un test le vérifie.

**Pas d'`aria-label` sur les lignes tarifaires.** Il y en avait un ; il violait
WCAG 2.5.3 (« Label in Name ») en omettant la description visible. Conséquence
concrète : quelqu'un qui pilote le site à la voix disait « cliquer sur Coupe
homme aux ciseaux » et rien ne se passait.

**Le bleu de travail est bien plus clair que l'encre.** L'acier et le vert qui
tiennent 5,9:1 sur l'encre n'y font plus que 3,5:1. D'où des déclinaisons
propres au fond bleu dans `03-fondations.css`. Avant de poser une couleur sur un
nouveau fond : mesurer.

## Vérifier

```bash
npm test
```

401 tests. Le serveur doit tourner (`npm run dev`) et **`DEMO_MODE` doit être
absent** du `.env`.

État au moment de la livraison — Lighthouse mobile : performance 99,
accessibilité 100, bonnes pratiques 100, SEO 100. LCP 2,0 s en 4G lente simulée,
CLS 0, 153 Ko transférés.

Rendu vérifié en 390, 768 et 1440 px : aucun défilement horizontal, aucune cible
tactile sous 24 px, tous les contrastes employés au-dessus de 4,5:1.

## Mise en ligne

Image Docker, sans dépendance à un hébergeur en particulier. Cible : **Koyeb,
région Francfort**.

Variables à poser sur l'instance de démonstration :

```
DEMO_MODE=true
NODE_ENV=production
PUBLIC_URL=https://…
```

`DEMO_MODE=true` **uniquement sur la démonstration** : chez un vrai client, ce
serait publier l'agenda de ses clients avec le mot de passe à côté.

## Conventions à respecter

- Le site reste **une seule page envoyée**. Ajouter un morceau se fait en créant
  le fichier et en posant son `@inclure` dans le squelette — jamais en ajoutant
  un `<link>` ou un `<script src>`.
- **Aucune valeur de couleur, de taille ou d'espacement en dehors de
  `02-jetons.css`.**
- Aucune dépendance ajoutée sans validation. Le projet en compte quatre.
- Ne pas casser le tunnel sans repasser par ses quatre étapes : prestation,
  date et heure (avec qui compris), coordonnées, confirmation.
- Vérifier à l'écran, pas seulement dans le code : 390, 768 et 1440 px avant de
  considérer une section terminée.
