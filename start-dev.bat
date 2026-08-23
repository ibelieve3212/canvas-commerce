@echo off
title CanvasCommerce V2 - Dev Server

echo ============================================
echo   CanvasCommerce V2 - Dev Server
echo ============================================
echo.

cd /d "%~dp0app"

echo Starting... open http://localhost:3000
echo.
echo Admin: admin / admin123
echo User:  user  / user123
echo.
echo Press Ctrl+C to stop
echo.

call pnpm dev

pause
