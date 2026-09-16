# Recibos de pago firmables — IPMR

App web para emitir los recibos de cada quincena, enviar un link único por trabajador y recibir el recibo firmado por correo.

- **Admin (Jan)**: `/admin` → sube el PDF de la planilla, revisa/edita la lista, genera un recibo y un link por trabajador, y ve el estado (pendiente / firmado).
- **Trabajador**: abre su link `/recibo/<token>` desde el teléfono, ve su recibo completo, firma con el dedo y presiona *Firmar y enviar*. Puede descargar su PDF; el mismo PDF llega automáticamente por correo a `MAIL_TO` (por defecto juantony794@gmail.com). Un link ya firmado queda en solo lectura.

## Archivos

| Archivo | Qué hace |
|---|---|
| `server.js` | Rutas, sesión de admin, base de datos SQLite, correo y extracción con Claude |
| `recibo.js` | Cálculos, monto en letras, PDF (pdfkit) y HTML del recibo — formato tomado de `Plantilla_Recibo_IPMR.docx` |
| `public/admin.html` | Panel del administrador |
| `public/firma.js`, `public/trabajador.css` | Cuadro de firma y estilos de la página del trabajador |
| `public/firma-autoriza.png` | Firma escaneada del Ing. José Othmaro Morales Urbina |
| `test.js` | Autoverificación (`npm test`): monto en letras, cálculos y que el recibo quepa en una página |

## Correr en local

```bash
npm install
cp .env.example .env   # y llenar al menos ADMIN_PASSWORD
npm start              # http://localhost:3000/admin
```

Variables de entorno: ver `.env.example`. Sin `ANTHROPIC_API_KEY` la app funciona, pero hay que agregar los trabajadores con *+ Agregar fila manual*. Sin SMTP los recibos se firman igual y el panel muestra *Falló* con un botón **Reenviar**.

Para Gmail: `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_USER` la cuenta y `SMTP_PASS` una **contraseña de aplicación** (no la contraseña normal).

## Desplegar (Render)

`render.yaml` ya está listo: plan *starter* con disco de 1 GB montado en `/var/data` (ahí vive `recibos.db`; un plan sin disco pierde los recibos en cada despliegue).

1. Subir este repo a GitHub.
2. En Render: *New → Blueprint*, apuntar al repo.
3. Llenar los secretos: `ADMIN_PASSWORD`, `ANTHROPIC_API_KEY`, `SMTP_USER`, `SMTP_PASS`.
4. Los links quedan como `https://<dominio>/recibo/<token>` — el panel los genera con el dominio desde el que se abre.

Sirve igual en Railway o Fly.io: es un solo proceso Node con un volumen persistente.

## Notas

- Los tokens son de 24 bytes aleatorios (no adivinables) y no requieren login. El panel usa una sola contraseña y cookie firmada (7 días).
- Al firmar se guarda fecha/hora, IP y dispositivo. El PDF se regenera a partir de los datos guardados, que ya no se pueden editar (un recibo firmado no se puede borrar).
- La extracción con IA **no reemplaza la revisión**: la planilla trae columnas que el recibo no contempla (IVA, descuento personal) y se ignoran. Revise siempre los montos antes de generar.
