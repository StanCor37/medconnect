-- DropForeignKey
ALTER TABLE "HitlTask" DROP CONSTRAINT "HitlTask_supersededByHitlTaskId_fkey";

-- DropIndex
DROP INDEX "HitlTask_supersededByHitlTaskId_key";

-- AlterTable
ALTER TABLE "HitlTask" DROP COLUMN "supersededByHitlTaskId",
ADD COLUMN     "supersedesHitlTaskId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "HitlTask_supersedesHitlTaskId_key" ON "HitlTask"("supersedesHitlTaskId");

-- AddForeignKey
ALTER TABLE "HitlTask" ADD CONSTRAINT "HitlTask_supersedesHitlTaskId_fkey" FOREIGN KEY ("supersedesHitlTaskId") REFERENCES "HitlTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

