@echo off
setlocal EnableExtensions EnableDelayedExpansion
rem ---------------------------------------------------------------------------
rem  DND Tavern release: builds the installers and publishes them to GitHub
rem  Releases, so installed copies can update themselves.
rem
rem  Usage:  release.bat [version] [--dry]
rem    version   e.g. 0.2.1 (asked for when left out; Enter keeps the current one)
rem    --dry     build everything but don't publish
rem
rem  The GitHub token comes from GH_TOKEN, else the GitHub CLI's login
rem  ("gh auth login"), else a hidden prompt. It is never saved.
rem ---------------------------------------------------------------------------

cd /d "%~dp0"
title DND Tavern release

where node >nul 2>nul || (echo Node.js was not found. Install Node.js 22 or newer. & goto :fail)
where npm >nul 2>nul || (echo npm was not found. Install Node.js 22 or newer. & goto :fail)
if not exist node_modules (
  echo Installing dependencies...
  call npm install || goto :fail
)

set "DRY="
set "NEWVER="
for %%A in (%*) do (
  if /i "%%~A"=="--dry" (set "DRY=1") else (set "NEWVER=%%~A")
)

for /f "usebackq delims=" %%V in (`node -p "require('./package.json').version"`) do set "CURVER=%%V"
echo.
echo  DND Tavern release
echo  Current version: %CURVER%
if defined DRY echo  Dry run: nothing will be published.
echo.

if not defined NEWVER set /p "NEWVER=New version (Enter keeps %CURVER%): "
set "BUMPED="
if defined NEWVER if not "!NEWVER!"=="%CURVER%" (
  call npm version !NEWVER! --no-git-tag-version >nul || (echo "!NEWVER!" is not a valid version, e.g. 0.2.1 & goto :fail)
  set "BUMPED=1"
)
for /f "usebackq delims=" %%V in (`node -p "require('./package.json').version"`) do set "VERSION=%%V"

if defined DRY goto :build

rem GitHub token: GH_TOKEN, else the GitHub CLI, else ask (input hidden).
if not defined GH_TOKEN (
  where gh >nul 2>nul && for /f "usebackq delims=" %%T in (`gh auth token 2^>nul`) do set "GH_TOKEN=%%T"
)
if not defined GH_TOKEN (
  for /f "usebackq delims=" %%T in (`powershell -NoProfile -Command "$s = Read-Host 'GitHub token (needs repo access)' -AsSecureString; [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))"`) do set "GH_TOKEN=%%T"
)
if not defined GH_TOKEN (echo No GitHub token, so nothing can be published. & goto :fail)

echo Publishing DND Tavern v%VERSION% to GitHub Releases...
echo.

:build
if defined DRY (call npm run dist) else (call npm run release)
if errorlevel 1 goto :fail

echo.
if defined DRY (
  echo  Built v%VERSION% in the dist folder. Nothing was published.
) else (
  echo  Published v%VERSION%:
  echo    https://github.com/CannonPrince711/cannontavern/releases
  echo.
  echo  Installed copies find it with Settings - General - Updates - Check now.
  echo  The repository is private: make its releases public, or updates can't download.
)

if defined BUMPED if not defined DRY (
  echo.
  choice /c YN /m "Commit and push the version bump to v%VERSION%"
  if !errorlevel! equ 1 (
    git add package.json package-lock.json && git commit -m "Release v%VERSION%" && git push
  )
)
echo.
pause
exit /b 0

:fail
echo.
echo  Release failed.
pause
exit /b 1
