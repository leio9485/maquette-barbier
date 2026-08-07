/*
  Warnings:

  - You are about to drop the column `priceCents` on the `ServiceStaff` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Staff" ADD COLUMN "photo" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ServiceStaff" (
    "serviceId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,

    PRIMARY KEY ("serviceId", "staffId"),
    CONSTRAINT "ServiceStaff_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ServiceStaff_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ServiceStaff" ("serviceId", "staffId") SELECT "serviceId", "staffId" FROM "ServiceStaff";
DROP TABLE "ServiceStaff";
ALTER TABLE "new_ServiceStaff" RENAME TO "ServiceStaff";
CREATE INDEX "ServiceStaff_staffId_idx" ON "ServiceStaff"("staffId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
