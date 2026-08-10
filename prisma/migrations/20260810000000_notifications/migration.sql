-- CreateTable
CREATE TABLE "NotificationCounter" (
    "mois" TEXT NOT NULL,
    "canal" TEXT NOT NULL,
    "envoyes" INTEGER NOT NULL DEFAULT 0,
    "refuses" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("mois", "canal")
);
