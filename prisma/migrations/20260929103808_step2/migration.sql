-- CreateTable
CREATE TABLE "Account" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "passwordHash" TEXT NOT NULL,
    "recoveryCodeHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_App" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "image" TEXT NOT NULL,
    "hostPort" INTEGER NOT NULL,
    "containerPort" INTEGER NOT NULL,
    "containerId" TEXT,
    "status" TEXT NOT NULL,
    "catalogId" TEXT,
    "volumes" TEXT NOT NULL DEFAULT '[]',
    "fixedPorts" TEXT NOT NULL DEFAULT '[]',
    "secrets" TEXT NOT NULL DEFAULT '{}',
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_App" ("containerId", "containerPort", "createdAt", "hostPort", "id", "image", "name", "status", "updatedAt") SELECT "containerId", "containerPort", "createdAt", "hostPort", "id", "image", "name", "status", "updatedAt" FROM "App";
DROP TABLE "App";
ALTER TABLE "new_App" RENAME TO "App";
CREATE UNIQUE INDEX "App_name_key" ON "App"("name");
CREATE UNIQUE INDEX "App_hostPort_key" ON "App"("hostPort");
CREATE UNIQUE INDEX "App_containerId_key" ON "App"("containerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
