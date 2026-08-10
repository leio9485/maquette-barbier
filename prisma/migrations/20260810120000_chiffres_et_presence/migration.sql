-- AlterTable
ALTER TABLE "Booking" ADD COLUMN "presence" TEXT;

-- AlterTable
ALTER TABLE "Settings" ADD COLUMN "reviewUrl" TEXT NOT NULL DEFAULT '';

-- CreateIndex
-- Le tableau de bord lit « les rendez-vous d'une periode », et le suivi des
-- absences « toutes les absences d'un numero ». Les deux passent par ces
-- colonnes-la.
CREATE INDEX "Booking_customerPhone_idx" ON "Booking"("customerPhone");
CREATE INDEX "Booking_presence_idx" ON "Booking"("presence");
