-- AlterTable
ALTER TABLE "Booking" ADD COLUMN "cancelToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Booking_cancelToken_key" ON "Booking"("cancelToken");
