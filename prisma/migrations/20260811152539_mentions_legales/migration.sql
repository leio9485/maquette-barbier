-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Settings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "businessName" TEXT NOT NULL,
    "street" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "ratingValue" REAL NOT NULL DEFAULT 0,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "googleUrl" TEXT NOT NULL DEFAULT '',
    "instagramUrl" TEXT NOT NULL DEFAULT '',
    "facebookUrl" TEXT NOT NULL DEFAULT '',
    "reviewUrl" TEXT NOT NULL DEFAULT '',
    "businessType" TEXT NOT NULL DEFAULT 'HairSalon',
    "latitude" REAL,
    "longitude" REAL,
    "legalForm" TEXT NOT NULL DEFAULT '',
    "siret" TEXT NOT NULL DEFAULT '',
    "publicationDirector" TEXT NOT NULL DEFAULT '',
    "hostingDetails" TEXT NOT NULL DEFAULT '',
    "slotStepMin" INTEGER NOT NULL DEFAULT 30,
    "leadTimeMin" INTEGER NOT NULL DEFAULT 60,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Settings" ("businessName", "businessType", "city", "email", "facebookUrl", "googleUrl", "id", "instagramUrl", "latitude", "leadTimeMin", "longitude", "phone", "postalCode", "ratingCount", "ratingValue", "reviewUrl", "slotStepMin", "street", "updatedAt") SELECT "businessName", "businessType", "city", "email", "facebookUrl", "googleUrl", "id", "instagramUrl", "latitude", "leadTimeMin", "longitude", "phone", "postalCode", "ratingCount", "ratingValue", "reviewUrl", "slotStepMin", "street", "updatedAt" FROM "Settings";
DROP TABLE "Settings";
ALTER TABLE "new_Settings" RENAME TO "Settings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Corrige les instances deja en base (lot D, point D4). `businessType`
-- valait 'BarberShop' par defaut avant cette migration ; ce n'a jamais ete un
-- type schema.org valide (schema.org/BarberShop repond 404). Ne touche que les
-- lignes qui portent encore la valeur par defaut jamais changee a la main :
-- un commerce qui aurait choisi 'BarberShop' depuis les reglages n'existe pas,
-- puisque la liste fermee cote application ne l'a jamais propose que par ce
-- defaut.
UPDATE "Settings" SET "businessType" = 'HairSalon' WHERE "businessType" = 'BarberShop';
