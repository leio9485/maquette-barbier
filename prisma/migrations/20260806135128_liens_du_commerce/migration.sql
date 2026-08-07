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
    "slotStepMin" INTEGER NOT NULL DEFAULT 30,
    "leadTimeMin" INTEGER NOT NULL DEFAULT 60,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Settings" ("businessName", "city", "email", "id", "leadTimeMin", "phone", "postalCode", "ratingCount", "ratingValue", "slotStepMin", "street", "updatedAt") SELECT "businessName", "city", "email", "id", "leadTimeMin", "phone", "postalCode", "ratingCount", "ratingValue", "slotStepMin", "street", "updatedAt" FROM "Settings";
DROP TABLE "Settings";
ALTER TABLE "new_Settings" RENAME TO "Settings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
