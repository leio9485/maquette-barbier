# RAPPORT — L'Établi, de « très bonne démo » à produit vendable

Ce document rend compte du travail demandé. Il est écrit pour être relu lot par
lot, et il dit aussi ce qui n'a **pas** été fait.

**Référence de départ : 401 tests, 0 échec. Aujourd'hui : 589 tests, 0 échec.**

Ordre d'exécution, tel que vous l'avez demandé : audit (phase 0), lot 1, puis
l'infrastructure de notifications avec le SMS écrit mais éteint, puis les lots
3, 4, 5 et 6. **Le lot 2 (envoi d'email réel, rappel J-1) n'a pas été fait** —
c'est votre décision, rappelée au point 5.

---

## 1. Les réponses de la phase 0

L'audit complet est dans [AUDIT.md](AUDIT.md). Résumé, avec les corrections que
la suite a apportées.

**1. La référence `MQJYBK`** était une dérivation du `cancelToken` calculée dans
le navigateur : six premiers caractères alphanumériques, **mis en capitales**.
Cette capitalisation la rendait **non inversible** — « FVLJ8U » pouvait venir de
trente-deux jetons différents. Entropie 30,7 bits, non uniformes. Ni stockée, ni
indexée. → *Corrigée au lot 1 : colonne dédiée, indexée, tirée par le serveur.*

**2. Le `cancelToken` de 32 octets** était bien engendré, bien stocké, bien
`@unique`, transmis une seule fois. Il était correct ; il ne survivait qu'en
mémoire vive.

**3. `DELETE /api/bookings/:id?token=`** existait et fonctionnait (testé de bout
en bout). **Une seule route du serveur était limitée en débit : `POST
/api/login`.** → *Le lot 1 a ajouté un compteur strict sur les routes
d'annulation. `POST /api/bookings` reste non limité — voir le point 5.*

**4. Aucun email.** Zéro occurrence de `nodemailer`/`smtp`/`sendMail` dans le
dépôt. `customerEmail` était écrit en base et plus jamais relu.

**5. Rendu serveur vs JavaScript.** L'audit externe avait raison sur Équipe, le
tunnel et le choix du barbier. S'y ajoutaient, non relevés : les horaires, les
liens sociaux, le plan, et **toutes les images** (aucun `src` avant exécution du
JS). → *Le lot 5 a mis la galerie dans le HTML servi. L'équipe et le tunnel y
restent absents — voir le point 5.*

**6. L'espace commerçant** était servi à tous. Mesuré : **58 154 octets sur
164 244, soit 35,4 % du DOM**. → *Corrigé au lot 4.*

**7. Les captures blanches : `overflow-x: clip` sur `<html>`.** Le suspect
nommé par la mission — une animation d'apparition au défilement — **n'existe pas
dans ce projet** : zéro `content-visibility`, zéro `contain`, zéro
`IntersectionObserver`, zéro `@keyframes`. → *Corrigé au lot 5 par
`overflow-clip-margin: 100vh`.*

### Deux points où l'audit externe se trompait

- **`sitemap.xml` : la route existait déjà.** Le 404 venait de
  `Boolean(PUBLIC_URL) && !DEMO_MODE`, pas d'une absence de code.
- **Le point 5.7 décrivait un repli d'animation au défilement.** Ce site n'en a
  aucune. La correction était ailleurs.

---

## 2. Lot par lot

### Notifications — l'infrastructure, et le SMS écrit mais éteint

`src/lib/notifications.js`. Tout ce que le site enverra passe par `notifier()`.
Deux canaux, aucun actif.

| Canal | État |
|---|---|
| `email` | point d'insertion. Le message est journalisé `[EMAIL NON IMPLÉMENTÉ]`. |
| `sms` | **écrit et testé, éteint.** Appelle vraiment l'API de Twilio. |

**Le SMS fonctionne réellement** : lancé avec de faux identifiants, Twilio a
répondu `401 — Authentication Error`. Le chemin va donc jusqu'au bout. Il ne
s'allume que si `SMS_ACTIF=true` **et** que les trois identifiants sont posés —
quatre variables, ce qui ne se pose pas par accident.

**Aucune dépendance ajoutée.** Le paquet `twilio` tire une cinquantaine de
modules pour ce qui tient en une requête HTTP avec authentification Basic. Le
projet en compte toujours quatre.

**Le plafond mensuel est dur.** Le compteur (`NotificationCounter`) est
incrémenté **avant** l'envoi, dans une transaction : compter après coup
laisserait deux envois simultanés voir tous deux « il reste une unité ». Un
envoi qui échoue rend son unité. Les refus sont comptés à part — c'est cette
colonne qui dira au commerçant qu'il manque des rappels.

**Bogue attrapé en le testant :** `Number(x) || 200` ignorait
`SMS_PLAFOND_MOIS=0` — la façon la plus évidente de dire « aucun envoi »
laissait passer deux cents SMS.

*Fichiers : `src/lib/notifications.js`, `src/config.js`, `.env.example`,
migration `20260810000000_notifications`.*

### Lot 3 — L'espace commerçant devient un tableau de bord

**Onglet « Chiffres », en premier** — mais l'agenda reste le volet par défaut.
Les chiffres sont en tête parce que c'est ce qu'un prospect cherche ; l'agenda
s'ouvre parce que c'est ce qu'on regarde vingt fois par jour une fois client.

Trois décisions de calcul changent ce que les chiffres veulent dire :

- **Le remplissage se compte en minutes, pas en créneaux.** Les compter tous
  pour « un créneau » donnerait un taux qui *monte* quand le barbier fait des
  prestations courtes. Le dénominateur est le temps réellement ouvert, personne
  par personne, congés et journées bloquées déduits — sans quoi le taux
  s'effondrerait chaque mois d'août.
- **Le taux d'absence porte sur ce qui a été pointé**, pas sur ce qui est passé.
  Un commerçant qui ne coche rien doit lire qu'il n'a rien pointé, pas « 0 % ».
- **L'écart avec le mois précédent vaut « — » quand ce mois était vide.**
  « +100 % » depuis zéro ne veut rien dire ; « 0 % » serait un mensonge.

**Suivi des no-shows** : deux boutons sur les rendez-vous passés, marqueur
discret à partir de deux absences, côté commerçant seulement. **Aucune
conséquence automatique** — rien n'est bloqué, aucun acompte, rien de visible
depuis la vitrine. Retour en arrière d'un clic : le cas le plus fréquent d'un
pointage est le clic à côté.

**Export CSV**, deux fichiers. **UTF-8 avec BOM et séparateur point-virgule** :
sans les deux, Excel français affiche « RÃ©mi » et met tout dans une colonne. Le
test vérifie le BOM **sur les octets** — `Response.text()` le retire en
décodant, un test écrit sur la chaîne passerait au vert sans lui.

**Le lien Google devient deux réglages**, et l'aide explique la différence : la
fiche, qu'on *lit*, et l'adresse qui *ouvre* la fenêtre d'avis.

*Fichiers : `src/lib/statistiques.js`, `src/routes/tableaudebord.js`,
`src/page/js/10-chiffres.js`, `src/page/styles/17-chiffres.css`,
`tests/chiffres.mjs`, migration `20260810120000_chiffres_et_presence`.*

### Lot 4 — L'espace commerçant sort de la vitrine

| | avant | après |
|---|---:|---:|
| DOM de la vitrine | 164 244 | **120 156** octets (−26,8 %) |
| page servie | 156 493 | **112 500** octets (−28,1 %) |
| `/espace-salon` | — | 94 498 |
| `/annuler` | — | 30 441 |

Trois blocs de style servaient aux deux vues et vivaient dans une feuille propre
à l'une d'elles ; ils sont remontés dans `05-controles.css`. `afficherMessage()`
quitte le tunnel pour les utilitaires. Chaque état reste chez lui : `RESERVATION`
dans le tunnel, `ESPACE` dans `js/espace/etat.js`, **l'API d'administration dans
`js/espace/donnees.js`** — la vitrine publiait la liste complète des adresses
`/api/admin/…`.

**L'entrée publique disparaît hors démonstration, et elle est retirée du
document, pas masquée** : un lien caché reste dans la source.

`robots.txt` écarte `/espace-salon` et `/annuler` ; les deux portent en plus
`X-Robots-Tag: noindex`, **sans dépendre de `DEMO_MODE`**. `Disallow` interdit de
lire, ce qui n'empêche pas l'adresse de figurer dans les résultats sans
description : les deux sont complémentaires. Et `noindex` n'est pas un contrôle
d'accès — ce qui protège l'agenda reste `requireAdmin`.

*Fichiers : `src/page/espace.html`, `src/page/js/espace/*`,
`src/lib/assemblage.js`, `src/lib/page.js`, `src/server.js`, `tests/espace.mjs`.*

### Lot 5 — SEO, accessibilité, données structurées

**Un seul `<h1>`** — le second était l'écran de connexion, parti au lot 4. Un
test l'interdit désormais pour les trois documents.

**Les images.** Cinq sur six portaient `alt=""`. Chacune a sa description, et la
galerie passe en `<figure>` + `<figcaption>`. **La description décrit l'image,
elle ne répète pas la légende** — un test compare les deux et refuse qu'elles
coïncident. Le commerçant écrit les siennes depuis les réglages ; une
description vidée **retombe** sur celle livrée, contrairement à une légende
(`alt=""` a un sens précis en HTML).

**Le type de commerce devient un réglage** — liste fermée de six valeurs.
C'est ce qui rend la base réutilisable pour une onglerie ou un institut sans
qu'une ligne de code change.

**Le JSON-LD** gagne `estimatedDuration` (prise de la prestation, jamais écrite
en dur), `provider`, `availability`, `geo`, `ReserveAction`. Toujours **ni
`aggregateRating` ni `review`**.

**Le plan du site n'annonce que la vitrine** : inscrire des pages en `noindex`
remonte en avertissement dans la Search Console.

**Trois bogues du lot 4, trouvés ici.** `peindreVitrine()`, `peindrePhotos()` et
`initiales()` étaient appelés depuis l'espace, qui ne les embarque plus. Le
troisième cassait **la moitié du formulaire des réglages** — prestations, équipe,
avis et photos ne se dessinaient plus. D'où `tests/portees.mjs`.

⚠️ **Ce test n'a pas fonctionné du premier coup, ni du second.** Sa première
version effaçait les gabarits en entier — or presque tout le HTML de ce projet y
est construit. La seconde avait un motif qui **consommait** le caractère
précédent, si bien qu'un appel imbriqué comme `esc(initiales(p.name))` restait
invisible. Vérifié en réintroduisant le bogue : il échoue maintenant, sur les
deux documents.

*Fichiers : `src/lib/photos.js`, `src/lib/page.js`, `src/lib/settings.js`,
`src/page/parties/galerie.html`, `src/page/styles/03-fondations.css`,
`tests/seo.mjs`, `tests/portees.mjs`, migration `20260810180000_seo`.*

### Lot 6 — Finition

**La galerie accepte douze photos**, en grille `auto-fill` : trois photos font
trois colonnes, douze en font quatre sur trois rangées. Seules les cases qui
portent vraiment une photo sont écrites. Les réglages proposent les cases
remplies **plus une**.

**Mode avant/après** : deux photos dans la même case, sous une seule légende.
Pas de comparateur à poignée — cent lignes de code, inutilisable au clavier, et
deux photos côte à côte disent la même chose.

**La galerie est écrite par le serveur.** Ses images n'avaient aucun `src` dans
le HTML servi.

⚠️ **Un bogue trouvé à l'écran, pas par un test.** La `<section>` et le `<ul>`
portaient **tous deux `id="galerie"`**. Le jour où `peindreGalerie()` a fait
`$('#galerie')`, il a récupéré la section et remplacé son contenu : le titre
« L'atelier » a disparu de la page.

**Les avis portent leur date, côté réglages seulement.** Sur la vitrine, « avis
de 2021 » dit « plus personne n'écrit de bien d'ici » ; dans les réglages, la
même date dit « il serait temps d'en recopier ».

**Le tunnel mis à l'épreuve** (`tests/tunnel.mjs`) sur les quatre cas. ⚠️ **Le
test de collision était faux avant d'être juste** : il criait au double
rendez-vous sur deux 201 légitimes — le commerce a trois barbiers, deux
réservations à la même heure y sont normales. Il vise maintenant la **même
personne**.

*Fichiers : `src/lib/galerie.js`, `src/page/styles/11-galerie.css`,
`src/page/js/04-contenu-statique.js`, `tests/tunnel.mjs`, `CLAUDE.md`,
`src/page/LISEZ-MOI.md`.*

---

## 3. Les critères d'acceptation

### Lot 1 — l'annulation

- [x] Je réserve, je ferme l'onglet, je reviens : j'annule avec référence + téléphone
- [x] Une référence valide avec un mauvais téléphone ne révèle rien
- [x] 6 tentatives d'affilée depuis la même IP sont bloquées
- [x] Le créneau libéré réapparaît immédiatement dans le calendrier public
- [x] Le déplacement ne perd jamais le créneau si la seconde étape échoue
- [x] Tests : annulation nominale, mauvais couple, référence inexistante, rendez-vous passé, double annulation, rate limit

### Lot 2 — la trace écrite

- [ ] **Non fait — votre décision.** Seule l'infrastructure a été livrée.
- [x] *(2.4)* Interface unique `src/lib/notifications.js`, deux implémentations
- [x] *(2.4)* SMS en stub Twilio, désactivé par défaut
- [x] *(2.4)* Compteur d'usage en base, plafond dur, jamais de dépassement silencieux

### Lot 3 — le tableau de bord

- [x] Les chiffres correspondent exactement aux données en base (jeu connu)
- [x] Une semaine sans rendez-vous affiche des zéros, pas `NaN` ni `undefined`
- [x] L'export CSV s'ouvre correctement dans Excel français, accents inclus
- [x] Le marqueur no-show n'est jamais visible côté vitrine

### Lot 4 — séparer l'admin de la vitrine

- [x] Un `curl` sur `/` ne contient aucune chaîne de l'interface d'administration
- [x] `/espace-salon` répond 200 et affiche la connexion
- [x] La session existante n'est pas cassée par le changement de route
- [ ] **Moins de 100 Ko de DOM : non atteint.** 117,3 Kio. Voir le point 5.

### Lot 5 — SEO, accessibilité, données structurées

- [x] Un seul `<h1>` dans le document
- [x] Chaque image porte un `alt` non vide et pertinent
- [x] `sitemap.xml` répond 200 en mode production
- [ ] **JSON-LD validé par schema.org : non vérifié.** Voir le point 5.
- [ ] **Capture pleine page : non vérifiée visuellement.** Voir le point 5.

### Lot 6 — finition

- [x] La grille accepte jusqu'à 12 photos et se dégrade proprement à 3 ou 4
- [x] Mode avant/après
- [x] Avis gérables depuis les réglages + date de dernière mise à jour
- [x] Les quatre cas de robustesse du tunnel
- [x] Lighthouse mobile 95+ (99 / 100 / 100 / 100)
- [ ] **Cold start Render : non mesuré.** Voir le point 5.
- [x] `LISEZ-MOI.md` et `CLAUDE.md` à jour

---

## 4. Avant / après

| | avant | après |
|---|---:|---:|
| **Tests** | 401 | **589** (+188) |
| Suites | 5 | 11 |
| **DOM de la vitrine** | 164 244 o (160,4 Kio) | **120 156 o (117,3 Kio)** |
| Page servie | 156 493 o | 112 500 o |
| Nœuds du DOM | 828 | 660 |
| Dépendances | 4 | **4** |

### Lighthouse mobile

Mesuré en local, `--form-factor=mobile`, Lighthouse 13.4.1.

| | vitrine | `/annuler` | `/espace-salon` |
|---|---:|---:|---:|
| Performance | **99** | 100 | 100 |
| Accessibilité | **100** | 100 | 100 |
| Bonnes pratiques | **100** | 100 | 96 |
| SEO | **100** | 63 | 54 |
| LCP | 2,1 s | 1,4 s | 1,5 s |
| CLS | 0 | 0 | 0 |
| Poids transféré | 173 Kio | 95 Kio | 109 Kio |

**Les scores SEO de `/annuler` et `/espace-salon` sont bas exprès** : ces pages
portent `noindex`, et Lighthouse le compte comme un défaut. C'est le
comportement voulu.

**Bonnes pratiques 96 sur `/espace-salon`** : le contrôle de session journalise
un 401 dans la console quand personne n'est connecté. C'est la réponse correcte
du serveur ; Lighthouse compte toute erreur de console.

⚠️ **Une régression de performance introduite puis corrigée dans le même lot.**
En rendant la galerie côté serveur, j'avais chargé les quatre premières photos
sans attendre, par analogie avec la photo d'accueil. C'était faux : **la galerie
n'est jamais dans le premier écran**. Ces 354 Kio disputaient la bande passante
à la photo d'accueil.

| | avant correction | après |
|---|---:|---:|
| Performance | 88 | **99** |
| LCP | 3,9 s | **2,1 s** |
| Total Blocking Time | 30 ms | **0 ms** |
| Poids transféré | 528 Kio | **173 Kio** |

Sans Lighthouse, cette régression partait en production.

---

## 5. Ce que je n'ai pas pu faire

**Le lot 2 (email réel, contenu du mail, rappel J-1).** Votre décision, prise en
cours de route. L'infrastructure l'attend : le canal `email` a son point
d'insertion, son compteur, son journal et son contrat de retour. Il ne manque
que l'envoi et la rédaction. Conséquence à connaître : **le client repart
toujours sans trace écrite**, et la promesse « notez la référence » repose
entièrement sur ce qu'il note lui-même — ou sur le rappel gardé dans son
navigateur (lot 1.3), qui ne survit pas à un changement d'appareil.

**Moins de 100 Ko de DOM sur la vitrine : 117,3 Kio.** Je l'avais annoncé comme
incertain dès l'audit. Le reste se répartit ainsi : 29 Kio de style, 38 Kio de
JavaScript, 6 Kio de JSON-LD, 35 Kio de balisage. Descendre plus bas demanderait
de couper dans le tunnel de réservation ou dans la charte — c'est-à-dire dans le
produit. Trois pistes chiffrées sont au point 6.

**Le JSON-LD n'a pas été soumis au validateur de schema.org.** Il exige une URL
publique ou un copier-coller manuel dans une interface web. Ce que j'ai vérifié :
JSON syntaxiquement valide, types existants, `estimatedDuration` au format ISO
8601, aucune propriété inventée. **À passer au Rich Results Test avant la mise
en ligne** — c'est cinq minutes.

**La capture pleine page n'a pas été vérifiée visuellement.** L'environnement de
travail ne rend pas les captures d'écran. J'ai corrigé la cause (identifiée avec
certitude, `overflow-x: clip`), vérifié que `overflow-clip-margin: 100vh`
s'applique bien (`getComputedStyle` renvoie `720px` sur un écran de 720),
et ajouté un test qui interdit le retour en arrière. **Mais je n'ai pas vu
l'image.** À confirmer d'un `--screenshot` avant de montrer le site.

**Le cold start Render n'a pas été mesuré.** Il demande une instance déployée et
quinze minutes d'attente. Le travail fait ne l'améliore ni ne l'aggrave, à un
détail près : la vitrine étant 28 % plus légère, le premier rendu après réveil
devrait gagner un peu. Options si le délai dépasse 5 s, sans les implémenter :
un ping externe toutes les dix minutes (gratuit, contourne la mise en veille) ;
le plan payant Render à 7 $/mois (qui règle aussi la persistance) ; ou Koyeb,
déjà visé par `CLAUDE.md`.

**`POST /api/bookings` n'est toujours pas limité en débit.** Relevé à l'audit,
hors des six lots. En l'état, **n'importe qui peut saturer l'agenda d'un client
en une minute** avec une boucle de dix lignes. À mon avis, c'est le point le
plus urgent de cette liste.

**L'équipe et le tunnel restent absents du HTML servi.** Le lot 5 a traité les
images ; ces deux sections-là demanderaient de rendre côté serveur ce que
`peindreEquipe()` et `peindreQui()` produisent. Le mal est borné — les tarifs,
les avis, le bandeau et le JSON-LD y sont — mais un robot sans JavaScript ne
voit toujours ni l'équipe ni le formulaire de réservation.

**`tests/portees.mjs` est une analyse grossière, pas un interpréteur.** Il attrape
exactement la classe de bogue qui s'est produite trois fois. Il ne verra pas un
appel construit dynamiquement, ni une méthode d'objet manquante.

---

## 6. Ce qui mériterait un lot suivant, par valeur commerciale

**1. Le lot 2, terminé (email + rappel J-1).** *Valeur : la plus haute.* C'est la
première cause de no-show et la première question d'un patron en rendez-vous.
Tout est prêt ; il manque l'envoi et deux textes. Le rappel J-1 seul fait
typiquement baisser les absences d'un tiers.

**2. La limitation de débit sur `POST /api/bookings`.** *Valeur : c'est une
assurance.* Quelques lignes — `src/lib/rateLimit.js` existe déjà. Le jour où un
client découvre son agenda rempli de faux rendez-vous, c'est le produit qu'il
met en cause.

**3. La liste d'attente.** *Valeur : haute, et personne ne la fait bien.* Vous
avez maintenant tout : les annulations laissent une trace, le canal de
notification existe, les créneaux morts sont mesurés. « Prévenez-moi si un
créneau se libère » transforme chaque annulation en rendez-vous, et c'est un
argument qu'aucun concurrent de quartier n'a.

**4. Le rendu serveur de l'équipe et du tunnel.** *Valeur : référencement.*
« Coupe homme à Bavay » se joue là.

**5. Descendre sous 100 Ko.** *Valeur : modérée.* Trois pistes chiffrées :
compacter le JSON-LD (−2 Kio, au prix de sa lisibilité en source) ; retirer
`peindrePrestations`/`peindreAvis` de la vitrine, désormais inutiles puisque les
réglages sont dans un autre document (−4 à 6 Kio) ; découper le tunnel pour ne
charger le calendrier qu'au premier clic (−8 Kio, mais c'est un vrai chantier).

**6. Les statistiques par période choisie.** *Valeur : modérée.* Le tableau de
bord montre la semaine et le mois en cours. « Comparer à l'an dernier » est la
demande suivante, et les données sont déjà là.

**7. Un vrai audit de contraste automatisé.** *Valeur : faible mais durable.*
`CLAUDE.md` dit que les couleurs ont été mesurées à la main. Sur un projet
destiné à être décliné pour plusieurs clients, ce contrôle mérite d'être un test.

---

*Chaque chiffre de ce rapport a été mesuré sur le serveur qui tourne. Les
scores Lighthouse ont été relancés après la dernière modification.*
