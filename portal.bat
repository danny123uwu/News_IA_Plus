@echo off
setlocal
title Portal IA News
pushd "%~dp0" || exit /b 1
if /i "%~1"=="ayuda" goto ayuda

:menu
cls
echo ============================================================
echo                     PORTAL IA NEWS
echo ============================================================
echo.
echo   APLICACION
echo   1. Iniciar con Node (sin Docker)
echo   2. Iniciar / actualizar con Docker
echo   3. Detener Docker (conserva datos)
echo   4. Ver estado de Docker
echo.
echo   INTELIGENCIA ARTIFICIAL
echo   5. Descargar modelos de Ollama en Docker
echo   6. Elegir Ollama: contenedor o sistema
echo.
echo   7. Abrir aplicacion en el navegador
echo   0. Salir del lanzador
echo.
set "op="
set /p "op=Opcion: "
if "%op%"=="1" goto nativo
if "%op%"=="2" goto iniciar
if "%op%"=="3" goto detener
if "%op%"=="4" goto estado
if "%op%"=="5" goto modelos
if "%op%"=="6" goto motor
if "%op%"=="7" goto abrir
if "%op%"=="0" goto salir
goto menu

:preparar
if exist .env exit /b 0
powershell.exe -NoProfile -Command "$ErrorActionPreference='Stop';$b=New-Object byte[] 32;$r=[Security.Cryptography.RandomNumberGenerator]::Create();$r.GetBytes($b);$r.Dispose();$k=[BitConverter]::ToString($b).Replace('-','').ToLowerInvariant();$t=[IO.File]::ReadAllText('.env.example');$t=$t -replace '(?m)^JWT_SECRET=.*$',('JWT_SECRET='+$k);[IO.File]::WriteAllText('.env',$t,(New-Object Text.UTF8Encoding $false))"
if errorlevel 1 exit /b 1
echo Configuracion inicial preparada. Tus claves no se muestran.
exit /b 0

:docker_listo
docker info >nul 2>&1
if errorlevel 1 (
  echo Abri Docker Desktop con contenedores Linux y volve a intentarlo.
  exit /b 1
)
docker compose version >nul 2>&1
if errorlevel 1 exit /b 1
call :preparar
if errorlevel 1 exit /b 1
set "MODO=docker"
for /f "tokens=1,* delims==" %%A in ('findstr /b "OLLAMA_MODO=" .env') do set "MODO=%%B"
set "COMPOSE=docker compose -f docker-compose.yml"
if /i "%MODO%"=="host" (
  set "COMPOSE=%COMPOSE% -f docker-compose.host.yml"
  exit /b 0
)
docker info --format "{{json .Runtimes}}" 2>nul | findstr /i "nvidia" >nul
if not errorlevel 1 set "COMPOSE=%COMPOSE% -f docker-compose.gpu.yml"
exit /b 0

:nativo
node -e "if(Number(process.versions.node.split('.')[0])<24)process.exit(1)" >nul 2>&1
if errorlevel 1 (
  echo Instala Node.js 24 LTS o posterior y volve a abrir este archivo.
  goto volver
)
call :preparar
if errorlevel 1 goto volver
if not exist node_modules (
  call npm ci
  if errorlevel 1 goto volver
)
echo.
echo Aplicacion: http://localhost:8090
echo Ctrl+C detiene esta ejecucion. No inicies a la vez el modo Docker.
echo.
rem El entorno solo cambia para este proceso; no se modifica el .env de Docker.
setlocal
set "OLLAMA_URL=http://127.0.0.1:11434"
set "AGENT_URL=http://localhost:3003"
set "FEEDS_URL=http://localhost:3002"
node --env-file=.env start.js
endlocal
goto volver

:iniciar
call :docker_listo
if errorlevel 1 goto volver
%COMPOSE% build web
if errorlevel 1 goto volver
if /i "%MODO%"=="host" (
  %COMPOSE% run --rm --no-deps agente node -e "fetch(process.env.OLLAMA_URL+'/api/tags',{signal:AbortSignal.timeout(5000)}).then(r=>{if(!r.ok)throw Error('HTTP '+r.status)}).catch(e=>{console.error('Ollama del sistema no accesible:',e.message);process.exit(1)})"
  if errorlevel 1 goto volver
  docker stop ianews-ollama >nul 2>&1
)
%COMPOSE% up -d
if errorlevel 1 goto volver
echo Aplicacion: http://localhost
start "" "http://localhost"
goto volver

:detener
call :docker_listo
if errorlevel 1 goto volver
%COMPOSE% stop
goto volver

:estado
call :docker_listo
if errorlevel 1 goto volver
echo Motor de modelos: %MODO%
%COMPOSE% ps
echo Para ver errores: docker compose logs --tail 40 agente
goto volver

:modelos
call :docker_listo
if errorlevel 1 goto volver
if /i "%MODO%"=="host" (
  echo Usas Ollama del sistema. Descarga alli con: ollama pull llama3.2:3b
  goto volver
)
%COMPOSE% exec ollama ollama pull qwen2.5:3b
if errorlevel 1 goto volver
%COMPOSE% exec ollama ollama pull llama3.2:3b
goto volver

:motor
call :preparar
if errorlevel 1 goto volver
echo 1. Ollama en el contenedor
echo 2. Ollama instalado en el sistema
set "seleccion="
set /p "seleccion=Opcion: "
set "MOTOR_NUEVO="
if "%seleccion%"=="1" set "MOTOR_NUEVO=docker"
if "%seleccion%"=="2" set "MOTOR_NUEVO=host"
if not defined MOTOR_NUEVO goto volver
powershell.exe -NoProfile -Command "$ErrorActionPreference='Stop';$t=[IO.File]::ReadAllText('.env');if($t -match '(?m)^OLLAMA_MODO='){$t=$t -replace '(?m)^OLLAMA_MODO=.*$',('OLLAMA_MODO='+$env:MOTOR_NUEVO)}else{$t+=[Environment]::NewLine+'OLLAMA_MODO='+$env:MOTOR_NUEVO+[Environment]::NewLine};[IO.File]::WriteAllText('.env',$t,(New-Object Text.UTF8Encoding $false))"
if errorlevel 1 goto volver
echo Motor guardado. Elegi Iniciar con Docker para aplicarlo.
echo El modo sistema requiere Ollama accesible desde Docker.
goto volver

:abrir
echo 1. Docker: http://localhost
echo 2. Node:   http://localhost:8090
set "seleccion="
set /p "seleccion=Opcion: "
if "%seleccion%"=="1" start "" "http://localhost"
if "%seleccion%"=="2" start "" "http://localhost:8090"
goto menu

:ayuda
echo Portal IA News para Windows
echo Abri portal.bat sin argumentos para usar el menu.
echo Sin Docker: requiere Node.js 24 LTS. Con Docker: Docker Desktop.
echo Los datos se conservan al detener la aplicacion.
goto salir

:volver
echo.
pause
goto menu

:salir
popd
endlocal
