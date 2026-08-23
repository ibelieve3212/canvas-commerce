@echo off
title CanvasCommerce V2 - Setup

echo ============================================
echo   CanvasCommerce V2 - Setup
echo ============================================
echo.

cd /d "%~dp0app"

echo [1/3] Installing dependencies (may take a few minutes)...
echo.
call pnpm install
if %errorlevel% neq 0 (
    echo.
    echo [!] Install failed. If better-sqlite3 compile error:
    echo     Option A: Install Visual Studio Build Tools
    echo     Option B: Try: pnpm install --offline --ignore-scripts
    echo.
    pause
    exit /b 1
)

echo.
echo [2/3] Generating Prisma Client...
call pnpm prisma:generate
if %errorlevel% neq 0 (
    echo [!] Prisma generate failed
    pause
    exit /b 1
)

echo.
echo [3/3] Database migrate + seed...
call pnpm prisma:migrate
if %errorlevel% neq 0 (
    echo [!] Migrate failed. Trying: npx prisma migrate dev --name init
    call npx prisma migrate dev --name init
    if %errorlevel% neq 0 (
        echo [!] Migrate still failed
        pause
        exit /b 1
    )
)
call pnpm prisma:seed
if %errorlevel% neq 0 (
    echo [!] Seed failed
    pause
    exit /b 1
)

echo.
echo ============================================
echo   Setup complete!
echo   Admin:    admin / admin123
echo   User:     user  / user123
echo ============================================
echo.
echo Next: run start-dev.bat to start dev server
echo.
pause
