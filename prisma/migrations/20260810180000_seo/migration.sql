-- AlterTable
ALTER TABLE "Settings" ADD COLUMN "businessType" TEXT NOT NULL DEFAULT 'BarberShop';
ALTER TABLE "Settings" ADD COLUMN "latitude" REAL;
ALTER TABLE "Settings" ADD COLUMN "longitude" REAL;
