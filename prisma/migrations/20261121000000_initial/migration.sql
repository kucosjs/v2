CREATE TABLE "Comment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "article" TEXT NOT NULL,
    "author" TEXT NOT NULL DEFAULT 'Anonymous',
    "content" TEXT NOT NULL,
    "email" TEXT,
    "website" TEXT,
    "owner" TEXT NOT NULL,
    "parentId" TEXT,
    "moderation" TEXT NOT NULL DEFAULT 'published',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "dislikes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,
    "userAgent" TEXT,
    CONSTRAINT "Comment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Comment" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "Vote" (
    "commentId" TEXT NOT NULL,
    "visitor" TEXT NOT NULL,
    PRIMARY KEY ("commentId", "visitor"),
    CONSTRAINT "Vote_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "Comment" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "Kudos" (
    "article" TEXT NOT NULL PRIMARY KEY,
    "count" INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE "KudosMember" (
    "article" TEXT NOT NULL,
    "visitor" TEXT NOT NULL,
    PRIMARY KEY ("article", "visitor"),
    CONSTRAINT "KudosMember_article_fkey" FOREIGN KEY ("article") REFERENCES "Kudos" ("article") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "AdminSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "expiresAt" DATETIME NOT NULL
);

CREATE INDEX "Comment_article_createdAt_idx" ON "Comment"("article", "createdAt");
CREATE INDEX "Comment_parentId_idx" ON "Comment"("parentId");
CREATE INDEX "Comment_moderation_createdAt_idx" ON "Comment"("moderation", "createdAt");
CREATE INDEX "AdminSession_expiresAt_idx" ON "AdminSession"("expiresAt");
