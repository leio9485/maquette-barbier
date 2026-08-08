# AUDIT — L'Établi, état des lieux avant reprise

Phase 0 de la mission. **Aucune ligne de code n'a été modifiée** pour produire ce
document, à une exception près, sans effet sur le produit :
`.claude/launch.json` a reçu une seconde configuration (`letabli-tests`, qui
lance `npm start` au lieu de `npm run dev`). Motif : `node --watch` redémarre le
serveur dès qu'un fichier de `data/` change — or la suite de tests écrit
`data/equipe-mise-de-cote.json` et la base — ce qui coupe la connexion en plein
milieu et fait échouer `npm test` par `ECONNRESET`. Sans un serveur sans
surveillance de fichiers, aucune référence n'était mesurable.

**Référence établie : 401 tests, 0 échec** (62 `api` + 181 `settings` + 31 `auth`
+ 36 `categories` + 91 `staff`).

Conditions de mesure : serveur local, `DEMO_MODE` absent du `.env`,
`PUBLIC_URL` vide, base `data/commerce.db` telle qu'elle était, navigateur
Chromium 1280 × 800.

---

## 1. La référence affichée à la fin de la réservation

**C'est une dérivation du `cancelToken`, calculée dans le navigateur, jamais
stockée, jamais indexée.**

Le calcul tient en une ligne — [07-tunnel.js:501](src/page/js/07-tunnel.js:501) :

```js
reference: (reponse.cancelToken || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase()
```

Le jeton reçu du serveur est en base64url. On lui retire les `-` et les `_`
(sans quoi une référence sur deux ressemblait à `-HHJBG`), on prend les six
premiers caractères, et **on les met en capitales**.

Vérifié en conditions réelles : une réservation a renvoyé le jeton
`fVLj8U31QZrmTVyuUrzVHawthFF_nK07TrIxPwdD2GU`, soit la référence affichée
`FVLJ8U`.

### Ce que la mise en capitales coûte

Elle est le point important, et il n'est pas anodin : **la référence n'est pas
inversible en jeton.** `FVLJ8U` peut provenir de `fVLj8U`, `FvLJ8u`,
`fvlj8u`… soit 2⁵ = 32 jetons distincts pour ces cinq lettres. Il est donc
impossible, en partant de la référence, de reconstruire le jeton d'annulation.
Le lot 1 ne pourra pas s'en dispenser : il faudra soit stocker la référence dans
sa propre colonne indexée, soit la recalculer sans le `toUpperCase()`.

### Entropie

L'alphabet source, après retrait des `-` et `_`, compte 62 caractères
équiprobables. Après capitalisation, l'alphabet visible en compte 36, **mais
non équiprobables** : une lettre a deux antécédents (`a` et `A`), un chiffre
un seul.

| | |
|---|---|
| P(une lettre donnée) | 2/62 = 1/31 |
| P(un chiffre donné) | 1/62 |
| Entropie par caractère | 5,115 bits |
| **Entropie de la référence (6 caractères)** | **30,7 bits** |
| Comparaison : 36⁶ uniforme | 31,0 bits |
| Espace de recherche effectif | ≈ 1,7 × 10⁹ |

30,7 bits, c'est **très insuffisant pour être un secret** : à dix essais par
seconde, un balayage complet demande cinq ans, mais un balayage partiel est
immédiat — avec mille rendez-vous en base, une tentative sur 1,7 million tombe
juste, soit un rendez-vous trouvé toutes les deux jours en tapant dix
références par seconde. **C'est ce qui rend le second facteur (les quatre
derniers chiffres du téléphone) obligatoire au lot 1**, et non un confort.

À l'inverse, 30,7 bits sont **largement suffisants pour être un identifiant** :
pour un barbier qui prend 3 000 rendez-vous par an et les garde deux ans, la
probabilité qu'une collision existe dans la base est de l'ordre de 10⁻⁵.
Elle mérite malgré tout une contrainte d'unicité en base, ne serait-ce que pour
que la panne soit une erreur d'écriture franche plutôt qu'une annulation
attribuée au mauvais client.

### Indexation

Aucune. La référence n'existe nulle part en base — elle n'est calculée que dans
le navigateur, sur l'écran de confirmation, et disparaît avec l'onglet. Le seul
index approchant est celui du `cancelToken` (`@unique` dans le schéma), mais il
porte sur le jeton entier, en respectant la casse.

---

## 2. Le `cancelToken` de 32 octets

**Oui, il est réellement engendré, réellement stocké, et transmis au client une
seule fois.**

- Engendré : `randomBytes(32).toString('base64url')` —
  [bookings.js:413](src/routes/bookings.js:413). 43 caractères, 256 bits.
- Stocké : colonne `Booking.cancelToken`, `String? @unique`, migration
  `20260803000000_cancel_token`.
- Transmis : oui, **uniquement dans la réponse au `POST /api/bookings`**, via
  `toApiBooking(cree, { avecJeton: true })` — [bookings.js:420](src/routes/bookings.js:420).
  Toutes les autres sorties (`GET /api/admin/bookings`, `POST /api/admin/bookings`,
  `PATCH`) l'omettent : le paramètre `avecJeton` vaut `false` par défaut.
- Les rendez-vous saisis par le commerçant (`source: 'phone'`) n'en reçoivent
  aucun.

**Et c'est là que se joue le mensonge du site.** Le jeton est correct, il est
transmis, il fonctionne — mais il ne survit qu'en mémoire vive, dans la variable
`RESERVATION.confirmee` du JavaScript de la page. Fermer l'onglet le perd
définitivement. Le seul reste durable est une référence de six caractères que
rien ne sait relire.

---

## 3. La route d'annulation, et la limitation de débit

### `DELETE /api/bookings/:id?token=…`

**Elle existe et elle fonctionne** — [bookings.js:440](src/routes/bookings.js:440).
Vérifié en conditions réelles :

```
POST   /api/bookings          → 201, id + cancelToken
DELETE /api/bookings/:id?token=faux → 404 {"error":"Ce rendez-vous est introuvable."}
DELETE /api/bookings/:id?token=<vrai> → 200 {"ok":true,...}
```

Ses garde-fous sont corrects : comparaison à durée constante (`timingSafeEqual`),
réponse identique pour « rendez-vous inconnu » et « jeton faux » (pas d'oracle),
refus des rendez-vous saisis par le salon, refus des rendez-vous passés.

Elle exige **le jeton complet**, pas la référence. Il n'y a donc aujourd'hui
strictement aucun chemin, depuis un onglet fermé, pour l'atteindre.

### Limitation de débit

**Une seule route du serveur est protégée : `POST /api/login`.**

`src/lib/rateLimit.js` est un compteur en mémoire, correct pour ce qu'il fait.
Il n'est importé que par [auth.js:35](src/routes/auth.js:35), avec deux clés et
deux seuils :

| Clé | Seuil | Fenêtre |
|---|---|---|
| par compte (`identifiant`) | 10 échecs | 15 min glissantes |
| par adresse IP | 50 échecs | 15 min glissantes |

**Aucune autre route publique n'est limitée.** En particulier :

- `POST /api/bookings` — rien n'empêche de remplir l'agenda d'un barbier avec
  cinq cents faux rendez-vous en une minute. C'est le vrai trou de sécurité du
  site aujourd'hui, plus grave que l'annulation, et il n'est pas dans le
  cahier des charges. *(Voir le point 6 du RAPPORT final.)*
- `DELETE /api/bookings/:id` — pas limitée non plus. L'énumération y est
  aujourd'hui irréaliste (il faut deviner un cuid **et** un jeton de 256 bits),
  mais la route d'annulation par référence du lot 1 changera cet équilibre.
- `GET /api/slots`, `GET /api/days`, `GET /api/status` — non limitées ; elles ne
  révèlent rien de personnel, l'enjeu n'est que la charge.

Le compteur est en mémoire : il repart de zéro à chaque redémarrage du serveur.
Sur Render, où l'instance s'endort après quinze minutes, cela veut dire qu'il
repart de zéro plusieurs fois par jour. Acceptable pour la connexion (le seuil
protège d'un balayage rapide, pas d'un balayage patient), à surveiller pour la
route d'annulation du lot 1.

---

## 4. L'email de confirmation

**Aucun email n'est envoyé. Il n'existe aucune ligne de code d'envoi de courriel
dans tout le dépôt.**

Recherche exhaustive sur `src/` (hors `src/generated/`) des motifs `nodemailer`,
`smtp`, `sendmail`, `mailto`, `transport`, `sendMail` : **zéro occurrence**.
Les quatre dépendances du projet sont `@prisma/adapter-better-sqlite3`,
`@prisma/client`, `better-sqlite3`, `express` — aucune ne sait envoyer un
courriel.

### Le chemin complet, du POST à la réponse

1. `POST /api/bookings` — [bookings.js:345](src/routes/bookings.js:345)
2. Nettoyage des champs (`texte()`), bornage des longueurs. `email` est lu, borné
   à 160 caractères, **jamais validé** (pas de contrôle de forme côté serveur ;
   le navigateur applique `type="email"`, ce qu'un client hors navigateur ignore).
3. Validation de la date, de l'heure, du nom, du téléphone.
4. `loadService()` → prestation existante et active.
5. `resoudreEquipe()` → qui peut la prendre.
6. `isBookableStart()` → le créneau tient dans les horaires, respecte le délai.
7. **Transaction** : relecture des rendez-vous du jour, `attribuer()` choisit la
   personne, `tx.booking.create()` écrit la ligne avec `cancelToken`.
8. `res.status(201).json(toApiBooking(cree, { avecJeton: true }))`.

**Fin.** Rien entre l'étape 7 et l'étape 8. Le champ `customerEmail` est écrit en
base et n'est plus jamais relu par quoi que ce soit — ni par le serveur, ni par
l'espace commerçant, ni par un rappel.

Le client repart donc avec : une phrase à l'écran, une référence de six
caractères que rien ne sait relire, et aucune trace écrite. **Le libellé du
champ dit « Courriel (facultatif) » sans expliquer à quoi il sert — et il ne
sert effectivement à rien.**

---

## 5. Rendu serveur / rendu JavaScript — liste exhaustive

Méthode : `curl http://localhost:3000/` d'un côté, DOM après exécution du
JavaScript de l'autre, comparaison section par section.

La page servie fait **156 493 octets** (`Content-Length`, non compressée).

| Section | Dans le HTML servi | Peint par le JavaScript | Fonction |
|---|---|---|---|
| `<head>` — titre, description, og:*, JSON-LD, preload | **Oui** (zone `<!--@reglages-->`, `src/lib/page.js`) | Titre et description réécrits à l'identique | `hydrateStatic()` |
| Bandeau d'état | **Oui** (zone `<!--@bandeau-->`) | Rafraîchi | `06-bandeau-etat.js` |
| En-tête / menu | **Oui**, en dur | Non | — |
| 01 · Accueil — titre, texte, boutons | **Oui**, en dur | Non | — |
| 01 · Accueil — photo (`hero.jpg`) | `<img>` présent mais `hidden`, `src` absent, `alt=""` | **Oui** — pose `src`, retire `hidden` | `peindrePhotos()` |
| Bande de confiance — note Google | Squelette servi, chiffres vides | **Oui** | `peindreConfiance()` |
| 02 · Prestations — liste tarifaire | **Oui** (zone `<!--@prestations-->`, `src/lib/catalogue.js`) | Réécrite à l'identique | `peindrePrestations()` |
| **03 · Équipe** | **Non.** `<section id="equipe" hidden>`, `<ul id="equipeListe"></ul>` vide | **Oui**, y compris le retrait de `hidden` | `peindreEquipe()` |
| 04 · Galerie — structure et légendes | **Oui**, en dur | Non | — |
| 04 · Galerie — les 4 images | `<img alt="" hidden>` sans `src` | **Oui** | `peindrePhotos()` |
| 05 · Avis | **Oui** (zone `<!--@temoignages-->`, `src/lib/temoignages.js`) | Réécrits à l'identique | `peindreAvis()` |
| 05 · Avis — lien Google, note en tête | Squelette servi, vide | **Oui** | `peindreAvis()` |
| 06 · Tunnel — frise des 4 étapes, formulaire, libellés | **Oui**, en dur | Non | — |
| **06 · Tunnel — étape 1, les rayons dépliables** | **Non.** `<div id="tunnelRayons">` vide | **Oui** | `peindreChoixPrestation()` |
| **06 · Tunnel — étape 2, « avec qui ? »** | **Non.** `<div id="tunnelQuiChoix">` vide | **Oui** | `peindreQui()` |
| **06 · Tunnel — calendrier** | **Non.** `<div id="calendrierGrille"></div>` vide | **Oui**, après appel réseau | `07-tunnel.js` |
| **06 · Tunnel — créneaux** | **Non.** `<div id="creneauxGroupes"></div>` vide | **Oui**, après appel réseau | `07-tunnel.js` |
| 07 · Contact — adresse, téléphone | **Oui**, en dur (contenu de secours) | Réécrits depuis les réglages | `peindreChamps()` |
| **07 · Contact — horaires** | **Non.** `<div id="contactHoraires">` vide | **Oui** | `peindreHoraires()` |
| **07 · Contact — liens et plan** | **Non.** vides, plan en `hidden` | **Oui** | `peindreLiens()`, `peindrePlan()` |
| Pied de page, mentions légales | **Oui**, en dur | Non | — |
| Espace commerçant (`#vueEspace`) | **Oui**, en dur — *voir point 6* | Rempli après connexion | `08` à `10` |

### Ce que cela veut dire concrètement

L'audit externe avait raison sur les trois points qu'il cite : **Équipe, le
tunnel de réservation et le choix du barbier sont absents du HTML servi.**
S'y ajoutent, non relevés : les horaires d'ouverture, les liens sociaux, le plan
du quartier, et **toutes les images de la page** (elles n'ont pas de `src` avant
exécution du JavaScript — seul le `<link rel="preload">` du `<head>` annonce la
photo d'accueil).

Conséquences réelles :

- Un robot qui n'exécute pas de JavaScript ne voit **ni l'équipe, ni le
  tunnel, ni les horaires, ni une seule image**. Il voit en revanche les tarifs,
  les avis, le bandeau d'état et le JSON-LD, ce qui est l'essentiel du
  référencement — le mal est donc réel mais borné.
- Les aperçus de lien (SMS, WhatsApp, Messenger) ne lisent que le `<head>` :
  ils sont **corrects**, à condition que `PUBLIC_URL` soit posée (sinon ni
  `og:image` ni `canonical` — c'est le cas en local, pas sur Render).
- Le JSON-LD, lui, est produit côté serveur depuis les vraies données : il n'est
  pas concerné.

---

## 6. Le balisage de l'espace commerçant, servi à tout le monde

**Oui, intégralement, à chaque visiteur, y compris anonyme.** Il n'y a qu'un
seul document : `#vueSite` et `#vueEspace` cohabitent dans le `<body>`, et
`ouvrirEspace()` masque l'un pour montrer l'autre.

`GET /espace-salon` répond **404** (vérifié) : cette adresse n'existe pas. Le
seul chemin vers l'espace est le bouton « Espace commerçant » du pied de page
(`id="ouvrirEspace"`), **visible publiquement**.

### Poids du DOM, mesuré

`document.documentElement.outerHTML.length` après chargement complet :

| | octets | part |
|---|---:|---:|
| **DOM total** | **164 244** | 100 % |
| `<head>` | 47 786 | 29,1 % |
| ├─ `<style>` (17 fichiers recollés, minifiés) | 39 820 | 24,2 % |
| └─ JSON-LD | 6 105 | 3,7 % |
| `<body>` | 116 434 | 70,9 % |
| ├─ `#vueSite` (la vitrine entière) | 35 199 | 21,4 % |
| ├─ `#surimpressionLegal` | 3 479 | 2,1 % |
| ├─ **`#vueEspace` (balisage d'administration)** | **12 632** | **7,7 %** |
| └─ `<script>` (12 fichiers recollés, minifiés) | 65 047 | 39,6 % |

Nombre de nœuds : 828. Hauteur du document : 7 099 px.

*(L'audit externe annonçait ~175 Ko ; j'obtiens 164 Ko. L'écart tient
probablement à une base contenant des photos d'équipe plus lourdes, ou à une
mesure prise sur `document.body.innerHTML` plus l'en-tête. L'ordre de grandeur
est le même.)*

### La part attribuable à l'administration

Le balisage seul (12 632) ne dit pas tout : le style et le JavaScript de
l'espace pèsent bien plus lourd. Mesuré en passant chaque morceau par le
minifieur réel du projet (`src/lib/minify.js`) :

| Morceau | source | minifié |
|---|---:|---:|
| `styles/14-connexion.css` | 7 870 | 3 625 |
| `styles/15-agenda.css` | 5 887 | 2 877 |
| `styles/16-reglages.css` | 13 970 | 6 364 |
| `js/08-reglages.js` | 32 112 | 20 981 |
| `js/09-agenda.js` | 12 934 | 8 805 |
| `js/10-mon-compte.js` | 5 142 | 2 870 |
| **Sous-total style + script** | | **45 522** |
| Balisage `#vueEspace` | | 12 632 |
| **TOTAL administration** | | **58 154** |

**L'espace commerçant représente 35,4 % du poids du DOM servi à chaque
visiteur anonyme.**

Une vitrine purgée pèserait **≈ 106 090 octets, soit 103,6 Kio**. Le lot 4 vise
« moins de 100 Ko » : c'est atteignable, mais il faudra aller chercher les
quelques kilo-octets manquants ailleurs (`14-connexion.css` contient des règles
partagées avec la vitrine, le JSON-LD de 6 Ko est indenté à deux espaces par
`JSON.stringify(v, null, 2)`). **Je le signale maintenant plutôt que de le
découvrir à la fin.**

Il faut noter que ce poids-là n'est pas ce que le visiteur télécharge : la page
part compressée (`src/middleware/compression.js`). Le gain réel sur le réseau
sera plus proche de 12 à 15 Ko que de 58. Le gain sur le temps d'analyse du
JavaScript et sur la construction du DOM, lui, est entier — et c'est celui que
Lighthouse mesure.

---

## 7. Les captures d'écran blanches hors du premier écran

**Cause identifiée : `html { overflow-x: clip; }` —
[17-petits-ecrans.css:51](src/page/styles/17-petits-ecrans.css:51).**

### Ce que ce n'est pas

J'ai cherché chacun des suspects nommés dans la mission. Aucun n'est présent
dans le dépôt :

| Suspect | Occurrences dans `src/page/` |
|---|---|
| `content-visibility` | **0** |
| `contain` | **0** |
| `will-change` | **0** |
| `IntersectionObserver` | **0** |
| Apparition au défilement / `@keyframes` | **0** |
| `opacity: 0` | 1 seule — `.choix input`, un bouton radio masqué à l'œil et volontairement gardé accessible ([05-controles.css:173](src/page/styles/05-controles.css:173)) |
| `position: fixed` | 2, toutes deux dans `14-connexion.css` (espace commerçant) |
| `background-attachment` | **0** |

Il n'y a donc **aucune animation d'apparition au défilement dans ce projet**, et
rien qui conditionne l'affichage d'une section à un événement. Toutes les
sections sont peintes dès le premier rendu. Le point 5.7 de la mission, tel
qu'il est formulé (« ajoute un repli : les sections doivent être visibles par
défaut »), décrit un problème que le site n'a pas.

### Ce que c'est

`overflow-x: clip` sur `<html>` établit une **région de rognage** dont les
dimensions sont celles du bloc conteneur initial — c'est-à-dire de la fenêtre
d'affichage, telle qu'elle est au moment du rendu.

Un outil de capture pleine page (Puppeteer, Playwright, Lighthouse, les robots
de rendu) ne fait pas défiler la page. Il appelle
`Page.captureScreenshot` avec `captureBeyondViewport: true`, ce qui agrandit la
surface capturée **sans redimensionner la fenêtre d'affichage**. La région de
rognage, elle, reste calée sur les 800 pixels de haut d'origine. Tout ce qui est
en dessous est rogné, et sort **blanc** — la couleur de fond du `<body>`
(`--craie`).

C'est cohérent avec chacun des symptômes rapportés : le DOM est présent, le
texte est extractible, `scrollHeight` vaut bien 7 099 px, et pourtant l'image
est vide. Un contenu masqué par du JavaScript aurait, lui, disparu du DOM ou
porté un `hidden`.

C'est aussi la deuxième fois que cette ligne fait des dégâts. Le commentaire qui
la surplombe raconte la première : en `hidden`, elle décollait le bandeau d'état
pendant des mois. `clip` a réglé ce symptôme-là et en a introduit un autre, plus
discret, parce qu'il ne se voit pas depuis un navigateur qu'on pilote à la main.

### Impact, par usage

| Usage | Touché ? | Détail |
|---|---|---|
| **Visiteur, navigateur ordinaire** | **Non** | Il fait défiler ; la région de rognage suit. Le site est parfaitement normal à l'écran. C'est ce qui a permis au défaut de passer inaperçu. |
| **Aperçus de lien (SMS, WhatsApp, Messenger)** | **Non** | Ils lisent `og:image`, qui pointe la photo d'accueil — un fichier JPEG servi directement, pas une capture de la page. En revanche `og:image` est **absent** tant que `PUBLIC_URL` n'est pas posée (voir point 5). |
| **Lighthouse** | **Oui** | La bande de film (« filmstrip ») et l'aperçu final sortent blancs. Les métriques chiffrées (LCP, CLS) sont mesurées sur le rendu réel et restent justes ; c'est l'illustration du rapport qui ment. Effet secondaire à vérifier : le calcul du LCP retient le plus grand élément **peint dans la fenêtre**, et le rognage n'y change rien puisque la fenêtre est la même. |
| **Robots d'indexation qui font du rendu** | **Partiellement** | Googlebot construit son index depuis le DOM et le CSSOM, pas depuis une image : l'indexation n'est pas menacée. Le rendu visuel qu'il conserve pour ses propres contrôles (« Inspection de l'URL » dans la Search Console) sera blanc, ce qui est le genre de détail qui fait douter au mauvais moment. |
| **Captures pour un argumentaire commercial** | **Oui** | Impossible de produire une capture pleine page du site à montrer à un prospect. C'est, en pratique, l'impact le plus coûteux. |

### Correction envisagée (lot 5.7)

`overflow-x: clip` répond à un vrai besoin (le garde-fou contre le défilement
horizontal) et ne peut pas revenir à `hidden` (le bandeau se décollerait).
Trois pistes, à trancher au moment du lot :

1. **`overflow-clip-margin`** sur `<html>`, pour élargir la région de rognage.
   Simple, mais l'axe vertical n'est pas séparable de l'horizontal.
2. **Déplacer le garde-fou** de `<html>` vers un conteneur qui n'est pas la
   racine — le bandeau reprend alors la fenêtre comme référence de toute façon,
   puisqu'il ne serait plus dans une boîte rognée.
3. **Le retirer purement et simplement** et vérifier à 390 px qu'aucun
   débordement horizontal ne subsiste. Le commentaire du fichier dit lui-même
   que ce n'est que « la ceinture », la bretelle étant que rien n'a de largeur
   fixe. C'est la piste que je privilégie : elle supprime le problème au lieu de
   le contourner, et elle est vérifiable par un test.

---

## Constats annexes, relevés en passant

Aucun ne fait partie des sept questions, tous concernent des lots à venir.

**`sitemap.xml` : la route existe déjà.** [server.js:225](src/server.js:225).
Elle renvoie 404 pour une raison de configuration, pas d'absence de code :
`SITEMAP_SERVI = Boolean(PUBLIC_URL) && !DEMO_MODE`. En local, `PUBLIC_URL` est
vide ; sur la démonstration, `DEMO_MODE=true`. Les deux conditions sont
délibérées et documentées. Le lot 5.3 est donc plus mince qu'annoncé —
il reste à y ajouter `/annuler` (lot 1) et à décider du sort des ancres.

**`X-Robots-Tag` est bien piloté par `DEMO_MODE` seul.** [server.js:70](src/server.js:70).
Vérifié : en local sans `DEMO_MODE`, l'en-tête est absent des réponses. Le point
5.6 se réduit donc à documenter la manœuvre.

**`robots.txt` répond 200** avec `User-agent: * / Allow: /`.

**Deux `<h1>`, confirmé** : « Coupe, barbe et rasage à Bavay » (accueil) et
« L'Établi » (le logo de l'en-tête).

**Cinq `<img>` sur six ont `alt=""`, confirmé.** Seul le plan du quartier porte
`alt="Plan du quartier"`. **Zéro `<figure>`, zéro `<figcaption>`** dans tout le
document.

**Le JSON-LD est bien typé `HairSalon`**, [page.js:215](src/lib/page.js:215).
Il contient déjà `hasOfferCatalog` (avec les rayons imbriqués), `url`, `sameAs`,
`image`, `openingHoursSpecification`, et **pas** d'`aggregateRating` — ce dernier
point pour la raison exacte que donne la mission, argumentée en commentaire dans
le fichier. Manquent : le type `BarberShop`, `potentialAction`, `geo`, et
`estimatedDuration` sur les offres.

**Le lien Google par défaut est bien une recherche Maps par adresse**, écrite
dans `src/lib/defaults.js`.

**`POST /api/bookings` n'est pas limité en débit.** Je le répète ici parce que
ce n'est demandé nulle part dans les six lots et que c'est, à mon avis, plus
urgent qu'une bonne moitié de ce qui l'est : en l'état, n'importe qui peut
saturer l'agenda d'un client en une minute avec une boucle de dix lignes.

---

## Ce que je propose de faire de la référence (lot 1)

Ce n'est pas une question de la phase 0, mais la réponse au point 1 décide de la
forme du lot 1, et il vaut mieux la trancher avant d'écrire une ligne.

La référence doit devenir **une vraie colonne**, `Booking.reference`, `String?
@unique`, indexée, écrite par le serveur à la création. Trois raisons :

1. Elle est aujourd'hui **non inversible** (la capitalisation) : aucune requête
   ne peut partir d'elle.
2. Elle est calculée dans le navigateur : deux implémentations divergeraient au
   premier changement, et l'email du lot 2 comme le SMS du lot 2.4 ont besoin de
   la même valeur, côté serveur.
3. SQLite compare les chaînes **en respectant la casse** par défaut. Sans
   colonne dédiée et sans normalisation à l'écriture, « fvlj8u » saisi par un
   client en minuscules ne trouverait rien.

Le tirage se fera indépendamment du jeton — alphabet sans ambiguïté
(pas de `O`/`0`, pas de `I`/`1`/`L`, on lit cette référence au téléphone), avec
vérification d'unicité et nouveau tirage en cas de collision. Le `cancelToken`
reste ce qu'il est : le secret du lien direct.

Les rendez-vous déjà en base n'auront pas de référence. C'est sans conséquence :
ils ne sont accessibles que par le jeton, comme aujourd'hui, et la démonstration
repart d'une base neuve à chaque réveil.

---

*Rien de ce document n'est supposé : chaque chiffre a été mesuré sur le serveur
qui tourne, chaque route a été appelée, chaque fichier cité a été lu.*
