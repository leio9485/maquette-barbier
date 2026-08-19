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

⚠️ **Cette liste porte sur le traitement graphique — matières, couleurs,
typographies, vocabulaire — et non sur les sujets photographiés.** Les
photographies du lieu, de l'outil, du fauteuil, du geste ou du client sont des
documents du commerce réel : elles ne relèvent pas de cette interdiction et
n'ont pas à être écartées parce qu'un objet du cadre évoque un barbier. Le noir
et blanc du site les tient déjà à distance du cliché. Ce qui est proscrit, c'est
de **rejouer ces matières dans l'habillage** : un fond en fausses planches de
bois, une texture de cuir, une police tatouage.

La précision est écrite parce que la règle a été lue à l'envers **deux audits de
suite** : les vignettes « LE POSTE » (un fauteuil de barbier devant un lambris)
et « LA BARBE » (un avant-bras tatoué) ont été signalées comme des violations de
charte, et proposées au remplacement. Elles n'en sont pas, et **les
photographies actuelles sont conservées** — décision du propriétaire, août 2026.

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

**L'étape 1 est un rayon dépliable par ligne** (`<details>`/`<summary>`), avec
son contenu et son premier prix : « COUPE — 4 prestations · dès 13 € ». Elle a
eu trois formes. Le catalogue entier recopié, d'abord — c'est-à-dire la section
« Prestations » qu'on venait de faire défiler, si bien que rien ne disait qu'on
avait avancé. Une liste déroulante ensuite, plus courte mais qui cachait tout.
Le dépliant garde les deux : quatre lignes qui montrent l'offre, le détail à un
clic.

**L'ordre de l'étape 2 est le sujet de l'étape 2** : le jour, puis la personne,
puis l'heure. C'est le jour qui décide de la plupart des refus — un barbier
ferme le lundi, une personne ne travaille que trois jours. Demander « avec
qui ? » d'abord ferait choisir quelqu'un pour découvrir ensuite qu'il ne
travaille pas le jour voulu. Changer de personne redessine le calendrier **et**
recharge les créneaux : le résultat du choix est visible tout de suite.

⚠️ **Le calendrier montre le mois entier, jours fermés compris.** Une liste
déroulante des seuls jours ouverts a été essayée : plus courte, mais on ne
voyait plus le rythme du commerce, et « il est fermé le lundi » est une
information qu'on retient.

⚠️ **Il n'y a plus de « Réserver avec X » dans la section Équipe.** « Avec
qui ? » se pose une seule fois, dans le tunnel, après le jour. Poser la même
question à deux endroits laisse croire qu'il y a deux chemins différents.

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
« Noter un rendez-vous » est passé du clic dans une case vide à un bouton en
tête, qui ouvre le même formulaire.

**La vue semaine se lit en colonnes, une par personne, à partir de 900 px.**
Elle était sept listes chronologiques : pour arbitrer « qui est libre jeudi
après-midi ? », il fallait lire la journée entière et tenir de tête qui
apparaît et qui manque. En colonnes, la réponse est la colonne la plus courte.

⚠️ **Ce n'est pas le retour de la grille.** Une colonne ne contient que des
rendez-vous réels : aucune case à l'heure, aucun quadrillage, et une seule
ligne — « Libre » ou « Ne travaille pas » — quand il n'y a rien. Une journée
entièrement vide ne dessine aucune colonne du tout : sa tête dit déjà « Rien
de prévu », en une ligne au lieu de trois colonnes.

⚠️ **« Libre » et « Ne travaille pas » ne sont pas la même réponse.** Les
confondre ferait proposer quelqu'un qui ne vient pas ce jour-là — la faute
exacte que cette vue existe pour éviter. Les trois cas viennent du schéma :
commerce fermé, `hours` nul (elle suit le commerce), `hours[jour]` nul (son
jour de repos).

⚠️ **Ce qui n'appartient à personne passe au-dessus, pleine largeur** :
blocage du commerce entier, rendez-vous non attribué. Ils occupent *tout le
monde* ; les ranger dans une colonne les ferait passer pour l'affaire d'une
seule personne et laisserait croire les autres disponibles.

⚠️ **Le choix du dessin se fait en JavaScript, et il ne peut pas se faire en
CSS.** Les deux formes ne rangent pas les mêmes lignes dans le même ordre —
chronologique d'un côté, par personne de l'autre — et aucune règle de style ne
réordonne un contenu. `ECRAN_LARGE` (un `matchMedia`) est écouté dans
`09-agenda.js`, et `peindreAgenda()` pose `data-colonnes="personnes"` que la
feuille se contente d'appliquer. **Sans équipe enregistrée, rien ne change** :
la semaine reste sept journées en deux colonnes, comme avant.

⚠️ **Dans une colonne, le prénom sort de l'écran mais pas de la page.** Le
répéter sur chaque ligne vole la place du nom du client ; le retirer en
`display: none` le retirerait aussi aux lecteurs d'écran, et la personne ne
serait plus portée que par la **position** — la même faute que de la porter
par la seule couleur. Il passe donc en `.hors-ecran`. Le téléphone, lui, est
bien retiré : il est dans la fiche, à un clic, en lien `tel:`.

**Le prénom en tête de colonne suit le défilement, comme la date.** L'en-tête de
journée collait déjà ; les colonnes, non. Un samedi à trois personnes fait trois
colonnes de trente lignes : au deuxième écran on savait de nouveau quel jour,
plus de qui — et la colonne n'était plus portée que par sa **position**, le
défaut exact que le `.hors-ecran` ci-dessus répare pour les lecteurs d'écran et
laissait entier pour l'œil. Le nom se colle donc juste sous la date.
Son `top` est la somme de **deux mesures** : `--h-barre` (posé par
`js/espace/demarrage.js`) et `--h-tete-jour` (posé par `peindreAgenda()`, parce
qu'un nom de jour long et la police chargée en décident). Il passe **sous**
l'en-tête de journée dans la pile — 4 contre 5 — sinon la journée suivante
glisserait derrière les prénoms de la précédente au lieu de les pousser.

**>>> UN RENDEZ-VOUS PASSÉ EST VENU TANT QU'IL N'EST PAS MARQUÉ « absent ».
<<<** La règle vaut **partout où `presence` est lu**, et elle est écrite en tête
de `absences()` (`src/lib/statistiques.js`) : `null` et `'venu'` disent la même
chose, seul `'absent'` diffère. Ce qui vient d'une base plus ancienne et porte
encore `'venu'` continue donc de se lire sans migration.

L'agenda n'a plus qu'**un seul bouton**, « Pas venu ». C'étaient deux boutons,
donc quarante-deux clics par jour pour répéter ce qui arrive quarante fois sur
quarante-deux.

⚠️ **« Venu » ne peut plus être un bouton, et ce n'est pas une économie de
place.** Il serait enfoncé d'entrée, et le cliquer ne pourrait que ramener à
`null` — c'est-à-dire à « venu » de nouveau. Un bouton dont le clic ne change
rien de visible est pire qu'un bouton absent : on le presse deux fois, puis on
doute de tout l'écran. On peut toujours revenir en arrière, en relâchant
« Pas venu ».

⚠️ **Ce qui doit suivre la règle, et qui l'a suivie** : le taux d'absence
(ci-dessous), les deux exports CSV — sans quoi la colonne « État » serait vide
quarante fois sur quarante-deux et contredirait l'agenda —, la fiche d'une
ligne, qui écrit « Pointé : Venu » même quand l'état est implicite, et le
générateur de données de démonstration, qui ne pose plus que des absences.

⚠️ **Un rendez-vous à venir n'a pas d'état.** Ni dans la fiche, ni dans les
exports : écrire « Venu » sur demain serait faux.

⚠️ **« Venu » et « Pas venu » s'inversaient du mauvais côté** (corrigé avant que
« Venu » ne disparaisse, et la raison vaut pour le bouton restant). L'état coché
posait `background: var(--craie)` — la couleur de la page. Le bouton coché y
perdait son aplat *et* son filet, et devenait donc plus discret que celui qu'on
n'avait pas coché : on lisait l'exact contraire de ce qu'on venait de pointer, et
on en concluait que les deux cases restaient prises ensemble. Le pointage,
lui, était juste depuis le début — une seule valeur, jamais deux. **Un état
correct rendu à l'envers vaut un état faux.** C'est encre sur craie aujourd'hui,
et toujours aucune couleur d'état : ni vert, ni rouge.

⚠️ **On pointe un rendez-vous TERMINÉ, et « terminé » se compare en heures, pas
en dates.** Le filtre était `iso >= aujourdhui()`, vrai de toute la journée en
cours : celui de 9 h comme celui de 18 h. Un barbier ne pouvait donc pointer sa
matinée que le lendemain, alors que le pointage se fait dans la foulée, en
rendant la monnaie. `estTermine()` compare maintenant `start + duration` aux
minutes écoulées depuis minuit — **sur la fin du créneau, pas sur son début** :
à l'heure pile de l'arrivée, « pas venu » est un verdict prématuré.

Le seuil dépendant de l'heure, les boutons doivent apparaître **sans qu'on
recharge** — l'agenda du jour est l'écran qu'on laisse ouvert. Une minuterie est
posée sur la **prochaine fin de créneau** et se réarme à chaque peinte : une
horloge qui bat toutes les minutes ferait quatre cents repeintes inutiles par
jour pour les trente qui changent quelque chose. ⚠️ Elle **attend que le focus
ait quitté l'agenda** : `peindreAgenda()` remplace tout le contenu, et le focus
clavier retomberait sur le document — supportable après un clic qu'on vient de
faire, pas quand c'est une minuterie qui le décide.

**Un rendez-vous se DÉPLACE, il ne se supprime plus pour être re-noté.** La
fiche n'offrait que « Supprimer » : décaler quelqu'un d'une heure — l'opération
la plus fréquente d'un agenda de barbier — passait donc par une suppression
suivie d'une création, et le rendez-vous recréé recevait une **nouvelle
référence** et un **nouveau jeton**. La référence que le client avait notée ne
marchait plus sur `/annuler`, le bandeau « Votre rendez-vous » de son téléphone
pointait dans le vide, et la ligne repassait de `source: 'online'` à `'phone'`,
faussant la statistique de provenance. Il voyait son rendez-vous disparaître
pendant que le commerçant croyait l'avoir simplement décalé.

`PATCH /api/admin/bookings/:id` accepte aujourd'hui `date`, `start`, `serviceId`
et `staffId`, tous facultatifs — **c'est la clé qui vaut ordre, pas sa valeur** :
`{ staffId: null }` rend le rendez-vous à personne, `staffId` absent n'y touche
pas. `id`, `reference`, `cancelToken`, `source` et `createdAt` ne figurent pas
dans les champs écrits, et c'est tout l'intérêt de l'opération.

⚠️ **Deux contrôles de collision, et il faut les deux.** Une réattribution seule
ne regarde que ce qui est *déjà attribué à cette personne* — sinon deux
rendez-vous orphelins qui se chevauchent se bloquent l'un l'autre et aucun ne
peut plus être attribué, l'impasse même que la route existait pour réparer. Un
déplacement réel, lui, regarde tous les occupants du jour visé, **soi-même
exclu** : sans cette exclusion, un rendez-vous se voit comme son propre obstacle
et ne peut plus changer de seule prestation. `GET /api/admin/slots` prend
`exclude=<id>` pour la même raison, côté liste.

⚠️ **Le client n'est prévenu de rien, et l'écran le dit.** Tant que les canaux de
`notifications.js` sont éteints, le déplacement affiche « Pensez à prévenir
Damien Carpentier — 06 39 98 14 07 ». Le point d'appel de `notifierEnFond()` est
marqué dans la route ; l'allumer est un arbitrage commercial, pas une tâche de
développement.

⚠️ **L'ossature de l'espace n'avait aucun style.** Ni la barre, ni les onglets,
ni le conteneur du contenu : le balisage portait des classes que personne
n'avait écrites, et tout s'affichait en HTML nu. C'est la moitié de ce qu'on
vend. Elle est aujourd'hui dans `14-connexion.css`, sur le même aplat encre que
l'en-tête de la vitrine — le commerçant passe de l'un à l'autre, les deux
doivent se ressembler.

**Le sommaire des réglages dit où l'on est, et il est devenu un rail.** Il
savait emmener — huit raccourcis, ça marche — mais pas situer : on descendait
trois écrans dans les horaires, on relevait les yeux, et rien ne disait
« horaires ». Trois choses ont changé, et il faut les trois.

- **Le soulignement part.** Un lien bleu souligné est la forme que le site donne
  à ce qui **emmène ailleurs** ; le sommaire déplace à l'intérieur d'une page
  qu'on regarde déjà. Il reprend donc le vocabulaire des onglets de la barre du
  haut, mot pour mot : texte acier, filet de 3 px sur l'élément courant.
- **La section courante est marquée**, au défilement, par `aria-current` posé
  dans `js/08-reglages.js`. ⚠️ Le style teste `[aria-current="true"]` et non la
  seule présence de l'attribut — la faute déjà commise sur `.espace-onglet`.
- **À partir de 1080 px, la rangée se lève en rail à gauche.** Neuf mots de
  13 px sur toute la largeur n'exposent pas un plan, ils l'épellent ; debout,
  la liste **se lit** comme un plan. C'est aussi ce qui autorise l'élément
  courant à passer en plus gros et plus gras (Condensed 600, 18 px) : dans une
  colonne de largeur fixe il ne déplace rien, alors qu'une rangée qui passe à la
  ligne se recomposerait à chaque section franchie.

⚠️ **Le seuil du repérage se lit dans `scroll-padding-top`, il ne se recalcule
pas.** Il valait le bas de la barre du haut, seize pixels au-dessus de l'endroit
où un saut d'ancre dépose une section : cliquer « Équipe » ouvrait la section
**et laissait le rail sur « Prestations »**. Un plan qui contredit le clic qu'on
vient de faire est pire que pas de plan.

⚠️ **Le `scroll-margin-top` des blocs repart à zéro dans le rail.**
`--h-sommaire` est la hauteur mesurée du sommaire : 44 px couché, 400 px debout.
Le laisser en place ferait atterrir chaque ancre 400 px trop bas.

⚠️ **`.reglages-mise-en-page` et `.reglages-corps` existent pour la grille du
rail, pas par goût du `<div>`.** Faire du volet lui-même la grille ferait de la
barre de brouillon — son premier enfant — une cellule, et son
`position: sticky; bottom: 0` se calerait alors sur la hauteur de sa seule
rangée au lieu de celle du volet.

**Les têtes de ligne des réglages portent l'identité, pas le rang.** Elles
disaient « Rayon 3 », « Prestation 9 » : il fallait lire le champ du dessous
pour savoir de quoi on parlait, treize fois de suite. Elles portent maintenant
le numéro d'ordre en chasse fixe, le nom réel, et la valeur qu'on vient
vérifier — durée et tarif, rôle, nombre de prestations.

**La suppression a pris un mot.** C'était une croix de 36 px entre deux flèches
qui lui ressemblaient : la cible la plus petite du formulaire était aussi la
seule irréversible.

**Chacun entre avec son propre identifiant.** La base acceptait plusieurs comptes
depuis le premier jour, mais la seule façon d'en créer un était
`npm run admin:create`, en ligne de commande, sur le serveur — que le commerçant
n'a pas. D'où un mot de passe partagé écrit près de la caisse : personne ne sait
qui a supprimé quoi, couper l'accès de quelqu'un qui part oblige à déconnecter
tout le monde, et un ancien employé garde l'entrée du fichier client. La section
« Personnes autorisées » des Réglages crée et révoque les accès.

⚠️ **La révocation ne ferme que les sessions du compte visé** — c'est toute la
différence avec le changement de mot de passe, qui les ferme toutes,
délibérément. Deux garde-fous, et ils ne se recouvrent pas : ni le dernier
compte (l'espace ne se rouvrirait qu'en ligne de commande), ni le sien (se
révoquer soi-même est toujours un accident). La règle vit des deux côtés :
l'écran retire le bouton, le serveur refuse quand même. La gestion des comptes
est éteinte sur la démonstration, comme le changement de mot de passe.

⚠️ **`AdminUser.role` existe, vaut `""`, et aucun code ne la lit.** Tous les
accès peuvent tout faire, y compris changer les tarifs : un écran de permissions
n'a été demandé par personne. La colonne est là parce qu'une seconde migration
sur la base d'un client qui tourne coûte bien plus cher qu'une colonne vide. Un
test constate son inertie, pour que personne ne croie à une règle d'autorisation
qui n'existe pas.

### Le ton des textes

Phrases courtes, voix active, minuscules après la première lettre. On dit ce que
le bouton fait : « Réserver ce créneau », pas « Continuer ». Les messages
d'erreur disent ce qui s'est passé et quoi faire, sans s'excuser. Aucun adjectif
de vente.

## L'architecture

Le navigateur reçoit **un seul fichier par page**, sans framework et **sans étape
de construction**. Les morceaux vivent dans `src/page/` et le serveur les recolle
à chaque envoi. Le mode d'emploi complet est dans `src/page/LISEZ-MOI.md` — le
lire avant de toucher à la façade.

**Il y a trois documents, plus un seul.** La vitrine (`/`), l'espace commerçant
(`/espace-salon`) et la page d'annulation (`/annuler`). Ils ne partagent que des
morceaux, jamais un résultat.

```
src/
  server.js          les routes
  config.js          les réglages d'instance (une seule source)
  lib/
    etat.js          ← le bandeau d'état. Ajouté pour ce site.
    availability.js  toute la règle métier des créneaux
    annulation.js    ← le filtre « ce qui occupe encore l'agenda »
    reference.js     ← la référence courte d'un rendez-vous
    statistiques.js  ← les chiffres du tableau de bord
    notifications.js ← la porte de sortie unique (SMS écrit, éteint)
    catalogue.js     la liste tarifaire, écrite dans la page servie
    temoignages.js   la section « Avis », idem
    galerie.js       ← la galerie, idem
    plan.js          le plan du quartier, dessiné depuis l'adresse
    defaults.js      >>> LE FICHIER À ADAPTER POUR CHAQUE CLIENT <<<
  page/              la façade — voir src/page/LISEZ-MOI.md
```

## Ce qui a été ajouté après la première livraison

**L'annulation existe pour de vrai.** L'écran de confirmation promettait
« notez la référence : elle suffit à annuler », et c'était la seule phrase
fausse du site — le jeton ne survivait qu'en mémoire vive, et la référence
affichée était les six premiers caractères de ce jeton **mis en capitales**,
donc non inversible. Elle est maintenant une colonne indexée, tirée dans
l'alphabet de Crockford (ni I, ni L, ni O, ni U : elle se dicte au téléphone).
`/annuler` la reprend, avec les quatre derniers chiffres du téléphone comme
second facteur.

**Une annulation par le client ne supprime pas la ligne, elle la marque**
(`annuleLe`). Le créneau se libère, et le commerçant voit que quelqu'un s'est
décommandé. ⚠️ Toute requête qui sert à calculer une disponibilité doit porter
le filtre de `src/lib/annulation.js` : une ligne annulée est encore en base, et
l'oublier rendrait son créneau invendable pour toujours.

**Le volet « Chiffres »** (`src/lib/statistiques.js`). Le taux de remplissage se
compte **en minutes, pas en créneaux** — sinon il monterait quand le barbier
fait des prestations courtes. Le taux d'absence se calcule sur **tout ce qui est
passé**, depuis que « venu » est l'état par défaut (voir plus haut) : il portait
sur « ce qui a été pointé », et ce dénominateur se retourne dès qu'on ne coche
que les absences — il afficherait **100 %** à quelqu'un qui a eu deux lapins sur
quarante-deux rendez-vous.

**Les plafonds de réservation.** Rien n'empêchait de remplir l'agenda d'un
client avec une boucle de dix lignes — aucun acompte, aucun compte à créer,
c'est l'argument de vente central et c'est aussi la porte ouverte. Trois
plafonds par adresse : 5 réservations abouties en 3 minutes, 20 par heure,
60 tentatives par heure.

⚠️ **Ils ne s'appliquent pas à la machine elle-même hors production**, et ce
n'est pas un contournement : `npm test` envoie **quarante-trois demandes de
réservation en quinze secondes** depuis la même adresse — mesuré, pas estimé.
Aucune valeur ne laisse passer la suite tout en protégeant quoi que ce soit. En
production, l'exemption n'existe pour personne (`src/lib/rateLimit.js`), et le
site y tourne derrière un relais avec `trust proxy` : `req.ip` porte l'adresse
réelle du visiteur.

Ce qu'ils font : transformer une catastrophe en désagrément. Ce qu'ils ne font
pas : arrêter un adversaire disposant de plusieurs adresses — et la vraie parade
contre celui-là (vérification par SMS, acompte, CAPTCHA) est refusée par le
produit, délibérément.

**Le SMS est écrit, testé, et volontairement éteint.** Le code appelle vraiment
l'API de Twilio ; il ne s'allume que si quatre variables sont posées. Aucune
dépendance ajoutée — le paquet `twilio` tire cinquante modules pour ce qui tient
en une requête HTTP. Le plafond mensuel est **dur** et ne se dépasse jamais en
silence.

**L'espace commerçant est un document à part.** Il partait dans la même page que
la vitrine, chez chaque visiteur : 35 % du poids. ⚠️ Le piège qui va avec s'est
produit **trois fois** — du code de l'espace appelant une fonction de la vitrine
(`peindreVitrine`, `peindrePhotos`, `initiales`). C'est une `ReferenceError`
levée *après* l'écriture : les données partent, le message de confirmation est
avalé, et rien n'apparaît à l'écran. `tests/portees.mjs` interdit désormais la
classe entière.

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

**Un plafond qui compte les passages se referme sur son propre
commerçant.** `POST /api/admin/users` consommait un jeton à *chaque*
appel, réussi comme raté : enregistrer son équipe suffisait à se faire
refuser sa propre section. Le défaut ne se voit pas à la première
exécution de la suite mais **à la seconde**, lancée dans le quart
d'heure — c'est le même piège que les références d'annulation figées.
`POST /api/admin/login` montre la règle : `recordFailure` dans la seule
branche de refus, `resetFailures` au succès. Compter les échecs, jamais
les passages.

⚠️ **Un plafond atteint ne se lève pas depuis l'API** sur ces routes : le
contrôle précède l'action, donc même un appel légitime est refusé. Ne
jamais le déclencher volontairement dans un test — contrairement à
`/api/rendez-vous`, où un jeton juste rouvre la porte.

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

**Un `grid-row` sans `grid-column` fabrique une colonne.** Le chevron des
`<select>` est un `::after` posé dans la même cellule que le champ. Les règles de
`.champ:has(select)` fixaient une ligne sur chaque enfant **sans fixer de
colonne** : le `::after` demandait la ligne 2, où le `<select>` occupait déjà la
colonne 1, et la grille lui en fabriquait donc une seconde.
`grid-template-columns` calculé valait `568px 24px` au lieu de `592px` — le champ
rétrécissait d'exactement la largeur du chevron, qui se dessinait **hors du
cadre bordé**, à côté. Cela portait sur tous les `<select>` des trois documents,
et ne se voyait que là où un `input[type="date"]` juste en dessous donnait un
point de comparaison. Ne jamais poser `grid-row` seul dans ces règles.

**`flex: none` sur un texte qui peut s'allonger déborde de l'écran.**
`.reglages-ligne-appui` le portait : la règle convenait tant que l'appui tenait
en deux mots (« Barbier », « 4 prestations »), et la liste des accès en écrit de
bien plus longs. À 390 px, la ligne sortait de l'écran. `flex: 0 1 auto` **avec**
`min-width: 0` — sans ce dernier, la largeur minimale d'un élément flex reste
celle de son contenu et il déborde quand même.

⚠️ **Ce débordement ne se voit ni à l'œil ni sur une capture.** Dans le volet
d'aperçu, `window.innerWidth` est mis à l'échelle alors que
`getBoundingClientRect()` et `clientWidth` sont dans le repère CSS : les
comparer ne prouve rien. Mesurer avec `scrollWidth > clientWidth`, et confirmer
la largeur rendue avec `matchMedia('(max-width: 400px)')`.

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

**867 tests.** Le serveur doit tourner et **`DEMO_MODE` doit être absent** du
`.env`.

⚠️ **`npm run dev` ne convient pas pour lancer la suite.** `node --watch`
redémarre le serveur dès qu'un fichier de `data/` change — or la suite écrit la
base et `data/equipe-mise-de-cote.json`. La connexion est coupée en plein
milieu et `npm test` échoue sur un `ECONNRESET` qui n'a rien à voir avec le
code. Lancer `npm start`.

Dix-sept suites, dont neuf ajoutées après la première livraison :

| Suite | Ce qu'elle protège |
|---|---|
| `portees.mjs` | chaque document n'appelle que ce qu'il embarque, et traite la session expirée |
| `debit.mjs` | les plafonds de réservation, la règle d'exemption, `trust proxy` |
| `chiffres.mjs` | le tableau de bord, le pointage, l'export CSV |
| `espace.mjs` | la séparation vitrine / espace, au poids et à la chaîne près |
| `seo.mjs` | un seul `h1`, les `alt`, le JSON-LD, le rendu hors écran, les refus annoncés |
| `tunnel.mjs` | les quatre cas de collision, et jamais deux rendez-vous |
| `annulation.mjs` | annuler, déplacer, l'absence d'oracle, les deux compteurs |
| `demonstration.mjs` | la remise à zéro, et ce que le tableau de bord montre |
| `blocages.mjs` | poser, relire et **lever** une période bloquée |
| `deplacement.mjs` | déplacer sans recréer : la référence, le jeton et la provenance survivent |
| `comptes.mjs` | les accès multiples, les deux garde-fous, la révocation ciblée |
| `francais.mjs` | aucune chaîne visible écrite sans accents |

⚠️ **`demonstration.mjs` est la seule suite à lancer son propre serveur.** Ce
qu'elle vérifie n'existe qu'avec `DEMO_MODE=true`, variable qui ne doit jamais
figurer dans le `.env` d'une machine de développement. Elle démarre donc une
instance sur son propre port et **sa propre base**, et efface les deux en
partant — la variable d'environnement l'emporte sur le `.env`, vérifié.

⚠️ **Trois suites tirent une référence au hasard à chaque exécution**
(`annulation.mjs`, `debit.mjs`). Ce n'est pas de la coquetterie : depuis que les
échecs sont comptés **par référence** autant que par adresse, une référence
figée accumulait ses échecs d'une exécution à l'autre et bloquait le second
`npm test` lancé dans le quart d'heure.

Lighthouse mobile, refait le 19 août 2026 (13.4.1, en local,
`--only-categories=performance,accessibility,best-practices,seo`) :

| | vitrine | `/annuler` | `/espace-salon` |
|---|---:|---:|---:|
| Performance | **99** | 100 | 100 |
| Accessibilité | **100** | 100 | 100 |
| Bonnes pratiques | **100** | 100 | 96 |
| SEO | **100** | 63 | 54 |
| LCP | 2,1 s | 1,4 s | 1,5 s |
| CLS | **0** | 0 | 0 |

Les SEO bas de `/annuler` et `/espace-salon` sont voulus : ces pages portent
`noindex`, et Lighthouse le compte comme un défaut. Bonnes pratiques 96 sur
l'espace : le contrôle de session journalise un 401 quand personne n'est
connecté — la réponse correcte du serveur.

⚠️ **NE PAS CROIRE UNE MESURE ISOLÉE DE LA VITRINE.** Le premier passage a
donné **88**, avec un TBT de 460 ms ; les trois suivants, 97, 99 et 99, avec
un TBT de 160, 0 et 20 ms. LCP et CLS n'avaient pas bougé d'un pouce. Le TBT
mesure l'exécution du JavaScript, et il suffit qu'une autre tâche occupe la
machine — un serveur, une suite de tests, un autre Chrome — pour qu'il
quadruple. **Mesurer trois fois et retenir la médiane**, sinon on part
chasser une régression qui n'existe pas. C'est le même piège que la mesure
sur instance froide décrite dans `RAPPORT.md` § 7.

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
