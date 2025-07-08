-- AlterTable
ALTER TABLE "users" ADD COLUMN     "gmailData" JSONB,
ADD COLUMN     "hubspotData" JSONB,
ADD COLUMN     "lastGmailSync" TIMESTAMP(3),
ADD COLUMN     "lastHubspotSync" TIMESTAMP(3);
