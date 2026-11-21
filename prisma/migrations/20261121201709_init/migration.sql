-- CreateEnum
CREATE TYPE "Moderation" AS ENUM ('published', 'pending', 'spam');

-- CreateTable
CREATE TABLE "Article" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,

    CONSTRAINT "Article_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "author" TEXT NOT NULL DEFAULT 'Anonymous',
    "content" TEXT NOT NULL,
    "email" TEXT,
    "website" TEXT,
    "owner" TEXT NOT NULL,
    "parentId" TEXT,
    "moderation" "Moderation" NOT NULL DEFAULT 'published',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "dislikes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vote" (
    "commentId" TEXT NOT NULL,
    "visitor" TEXT NOT NULL,

    CONSTRAINT "Vote_pkey" PRIMARY KEY ("commentId","visitor")
);

-- CreateTable
CREATE TABLE "Kudos" (
    "articleId" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Kudos_pkey" PRIMARY KEY ("articleId")
);

-- CreateTable
CREATE TABLE "KudosMember" (
    "articleId" TEXT NOT NULL,
    "visitor" TEXT NOT NULL,

    CONSTRAINT "KudosMember_pkey" PRIMARY KEY ("articleId","visitor")
);

-- CreateIndex
CREATE UNIQUE INDEX "Article_url_key" ON "Article"("url");

-- CreateIndex
CREATE INDEX "Comment_articleId_createdAt_idx" ON "Comment"("articleId", "createdAt");

-- CreateIndex
CREATE INDEX "Comment_parentId_idx" ON "Comment"("parentId");

-- CreateIndex
CREATE INDEX "Comment_moderation_createdAt_idx" ON "Comment"("moderation", "createdAt");

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Comment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Kudos" ADD CONSTRAINT "Kudos_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KudosMember" ADD CONSTRAINT "KudosMember_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Kudos"("articleId") ON DELETE CASCADE ON UPDATE CASCADE;
