@echo off
echo ======================================================
echo   SPEGNIMENTO FORZATO BOT MEMECOIN E PROCESSI NODE
echo ======================================================
echo.
echo Sto terminando tutti i processi in background...
taskkill /F /IM node.exe /T
echo.
echo Fatto! Il bot è ora completamente disattivato.
pause
