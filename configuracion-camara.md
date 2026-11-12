# Configuración de la cámara para ver el vivo sin cortes

**Sobre la cámara en vivo:**

Probamos la conexión de punta a punta y la parte técnica funciona: nos conectamos a la cámara, las credenciales y los puertos están bien, y el video llega estable. Lo que hace que se entrecorte es el peso de la señal que está transmitiendo hoy la cámara, que es muy alto para verlo por internet. Se arregla con una configuración en la cámara, sin tocar la plataforma.

## Lo que medimos (canal principal, el 101)

- Resolución 7168×2160 (panorámica).
- Códec H.265 (HEVC).
- 20 fotogramas por segundo.
- Unos 7,5 Mbps sostenidos, o sea que la conexión de internet del predio tiene que **subir 7,5 Mbps constantes por cada persona que mire**.
- Un fotograma clave cada ~3,3 segundos.

Además, la mayoría de los navegadores y celulares no logran reproducir H.265 a esa resolución sin trabarse.

## Lo que habría que configurar

Entrando a la web de la cámara o del grabador, en Configuración → Video/Audio. El "sub-stream" (canal 102) hoy no está usable. Habría que dejarlo así:

| Parámetro | Valor |
|---|---|
| Stream Type | Sub-stream |
| Códec de video | **H.264** |
| Resolución | **1280×720** (o 1920×1080 como máximo) |
| Frame rate | **15 fps** |
| Tipo de bitrate | **Constante (CBR)** |
| Bitrate máximo | **1024 a 2048 Kbps** |
| I-Frame Interval | **15 a 25** (un fotograma clave por segundo) |
| Audio | AAC (opcional) |

Con eso el consumo baja de ~7,5 a ~1–2 Mbps, unas cuatro veces menos, y se reproduce en cualquier navegador y celular. Después nosotros pasamos la plataforma a usar ese canal para el vivo.

## Dos cosas más para confirmar de su lado

1. Que la conexión del predio tenga **al menos 10 Mbps de subida** (no de bajada). Se puede medir con speedtest.net desde la red de las cámaras. Si hay varios espectadores a la vez, se necesita más.
2. Que el **puerto 554 (RTSP)** siga redirigido hacia la cámara o el grabador, y que el usuario de la cámara tenga permiso de visualización en vivo.

Cuando lo dejen configurado nos avisan y repetimos la prueba para confirmar que quedó fluido.

## Qué es cada canal

El número combina **cámara + tipo de stream**: la primera cifra es la cámara y la última indica principal (01) o secundario (02).

| Canal | En la maqueta | Medido |
|---|---|---|
| **101** | 1 · gran angular (principal) | H.265, 7168×2160, 20 fps, ~7,5 Mbps. No se reproduce directo en el navegador. |
| **102** | 1 · gran angular (secundario) | Sin señal utilizable hoy. Hay que configurarlo. |
| **201** | 2 · corto (principal) | H.264, 1920×1080, 30 fps. Compatible con cualquier navegador. |
| **202** | 2 · corto (secundario) | Sin señal utilizable hoy. Hay que configurarlo. |

- **Principal (x01):** máxima calidad, es el que se graba.
- **Secundario (x02):** señal reducida y configurable aparte, pensada para ver en vivo por internet.

## Cómo reproduce hoy la plataforma

- **Canal 2 (201):** el video del H.264 pasa tal cual, sin procesar. Es el camino liviano.
- **Canal 1 (101):** como es H.265 a 7168×2160, la plataforma lo **convierte en el servidor** a H.264 1080p. Esa conversión consume mucho procesador. En una PC potente (16 núcleos) alcanza justo el tiempo real, y en un servidor chico probablemente no, y se entrecorta.

**Conclusión:** para ver en vivo conviene que el servidor no tenga que convertir nada. Dejando el secundario del canal 1 (102) en H.264 a 720p o 1080p y 1–2 Mbps, se puede mostrar directo y fluido. Si se quiere la mejor calidad posible, el canal 201 ya sirve en 1080p sin conversión, pero cada canal pesa unos 4 a 8 Mbps de subida por espectador.

---

# Notas internas (no enviar al cliente)

## Diagnóstico: el corte viene de la red del predio

- Se decodificaron 25 s de cada canal directo desde la cámara, sin pasar por nuestro servidor.
- Los dos llegan con datos dañados: el **101 (H.265)** dio 329 líneas de error y el **201 (H.264)** dio 135 (`corrupt decoded frame`, `error while decoding MB`, `Skipping invalid NALU`).
- Que pase con ambos códecs lo ubica antes del servidor y de la plataforma: subida del predio, router o reenvío de puertos, o el equipo de la cámara.
- Una prueba anterior con `-c copy` no mostraba errores porque ese modo no decodifica.
- El `ping` a la IP no responde. Es normal (ICMP bloqueado) y no sirve para medir.

## Ajuste hecho en server.js (sin commit ni deploy)

En el transcode del canal 1 se cambió el escalado a `scale=1920:-2:flags=fast_bilinear` y se agregó `-maxrate 4M -bufsize 4M`.

- Baja el CPU ~35 % (de 11,3 s a 7,4 s por cada 15 s de video, medido con `ffmpeg -benchmark`).
- La sintaxis está verificada y la salida sigue siendo H.264 de 1920 de ancho.
- No se probó reproduciendo en un navegador ni en Coolify.

## Qué canal reproducir en la maqueta

| Momento | Canal | Motivo |
|---|---|---|
| Demo ahora | **201** (2 · corto, principal), con "Transcodificar" desmarcado | Ya es H.264 1080p 30 fps, se reproduce directo. Muestra solo una parte de la cancha. |
| Producto | **102** (1 · gran angular, secundario) | Muestra toda la cancha a poco peso. Hoy sin señal: el predio debe configurarlo. |
| Evitar en vivo | **101** (gran angular, principal) | HEVC 7168×2160 a ~7,5 Mbps, obliga a convertir en el servidor. Dejarlo para grabar. |

Pendiente en `app.js`: la maqueta tilda "Transcodificar" sola para los canales que empiezan con 1. Cuando el 102 esté configurado en H.264, hay que cambiar esa regla.

## Preguntas para el predio

1. Velocidad de **subida** de internet (speedtest.net desde la red de las cámaras) y tipo de conexión (fibra, cable, radioenlace).
2. Si hay otros usos de internet en simultáneo que compartan esa salida (otras cámaras, reservas, wifi de clientes).
3. Marca, modelo y firmware del equipo, y si hay un grabador (NVR/DVR) de por medio.
4. Cómo está expuesta la cámara: redirección de puertos 554 (video) y 80 (gestión), y cuántas personas o cámaras miran a la vez.
5. Captura de Configuración → Video/Audio de los canales 1 y 2 (principal y secundario).
6. Dejar el sub-stream de la cámara 1 en H.264, 1280×720, 15 fps, 1–2 Mbps (CBR) e I-Frame de 15–25, o dar acceso temporal para hacerlo.
7. Si el proveedor de internet da IP pública o usa CGNAT, y si el DynDNS está actualizado.
8. Permiso para pruebas de carga sostenida en un horario sin partidos.

Las más importantes son la 1, la 3 y la 5.

## Próximos pasos

1. El predio configura el sub-stream (102) y mide la subida.
2. Repetir la prueba de errores de decodificación sobre el 102 (debería dar casi cero).
3. Ajustar `app.js` para no transcodificar el 102.
4. Confirmar en el navegador, con el CPU del contenedor a la vista en Coolify.
