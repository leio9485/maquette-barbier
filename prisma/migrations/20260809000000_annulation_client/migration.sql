-- AlterTable
ALTER TABLE "Booking" ADD COLUMN "reference" TEXT;
ALTER TABLE "Booking" ADD COLUMN "annuleLe" DATETIME;

-- CreateIndex
CREATE UNIQUE INDEX "Booking_reference_key" ON "Booking"("reference");

-- CreateIndex
CREATE INDEX "Booking_date_annuleLe_idx" ON "Booking"("date", "annuleLe");
