# Les photos livrées avec le site

Ces fichiers sont le **premier étage** du système de photos (voir
`src/lib/photos.js`) : ce qui s'affiche tant que le commerçant n'a rien déposé
depuis ses réglages. Une photo qu'il dépose, elle, va dans `data/photos/` et
passe devant.

| Fichier | Format | Emplacement |
|---|---|---|
| `hero.jpg` | 1200 × 675 (16:9) | l'accueil, pleine largeur |
| `galerie-1.jpg` | 700 × 933 (3:4) | le poste |
| `galerie-2.jpg` | 700 × 933 | la coupe |
| `galerie-3.jpg` | 700 × 933 | la barbe |

## Pourquoi trois et non quatre

Il y avait une `galerie-1.jpg` légendée « La devanture ». Elle montrait un
**intérieur** de grand salon américain : l'enseigne BARBERSHOP en lettres d'un
mètre, un panier de basket, des planches de skate, un panneau « SORRY WE'RE
CLOSED », une affiche Heineken. Deux défauts, chacun suffisant :

- la légende annonçait une devanture et l'image montrait un intérieur ;
- elle vendait le monde que la direction du site refuse explicitement — le
  monde de référence est l'atelier d'artisan, **pas** le barbershop
  (voir `CLAUDE.md`). Un prospect qui reconnaît ce cliché sur la démonstration
  y voit le site de tout le monde.

Aucune photo de remplacement n'était disponible dans le dépôt. La galerie en
montre donc trois, et la grille s'y adapte seule (`auto-fit`, voir
`src/page/styles/11-galerie.css`). **Trois photos justes valent mieux qu'une
quatrième qui vend un autre commerce.** Les trois restantes ont été vérifiées
une à une : aucun texte, aucune enseigne, aucun logo.

`plan.svg` et `plan.json` ne sont pas des photos : c'est le plan du quartier,
dessiné par le serveur pour l'adresse du commerce (voir `src/lib/plan.js`). Ils
sont livrés pour que le dépôt soit autonome — sans eux, le site n'aurait aucun
plan tant qu'OpenStreetMap n'aurait pas répondu au premier démarrage.

## Le cadrage, et pourquoi il est imposé

Les ratios ci-dessus sont ceux du CSS, et les images sont **recadrées**
(`object-fit: cover`), jamais étirées. C'est ce qui garantit qu'une photo
déposée plus tard par un vrai client, de n'importe quelle taille, ne casse pas
la mise en page.

**Le sujet doit être au centre.** La photo d'accueil est affichée en 4:5 sur un
téléphone et en 21:9 sur un grand écran — la même image, deux cadrages très
différents. Ce qui se trouve sur les bords disparaîtra sur l'un ou sur l'autre.

## Le noir et blanc est appliqué par le site

`filter: grayscale(1) contrast(1.08)`, posé en CSS. **Ne pas convertir les
fichiers avant de les déposer** : une photo couleur s'y conformera d'elle-même,
et c'est ce qui fait tenir ensemble des photos prises à des moments différents.
C'est aussi ce qui empêche une photo couleur déposée un jour de jurer avec le
reste de la page.

## Origine et licence

Photographies **Unsplash**, sous [licence Unsplash](https://unsplash.com/license) :
usage commercial autorisé, sans attribution obligatoire.

| Fichier | Photo |
|---|---|
| `hero.jpg` | unsplash.com/photos/tgPrIYnW3g4 |
| `galerie-1.jpg` | unsplash.com/photos/dU6eE_j2My8 |
| `galerie-2.jpg` | unsplash.com/photos/Q82AM6BWBPM |
| `galerie-3.jpg` | unsplash.com/photos/fE42nRlBcG8 |

(`unsplash.com/photos/tdDPj4Jpwu4` était l'ancienne `galerie-1.jpg`, retirée.)

⚠️ **Ce sont des photos de démonstration.** Chez un vrai client, elles doivent
être remplacées par les siennes — c'est même le premier geste à faire. Une photo
de banque d'images reconnaissable est ce qui trahit un site de commerce local
plus sûrement que tout le reste.

## Le poids compte

`hero.jpg` est l'élément le plus lourd du premier écran : c'est lui qui décide
du LCP (le moment où le visiteur voit quelque chose). À 62 Ko, la page entière
tient en 153 Ko et Lighthouse mesure 2,0 s en 4G lente simulée. Une photo de
250 Ko déposée à sa place ferait perdre une seconde — d'où la réduction faite
par le navigateur avant l'envoi (voir `reduireImage()` dans
`src/page/js/08-reglages.js`).

## Les variantes (lot C, point C2)

Chaque photo listée plus haut porte des fichiers supplémentaires, générés
**une seule fois, dans un navigateur** — ce dépôt n'a ni dépendance de
traitement d'image, ni étape de build (voir `src/lib/photos.js`) :

| Fichier | Contenu |
|---|---|
| `hero-400.jpg`, `hero-800.jpg` | le héros, en 400 et 800 px de large |
| `hero.webp`, `hero-400.webp`, `hero-800.webp` | le héros, en WebP, aux trois largeurs |
| `galerie-N-350.jpg` | la vignette, en 350 px de large |
| `galerie-N.webp`, `galerie-N-350.webp` | la vignette, en WebP, aux deux largeurs |

La page les propose via `srcset`/`sizes` (le héros) et `<picture>` avec un
`<source type="image/webp">` (les vignettes) : un téléphone de 390 px télécharge
une image d'environ 9 à 19 Ko au lieu du fichier plein format.

⚠️ **REGÉNÉRER APRÈS AVOIR REMPLACÉ UNE DE CES QUATRE PHOTOS.** La régénération
n'est PAS automatique pour les fichiers livrés (elle l'est pour une photo
déposée depuis les réglages — voir `produireVariantes()`,
`src/page/js/08-reglages.js`). Remplacer `hero.jpg` sans refaire
`hero-400.jpg`/`hero-800.jpg`/le WebP laisserait les variantes montrer
l'ANCIENNE photo : `deposerPhoto()` ne mélange jamais les deux, mais un
remplacement fait à la main, hors de l'écran des réglages, le peut. La méthode
la plus simple pour un client réel : déposer la photo depuis l'espace
commerçant plutôt que de remplacer le fichier sur le disque — le dépôt produit
les variantes tout seul.
