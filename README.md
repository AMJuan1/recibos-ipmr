# Recibos de pago firmables — IPMR

App web para emitir los recibos de cada quincena, enviar un link único por trabajador y guardar el recibo firmado.

- **Admin (Jan)**: `/admin` → sube la planilla (`.xlsx` o `.pdf`), revisa/edita la lista, genera un recibo y un link por trabajador, y ve el estado (pendiente / firmado).
- **Trabajador**: abre su link `/recibo/<token>` desde el teléfono, ve su recibo completo, firma con el dedo y presiona *Firmar y enviar*. Puede descargar su PDF; el recibo firmado queda guardado y se baja del panel cuando se quiera (botón **PDF**). Un link ya firmado queda en solo lectura.

## Archivos

| Archivo | Qué hace |
|---|---|
| `server.js` | Rutas, sesión de admin, base de datos SQLite y endpoint de extracción |
| `extractor/planillas.py` | Extractor de planillas (Excel/PDF → JSON), tal cual viene del módulo original |
| `extractor/extraer.py` | Envoltura: recibe el archivo por stdin y devuelve el JSON por stdout |
| `planilla.js` | Llama al extractor y traduce su JSON a los campos del recibo (proyecto, período, montos) |
| `recibo.js` | Cálculos, monto en letras, PDF (pdfkit) y HTML del recibo — formato tomado de `Plantilla_Recibo_IPMR.docx` |
| `public/admin.html` | Panel del administrador |
| `public/firma.js`, `public/trabajador.css` | Cuadro de firma y estilos de la página del trabajador |
| `public/firma-autoriza.png` | Firma escaneada del Ing. José Othmaro Morales Urbina |
| `test.js` | Autoverificación (`npm test`): monto en letras, cálculos y que el recibo quepa en una página |

## Correr en local

```bash
npm install
pip install -r extractor/requirements.txt   # openpyxl (Excel) y pdfplumber (PDF)
cp .env.example .env                        # y llenar al menos ADMIN_PASSWORD
npm start                                   # http://localhost:3000/admin
```

Variables de entorno: ver `.env.example`. Si Python no está en el PATH, apuntalo con `PYTHON=` (ruta al ejecutable); sin él la app funciona pero hay que agregar los trabajadores con *+ Agregar fila manual*.

## Desplegar en una PC propia (gratis, recomendado si hay un equipo siempre encendido)

En la PC que queda encendida, con Node 22.13+, Python 3 y Git instalados:

```powershell
powershell -ExecutionPolicy Bypass -File instalar-windows.ps1
```

Descarga el código, instala dependencias, pide la contraseña del panel y registra una tarea programada
que arranca la app con el equipo (escuchando solo en `127.0.0.1`). Después, una sola vez:

```powershell
tailscale funnel --bg 3000
```

Eso publica la app en `https://<equipo>.<tailnet>.ts.net` con HTTPS — esa URL es la del panel y la que
llevan los links de los trabajadores. Guardá de vez en cuando una copia de `dataecibos.db`.

## Desplegar (Render)

`render.yaml` ya está listo: se despliega con el `Dockerfile` (Node + Python, porque el extractor es Python) y un disco de 1 GB montado en `/var/data` (ahí vive `recibos.db`; un plan sin disco pierde los recibos en cada despliegue).

1. Subir este repo a GitHub.
2. En Render: *New → Blueprint*, apuntar al repo.
3. Llenar el secreto `ADMIN_PASSWORD`.
4. Los links quedan como `https://<dominio>/recibo/<token>` — el panel los genera con el dominio desde el que se abre.

Sirve igual en Railway o Fly.io: es un solo proceso Node con un volumen persistente.

## Notas

- Los tokens son de 24 bytes aleatorios (no adivinables) y no requieren login. El panel usa una sola contraseña y cookie firmada (7 días).
- Al firmar se guarda fecha/hora, IP y dispositivo. El PDF se regenera a partir de los datos guardados, que ya no se pueden editar (un recibo firmado no se puede borrar).
- El recibo incluye dos líneas opcionales, `(+) IVA` y `DESCUENTO PERSONAL`, que solo se imprimen cuando la planilla las trae; sin ellas el recibo es idéntico a la plantilla.
- **El total es el de la planilla.** Excel calcula con más decimales de los que imprime (AFP 32.625 se muestra 32.63), así que sumar las líneas impresas puede dar un centavo menos. Por eso los SUB-TOTAL y el TOTAL se toman de las columnas de la planilla (`SALARIO LIQUIDO`, `TOTAL MENOS DESCUENTO`, `TOTAL A PAGAR`) y solo se recalculan si se edita un monto en el panel.
- La lectura de la planilla **no reemplaza la revisión**: si las líneas no llegan al total de la planilla (una columna que el recibo no contempla), la fila sale marcada en amarillo. Revise siempre los montos antes de generar.
- Las columnas cambian de nombre entre hojas (`RENTA` es del salario en unas y de viáticos en otras), por eso `planilla.js` las reparte por posición respecto a la columna de viáticos, no por nombre.
- Proyecto: la hoja que diga CHANGALLO → Changallo, la que diga ITALIA → Italia, el resto → Oficina. Período: "1RA QUINCENA" → 1 al 15, "2DA/2NDA" → 16 al último día del mes.
