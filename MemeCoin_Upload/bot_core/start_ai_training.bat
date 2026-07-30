@echo off
title MemeCoin AI - Solo Addestramento Background
color 0A
echo ======================================================
echo    AVVIO SISTEMA AI IN MODALITA' SOLO ADDESTRAMENTO
echo ======================================================
echo.
echo [!] Il bot si colleghera' alla rete Solana, analizzera' i 
echo     token e addestrerà il modello AI, MA NON SI CONNETTERA' 
echo     A DISCORD. Perfetto per raccogliere dati in background!
echo.

set NO_DISCORD=true
set TRAINING_MODE=true
set DRY_RUN=true

node src/index.js

echo.
echo Processo terminato o andato in errore.
pause
