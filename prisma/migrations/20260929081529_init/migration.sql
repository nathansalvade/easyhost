-- CreateTable
CREATE TABLE "App" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "image" TEXT NOT NULL,
    "hostPort" INTEGER NOT NULL,
    "containerPort" INTEGER NOT NULL,
    "containerId" TEXT,
    "status" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "App_name_key" ON "App"("name");

-- CreateIndex
CREATE UNIQUE INDEX "App_hostPort_key" ON "App"("hostPort");

-- CreateIndex
CREATE UNIQUE INDEX "App_containerId_key" ON "App"("containerId");
