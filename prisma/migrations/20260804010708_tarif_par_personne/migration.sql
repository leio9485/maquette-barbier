/*
  Warnings:

  - You are about to drop the `_ServiceToStaff` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterTable
ALTER TABLE "Booking" ADD COLUMN "priceCents" INTEGER;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "_ServiceToStaff";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "ServiceStaff" (
    "serviceId" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "priceCents" INTEGER,

    PRIMARY KEY ("serviceId", "staffId"),
    CONSTRAINT "ServiceStaff_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ServiceStaff_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ServiceStaff_staffId_idx" ON "ServiceStaff"("staffId");
