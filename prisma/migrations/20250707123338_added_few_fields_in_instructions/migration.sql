/*
  Warnings:

  - You are about to drop the `ongoing_instructions` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "ongoing_instructions" DROP CONSTRAINT "ongoing_instructions_userId_fkey";

-- DropTable
DROP TABLE "ongoing_instructions";

-- CreateTable
CREATE TABLE "OngoingInstruction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "instruction" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" TEXT DEFAULT 'normal',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OngoingInstruction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OngoingInstruction_userId_isActive_idx" ON "OngoingInstruction"("userId", "isActive");

-- AddForeignKey
ALTER TABLE "OngoingInstruction" ADD CONSTRAINT "OngoingInstruction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
