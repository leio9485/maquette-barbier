-- CreateTable
CREATE TABLE "StaffHours" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "staffId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "closed" BOOLEAN NOT NULL DEFAULT false,
    "openMin" INTEGER,
    "closeMin" INTEGER,
    "pauseStartMin" INTEGER,
    "pauseEndMin" INTEGER,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StaffHours_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffHours_staffId_weekday_key" ON "StaffHours"("staffId", "weekday");
