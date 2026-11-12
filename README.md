# PoC RTSP Hikvision

Puente RTSP → MP4 fragmentado para reproducir video de cámaras Hikvision en un `<video>` del navegador.

## Requisitos

- Node.js 20 o superior.
- `ffmpeg` y `ffprobe` instalados.
  - Si están en `PATH`, no hace falta configurar nada.
  - Si no, definir `FFMPEG` y `FFPROBE` en `.env`.

## Configuración

1. Copiar `.env.example` como `.env`.
2. Completar las variables:

```env
CAM_USER=usuario_camara
CAM_PASS=password_camara
CAM_HOST=host:554
PORT=3100
TZ_OFFSET_MIN=-180
```

Variables opcionales:

```env
CAM_HTTP_PORT=80
FFMPEG=C:/ffmpeg/bin/ffmpeg.exe
FFPROBE=C:/ffmpeg/bin/ffprobe.exe
```

> No commitear `.env`: contiene credenciales de la cámara.

## Levantar el proyecto

Desde PowerShell:

```powershell
cd F:\kaizen\canchas3\contexto\poc-rtsp
node server.js
```

Si todo está bien, se muestra:

```text
PoC RTSP en http://localhost:3100
```

Abrir en el navegador:

```text
http://localhost:3100
```

No hace falta `npm install`; el proyecto no usa dependencias externas.

## Uso

En la página principal se puede:

- Elegir canal:
  - `101`: cámara 1 principal
  - `102`: cámara 1 secundario
  - `201`: cámara 2 principal
  - `202`: cámara 2 secundario
- Reproducir **En vivo**.
- Reproducir **Grabación** indicando fecha/hora de inicio y fin opcional.
- Buscar grabaciones del día con **Buscar grabaciones**.
- Probar conectividad/codec con **Probar (ffprobe)**.
- Activar **Transcodificar a H.264 1080p** cuando el canal use HEVC/H.265 o el navegador no reproduzca el stream original.

## Endpoints internos

- `GET /` → interfaz web.
- `GET /probe?channel=101&mode=live` → ejecuta `ffprobe`.
- `GET /stream?channel=101&mode=live` → stream en vivo.
- `GET /stream?channel=101&mode=playback&start=2026-11-05T10:00` → reproducción grabada.
- `GET /recordings?channel=101&from=2026-11-05T00:00:00&to=2026-11-05T23:59:59` → segmentos grabados vía ISAPI.

## Troubleshooting

- `Faltan variables CAM_USER, CAM_PASS, CAM_HOST`: falta `.env` o está incompleto.
- `No se pudo ejecutar ffmpeg`: `ffmpeg` no está instalado o no está en `PATH`.
- Video no inicia en canal 1: probar activar **Transcodificar**.
- Error `502` en `/probe` o `/stream`: revisar host, puerto RTSP, usuario, password y conectividad con la cámara.
- Si la cámara responde `401/403`: validar credenciales y permisos del usuario.
