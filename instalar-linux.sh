#!/usr/bin/env bash
# Instala la app en un equipo Linux siempre encendido y la deja como servicio systemd.
#
#   sudo bash instalar-linux.sh
#
# Vuelve a correrse para actualizar: conserva .env y la base de recibos.
set -euo pipefail

CARPETA="${CARPETA:-/opt/recibos-ipmr}"
REPO="${REPO:-https://github.com/AMJuan1/recibos-ipmr.git}"
PUERTO="${PUERTO:-3000}"
USUARIO="recibos"
SERVICIO="recibos-ipmr"

[ "$(id -u)" -eq 0 ] || { echo "Corrélo con sudo: sudo bash instalar-linux.sh" >&2; exit 1; }

falta() { command -v "$1" >/dev/null || { echo "Falta $1. Instalalo con: $2" >&2; exit 1; }; }
falta git "sudo apt install git"
falta node "https://github.com/nodesource/distributions (Node 22 o más nuevo)"
falta python3 "sudo apt install python3 python3-venv"

version=$(node -e 'console.log(process.versions.node)')
if [ "$(printf '%s\n22.13.0\n' "$version" | sort -V | head -1)" != "22.13.0" ]; then
  echo "Node $version es muy viejo; se necesita 22.13 o más nuevo." >&2
  exit 1
fi

id -u "$USUARIO" >/dev/null 2>&1 || useradd --system --home-dir "$CARPETA" --shell /usr/sbin/nologin "$USUARIO"

# ---------- código ----------
if [ -d "$CARPETA/.git" ]; then
  echo "Actualizando el código en $CARPETA..."
  git -C "$CARPETA" pull --ff-only
else
  echo "Descargando el código en $CARPETA..."
  git clone "$REPO" "$CARPETA"
fi
cd "$CARPETA"

echo "Instalando dependencias..."
npm ci --omit=dev
python3 -m venv .venv-extractor
.venv-extractor/bin/pip install --quiet --upgrade -r extractor/requirements.txt

# ---------- configuración ----------
if [ ! -f "$CARPETA/.env" ]; then
  read -rsp "Contraseña para el panel /admin: " clave; echo
  [ -n "$clave" ] || { echo "Sin contraseña no arranca." >&2; exit 1; }
  cat > "$CARPETA/.env" <<EOF
ADMIN_PASSWORD=$clave
SESSION_SECRET=$(openssl rand -hex 32 2>/dev/null || head -c32 /dev/urandom | od -An -tx1 | tr -d ' \n')
DATA_DIR=$CARPETA/data
PYTHON=$CARPETA/.venv-extractor/bin/python
HOST=127.0.0.1
PORT=$PUERTO
EOF
  echo "Configuración guardada en $CARPETA/.env"
else
  echo "Ya existe .env, se conserva (la base de recibos no se toca)."
fi

mkdir -p "$CARPETA/data"
chown -R "$USUARIO:$USUARIO" "$CARPETA"
chmod 600 "$CARPETA/.env"

# ---------- servicio ----------
cat > "/etc/systemd/system/$SERVICIO.service" <<EOF
[Unit]
Description=Recibos de pago IPMR
After=network.target

[Service]
Type=simple
User=$USUARIO
WorkingDirectory=$CARPETA
EnvironmentFile=$CARPETA/.env
ExecStart=$(command -v node) server.js
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ReadWritePaths=$CARPETA/data

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now "$SERVICIO"
sleep 3

if curl -fsS "http://127.0.0.1:$PUERTO/admin" -o /dev/null; then
  echo "Listo: la app corre en http://127.0.0.1:$PUERTO/admin"
else
  echo "La app no respondió todavía. Revisá: journalctl -u $SERVICIO -n 40 --no-pager" >&2
fi

cat <<EOF

Falta publicarla en internet con Tailscale (una sola vez):

  curl -fsSL https://tailscale.com/install.sh | sh     # o el paquete de tu distro
  sudo tailscale up
  sudo tailscale funnel --bg $PUERTO

La primera vez te da un link para habilitar Funnel en tu cuenta: abrilo y aceptá.
Al terminar imprime la URL pública (https://<equipo>.<tailnet>.ts.net): esa es la del panel
y de ahí salen los links de los trabajadores.

Comandos útiles:
  systemctl status $SERVICIO          estado
  journalctl -u $SERVICIO -f          registro en vivo
  systemctl restart $SERVICIO         reiniciar
  sudo bash instalar-linux.sh         actualizar a la última versión

Copia de seguridad: guardá de vez en cuando $CARPETA/data/recibos.db (ahí viven las firmas).
EOF
