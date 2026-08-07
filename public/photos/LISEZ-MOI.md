# Les photos livrées avec le site

Ces fichiers sont le **premier étage** du système de photos (voir
`src/lib/photos.js`) : ce qui s'affiche tant que le commerçant n'a rien déposé
depuis ses réglages. Une photo qu'il dépose, elle, va dans `data/photos/` et
passe devant.

| Fichier | Format | Emplacement |
|---|---|---|
| `hero.jpg` | 1200 × 675 (16:9) | l'accueil, pleine largeur |
| `galerie-1.jpg` | 700 × 933 (3:4) | la devanture |
| `galerie-2.jpg` | 700 × 933 | le poste |
| `galerie-3.jpg` | 700 × 933 | la coupe |
| `galerie-4.jpg` | 700 × 933 | le rasage |

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
| `galerie-1.jpg` | unsplash.com/photos/tdDPj4Jpwu4 |
| `galerie-2.jpg` | unsplash.com/photos/dU6eE_j2My8 |
| `galerie-3.jpg` | unsplash.com/photos/Q82AM6BWBPM |
| `galerie-4.jpg` | unsplash.com/photos/fE42nRlBcG8 |

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
