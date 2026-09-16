# Instala la app en una PC Windows que esté siempre encendida y la deja corriendo
# como tarea programada (arranca sola con el equipo).
#
#   Click derecho sobre este archivo -> "Ejecutar con PowerShell" (como administrador)
#   o:  powershell -ExecutionPolicy Bypass -File instalar-windows.ps1
#
# Requisitos previos: Node 22.13+ (nodejs.org), Python 3 (python.org, marcar "Add to PATH") y Git.

param(
  [string]$Carpeta = "$env:ProgramData\RecibosIPMR",
  [string]$Repo    = "https://github.com/AMJuan1/recibos-ipmr.git",
  [int]   $Puerto  = 3000
)

$ErrorActionPreference = "Stop"
$tarea = "RecibosIPMR"

function Falta($cmd, $donde) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    Write-Host "Falta $cmd. Instalalo desde $donde y volvé a correr este script." -ForegroundColor Red
    exit 1
  }
}
Falta git "https://git-scm.com/download/win"
Falta node "https://nodejs.org (versión LTS)"
Falta python "https://www.python.org/downloads/ (marcá 'Add python.exe to PATH')"

$version = (node -e "console.log(process.versions.node)")
if ([version]$version -lt [version]"22.13.0") {
  Write-Host "Node $version es muy viejo; se necesita 22.13 o más nuevo." -ForegroundColor Red
  exit 1
}

# --- código ---
if (Test-Path "$Carpeta\.git") {
  Write-Host "Actualizando el código en $Carpeta..."
  git -C $Carpeta pull --ff-only
} else {
  Write-Host "Descargando el código en $Carpeta..."
  git clone $Repo $Carpeta
}
Push-Location $Carpeta

Write-Host "Instalando dependencias..."
npm ci --omit=dev
python -m pip install --quiet --upgrade -r extractor\requirements.txt

# --- configuración ---
if (-not (Test-Path "$Carpeta\.env")) {
  $clave = Read-Host "Contraseña para el panel /admin (la que vas a usar vos)"
  if (-not $clave) { Write-Host "Sin contraseña no arranca." -ForegroundColor Red; exit 1 }
  $secreto = -join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Max 256) })
  # HOST=127.0.0.1: solo el túnel puede alcanzarlo, no queda abierto en la red local
  @(
    "ADMIN_PASSWORD=$clave",
    "SESSION_SECRET=$secreto",
    "DATA_DIR=$Carpeta\data",
    "HOST=127.0.0.1",
    "PORT=$Puerto"
  ) | Set-Content -Path "$Carpeta\.env" -Encoding utf8
  Write-Host "Configuración guardada en $Carpeta\.env"
} else {
  Write-Host "Ya existe .env, se conserva (la base de recibos no se toca)."
}

# --- tarea programada: arranca con el equipo y se reinicia si se cae ---
$node = (Get-Command node).Source
Unregister-ScheduledTask -TaskName $tarea -Confirm:$false -ErrorAction SilentlyContinue
$accion   = New-ScheduledTaskAction -Execute $node -Argument "--env-file=.env server.js" -WorkingDirectory $Carpeta
$arranque = New-ScheduledTaskTrigger -AtStartup
$opciones = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName $tarea -Action $accion -Trigger $arranque -Settings $opciones `
  -User "SYSTEM" -RunLevel Highest -Description "Recibos de pago IPMR" | Out-Null
Start-ScheduledTask -TaskName $tarea

Start-Sleep -Seconds 3
try {
  Invoke-WebRequest "http://127.0.0.1:$Puerto/admin" -UseBasicParsing -TimeoutSec 5 | Out-Null
  Write-Host "`nListo: la app está corriendo en http://127.0.0.1:$Puerto/admin" -ForegroundColor Green
} catch {
  Write-Host "`nLa app no respondió todavía. Mirá el estado con: Get-ScheduledTask $tarea" -ForegroundColor Yellow
}

Write-Host @"

Falta publicarla en internet con Tailscale (una sola vez):

  1. Instalá Tailscale:  https://tailscale.com/download/windows
  2. Iniciá sesión y después corré:

       tailscale funnel --bg $Puerto

     La primera vez te da un link para habilitar Funnel en tu cuenta: abrilo y aceptá.
  3. El comando te imprime la URL pública (https://<equipo>.<tailnet>.ts.net).
     Esa es la que vas a abrir para el panel, y de ahí salen los links de los trabajadores.

Para actualizar la app más adelante, volvé a correr este script.
Copia de seguridad: guardá de vez en cuando el archivo $Carpeta\data\recibos.db
"@
Pop-Location
