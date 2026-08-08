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
- **Une superfamille, trois cuts, trois rôles** : IBM Plex Sans Condensed 600
  pour les titres, IBM Plex Sans pour le texte, **IBM Plex Mono pour toute
  donnée** — tarifs, durées, heures, dates, téléphone. Cette dernière règle n'a
  pas d'exception : dans un site de réservation, les chiffres *sont* le contenu.
  C'était trois familles de trois fonderies ; elles se tenaient sans former un
  système. Le raisonnement complet, **et l'argument contraire qu'il a fallu
  écarter**, sont dans `public/fonts/LISEZ-MOI.md`.
  La graisse des titres passe par le jeton `--g-titre` : le Condensed n'existe
  qu'en 600, et tout `font-weight: 700` ferait synthétiser un faux gras.
- **Six espacements** : 8 / 16 / 24 / 40 / 64 / 96. Jamais un septième.
- **Angles droits.** Rayon 0 partout, 2 px sur les champs de saisie.
- **Aucune ombre portée.** La hiérarchie se fait par aplats pleins bord à bord
  et par les blancs.
- **Aligné à gauche, jamais centré** — et *aligné sur la même abscisse* :
  bandeau, nom du commerce, rails de section, bande de repères et pied de page
  démarrent tous à la gouttière de la grille, y compris les éléments qui vont
  d'un bord de l'écran à l'autre. Le bandeau la recalcule
  (`06-bandeau-etat.css`) parce qu'il n'a pas de conteneur centré.
- **Presque aucun mouvement** : 150 ms sur les états interactifs, rien d'autre.

#### Ce qu'une direction sans ornement demande en échange

Retirer les ombres, les rayons, les dégradés et les couleurs, c'est retirer la
plus grande partie des moyens habituels de faire une hiérarchie. **Ce qui reste
doit alors être poussé plus loin qu'ailleurs**, sans quoi la page ne se lit plus
comme épurée mais comme inachevée — le reproche exact qui a motivé la reprise
de la mise en page.

Trois réglages en dépendent, et il faut les trois :

- **L'écart de tailles.** Le display monte à 72 px, les titres de section à
  42 px. À 56 et 36, la page n'avait plus aucun contraste de taille pour
  remplacer ceux qu'on lui a retirés.
- **Les gris se voient.** L'acier est passé de 4,55:1 à **5,95:1**. Un site qui
  emploie du texte secondaire partout se lit délavé quand ce gris est au
  minimum syndical.
- **Les filets se voient.** De 1,5:1 à **2,1:1** sur les deux fonds. Toute la
  structure du site tient à des traits de 1 px ; un trait invisible ne
  structure rien.

L'aplat sombre porte la même logique : le bandeau, l'en-tête, l'accueil et la
photo forment **un seul noir continu** sur tout le premier écran. C'est ce qui
donne au site une devanture au lieu d'un document.

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

### Le tunnel doit se comprendre sans qu'on l'explique

Le tunnel était juste et illisible : quatre étapes dont le seul repère était un
« 02 / 04 » de 13 px posé dans le rail, un calendrier de trente chiffres dont on
ne savait pas lesquels étaient cliquables, aucune heure à l'écran tant qu'on
n'avait pas deviné qu'il fallait cliquer un jour, et une étape 3 sans porte de
sortie. Cinq réglages l'ont corrigé, et ils forment un tout :

- **La frise des quatre étapes est visible.** Quatre cellules de texte, un filet
  au-dessus, la couleur pour marquer l'étape en cours. Ce n'est pas la barre de
  progression que la charte refuse — aucune forme dessinée, rien qui s'anime.
- **Le premier jour libre s'ouvre tout seul.** L'étape s'affiche avec des heures
  dedans : le cas le plus fréquent, « le plus tôt possible », est déjà fait.
- **Les créneaux sont rangés par demi-journée.** Trente-trois heures d'affilée
  forment un mur ; deux listes courtes se lisent.
- **Un jour disponible porte un encadré**, au repos. La différence entre libre
  et fermé ne peut pas tenir à une nuance de gris.
- **On peut revenir de partout**, en toutes lettres : « Changer de prestation »,
  « Changer de créneau ».

Et depuis la section Équipe, **« Réserver avec X »** ouvre le tunnel avec la
personne déjà retenue — elle est mise de côté puis appliquée quand la prestation
est connue, puisque c'est elle qui détermine qui peut la faire.

### Les indicateurs de confiance

Une bande de quatre faits, sur le même noir que l'accueil, entre la photo et les
repères pratiques. **Des faits, jamais un adjectif** : « réservation 24 h/24 »
se vérifie, « service d'exception » est la phrase que tout le monde écrit.

Trois disent ce que le site fait — pas d'acompte, pas de compte à créer,
réservation à toute heure : c'est aussi ce qui distingue un rendez-vous pris ici
d'un rendez-vous pris sur une plateforme.

⚠️ **La note Google est le quatrième, et il part masqué.** `reviews` vaut zéro
dans `defaults.js`, délibérément : ce commerce n'existe pas, il n'a pas de fiche
Google, et un chiffre inventé affiché en grand est un chiffre faux. La case
apparaît dès qu'une note est saisie, ainsi que son rappel en tête de la section
« Avis » et le lien « Lire les avis sur Google » (celui-ci suit
`salon.links.google`, vide lui aussi). **Sur la démonstration, ces deux champs
sont donc les deux lignes à remplir pour montrer la section complète.**

### Ce que la démonstration ne peut pas enregistrer

⚠️ **L'enregistrement fonctionne. C'est l'hébergement de la démonstration qui
est jetable.** L'offre gratuite de Render n'a pas de disque persistant : la
base vit dans le conteneur, l'instance s'endort après quinze minutes sans
visite, et repart d'une base neuve reconstruite depuis `defaults.js`. Un
prospect qui change un tarif, revient le lendemain et le retrouve à sa valeur
d'origine en conclut que le produit ne sait pas enregistrer.

**Studio Cassandre a exactement la même limite, et l'a réglée en la disant** :
un bandeau en tête de l'espace invite à tout modifier sans crainte et porte un
bouton « Remettre à zéro maintenant » (`POST /api/admin/demo/reset`). C'est
repris ici. La limite devient un argument — « touchez à tout, rien n'est
cassable » — et le bouton sert avant un rendez-vous, pour repartir d'une
vitrine propre sans attendre la remise à zéro de 4 h.

Le bandeau suit `CONFIG.demo` : chez un vrai client il n'existe pas, et la base
vit sur un disque. **Pour que la démonstration retienne vraiment ce qu'on y
saisit**, il faut un disque, donc un plan payant :

```yaml
    disk:
      name: donnees
      mountPath: /app/data
      sizeGB: 1
```

### L'espace commerçant

**L'agenda est une liste, plus une grille.** Il dessinait une case cliquable
toutes les demi-heures, de l'ouverture à la fermeture, par personne : un samedi
de 8h30 à 17h faisait cinquante et une cases pour trois rendez-vous. On ouvrait
son agenda et on voyait du vide quadrillé. Il montre maintenant les rendez-vous
du jour, dans l'ordre, dans la même forme que la liste tarifaire de la vitrine.
La vue semaine est sept fois cette journée, en deux colonnes à partir de
900 px — pas un second dessin à maintenir. « Noter un rendez-vous » est passé
du clic dans une case vide à un bouton en tête, qui ouvre le même formulaire.

⚠️ **L'ossature de l'espace n'avait aucun style.** Ni la barre, ni les onglets,
ni le conteneur du contenu : le balisage portait des classes que personne
n'avait écrites, et tout s'affichait en HTML nu. C'est la moitié de ce qu'on
vend. Elle est aujourd'hui dans `14-connexion.css`, sur le même aplat encre que
l'en-tête de la vitrine — le commerçant passe de l'un à l'autre, les deux
doivent se ressembler.

**Les têtes de ligne des réglages portent l'identité, pas le rang.** Elles
disaient « Rayon 3 », « Prestation 9 » : il fallait lire le champ du dessous
pour savoir de quoi on parlait, treize fois de suite. Elles portent maintenant
le numéro d'ordre en chasse fixe, le nom réel, et la valeur qu'on vient
vérifier — durée et tarif, rôle, nombre de prestations.

**La suppression a pris un mot.** C'était une croix de 36 px entre deux flèches
qui lui ressemblaient : la cible la plus petite du formulaire était aussi la
seule irréversible.

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

**`overflow-x: hidden` décolle tout ce qui est `sticky`.** Le garde-fou contre
le défilement horizontal était posé en `hidden` sur `<html>` et `<body>` : c'est
ce qui empêchait le bandeau d'état de suivre le défilement, pendant des mois,
sans le moindre signe dans le code du bandeau lui-même. `hidden` fait de
l'élément une **boîte de défilement**, et `position: sticky` se cale alors sur
elle — une boîte qui ne défile jamais, puisque c'est la page qui défile.
La règle est aujourd'hui `html { overflow-x: clip }` : `clip` coupe le
débordement **sans** créer de boîte de défilement. Ne jamais revenir à `hidden`,
et ne pas la poser sur `<body>` — de là, la valeur remonte à la fenêtre et
emporte le défilement vertical avec elle.

**Une section claire après une section sombre gardait zéro espace en haut.** La
règle qui fusionne deux aplats identiques ne regardait que la *seconde* section
(`.bloc + .bloc:not(.sombre)`). Résultat : « 04 · Galerie » commençait au pixel
exact où finissait le noir de l'équipe. Les deux sections sont testées
maintenant (`04-grille-et-rail.css`) — en ajouter une troisième variante de fond
demande de reprendre les trois sélecteurs ensemble.

**Ne jamais recadrer une photo plus serré que sa source.** La photo d'accueil
livrée fait 1200 × 675, soit 16:9. Elle avait été affichée en bande 3:1 : il
n'en restait que 59 % de la hauteur, la tête du client était coupée, et le tout
posé sur un aplat noir sous un bloc noir — « on ne voit rien ». Elle est
aujourd'hui **à côté du titre** à partir de 1000 px, où elle prend la hauteur de
la colonne de texte, et en 4:3 puis 3:2 en dessous. On recoupe la largeur,
jamais le sujet. Sa luminosité est remontée de 12 % (`08-accueil.css`) : un noir
et blanc posé sur du noir doit être plus clair que sur fond clair.

**`start`, dans les créneaux, est un nombre de MINUTES depuis minuit.** 510 vaut
8h30, 990 vaut 16h30. Ce n'est pas un horodatage : le passer à `new Date()`
renvoie le 1er janvier 1970 à 1h pour toutes les valeurs. Le groupement
matin/après-midi est tombé dans le piège, et les trente-trois créneaux d'un
samedi se sont retrouvés dans « Matin » — une erreur invisible à la lecture du
code, visible seulement dans le résultat.

**L'en-tête se colle en haut, mais seulement à partir de 1000 px.** Il ne se
collait pas du tout, et le motif était juste : deux bandes fixes mangent un
quart d'un écran de téléphone. Ce motif ne vaut que sur téléphone — sur un
écran d'ordinateur, 48 + 64 px sur 900 de haut, c'est un huitième, et sans lui
le sommaire disparaît dès le premier défilement d'une page qui fait huit écrans.
Sa hauteur est le jeton `--h-entete` (0 en dessous de 1000 px) parce que le
décalage des ancres, `scroll-padding-top`, en est la somme avec `--h-bandeau`.
Changer l'un sans l'autre remet les titres de section sous la barre.

## Vérifier

```bash
npm test
```

401 tests. Le serveur doit tourner (`npm run dev`) et **`DEMO_MODE` doit être
absent** du `.env`.

État au moment de la livraison — Lighthouse mobile : performance 99,
accessibilité 100, bonnes pratiques 100, SEO 100. LCP 2,0 s en 4G lente simulée,
CLS 0, 153 Ko transférés.

⚠️ **Ces chiffres datent d'avant la reprise de la mise en page** et n'ont pas
été refaits depuis. Rien n'a été ajouté au poids de la page — aucune requête,
aucune police, aucun script — mais la photo d'accueil est passée sous le premier
écran, ce qui peut en faire le nouvel élément de LCP. **Relancer Lighthouse
avant de montrer le site à un prospect.**

Rendu vérifié après la reprise en 390, 768 et 1440 px : aucun défilement
horizontal, aucune cible tactile sous 24 px, aucune combinaison de couleurs
employée sous son seuil (audit automatique sur la vitrine et sur l'espace
commerçant, texte courant 4,5:1 et grand texte 3:1), bandeau et en-tête collés
en haut aux bonnes hauteurs, tunnel parcouru jusqu'aux créneaux.

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
