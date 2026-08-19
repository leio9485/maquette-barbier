-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AdminUser" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" DATETIME
);
INSERT INTO "new_AdminUser" ("createdAt", "id", "lastLoginAt", "passwordHash", "username") SELECT "createdAt", "id", "lastLoginAt", "passwordHash", "username" FROM "AdminUser";
DROP TABLE "AdminUser";
ALTER TABLE "new_AdminUser" RENAME TO "AdminUser";
CREATE UNIQUE INDEX "AdminUser_username_key" ON "AdminUser"("username");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
