// PoC: puente RTSP (Hikvision) -> MP4 fragmentado para <video> del navegador.
// Uso: CAM_USER=... CAM_PASS=... CAM_HOST=host:554 node poc-rtsp/server.js
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFile } = require('node:child_process');

const PORT = Number(process.env.PORT || 3100);
// Carga .env local sin dependencia externa (Node.js 20+).
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=\s]+)\s*=\s*(.*?)\s*$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].replace(/^['\"]|['\"]$/g, '');
  }
}

const { CAM_USER, CAM_PASS, CAM_HOST } = process.env;
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FFPROBE = process.env.FFPROBE || 'ffprobe';
if (!CAM_USER || !CAM_PASS || !CAM_HOST) {
  console.error('Faltan variables CAM_USER, CAM_PASS, CAM_HOST (ej. host.ejemplo.com:554)');
  process.exit(1);
}

const HTTP_HOST = CAM_HOST.split(':')[0];
const HTTP_PORT = process.env.CAM_HTTP_PORT || '80';
// Minutos de diferencia de la hora local respecto de UTC (Argentina = -180).
const TZ_OFFSET_MIN = Number(process.env.TZ_OFFSET_MIN ?? -180);
const CHANNELS = new Set(['101', '102', '201', '202']);
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const files = { '/': 'index.html', '/styles.css': 'styles.css', '/app.js': 'app.js' };
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8' };

const pad = (n) => String(n).padStart(2, '0');

// Hora local escrita en la página ("2026-11-05T10:00") -> Date en UTC real.
function localToDate(value) {
  const m = DATE_RE.exec(value || '');
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) - TZ_OFFSET_MIN * 60000);
}
// Date UTC -> "20261105T120000Z" (la Z de la cámara es UTC real).
const toHik = (d) => d.toISOString().slice(0, 19).replace(/[-:]/g, '') + 'Z';
// Date UTC -> hora local "2026-11-05T09:00:00" para mostrar/volver a la página.
const toLocalStr = (d) => new Date(d.getTime() + TZ_OFFSET_MIN * 60000).toISOString().slice(0, 19);

function buildUrl(params) {
  const channel = params.get('channel');
  if (!CHANNELS.has(channel)) throw new Error('Canal inválido');
  const auth = `${encodeURIComponent(CAM_USER)}:${encodeURIComponent(CAM_PASS)}`;
  const base = `rtsp://${auth}@${CAM_HOST}/Streaming`;
  if (params.get('mode') !== 'playback') return `${base}/Channels/${channel}`;
  const start = localToDate(params.get('start'));
  if (!start) throw new Error('Fecha de inicio inválida');
  let url = `${base}/tracks/${channel}?starttime=${toHik(start)}`;
  if (params.get('end')) {
    const end = localToDate(params.get('end'));
    if (!end || end <= start) throw new Error('Fecha de fin inválida');
    url += `&endtime=${toHik(end)}`;
  }
  return url;
}

const mask = (url) => url.replace(/\/\/[^@]+@/, '//***:***@');

// --- ISAPI (HTTP con autenticación digest) ---
async function isapi(pathname, xmlBody) {
  const url = `http://${HTTP_HOST}:${HTTP_PORT}${pathname}`;
  const opts = { method: xmlBody ? 'POST' : 'GET', body: xmlBody, headers: xmlBody ? { 'Content-Type': 'application/xml' } : {}, signal: AbortSignal.timeout(15000) };
  let res = await fetch(url, opts);
  if (res.status === 401) {
    const h = res.headers.get('www-authenticate') || '';
    const get = (k) => (new RegExp(`${k}="([^"]*)"`).exec(h) || [])[1];
    const md5 = (v) => crypto.createHash('md5').update(v).digest('hex');
    const realm = get('realm'), nonce = get('nonce'), qop = (get('qop') || '').split(',')[0].trim();
    const cnonce = crypto.randomBytes(8).toString('hex'), nc = '00000001';
    const uri = new URL(url).pathname;
    const ha1 = md5(`${CAM_USER}:${realm}:${CAM_PASS}`), ha2 = md5(`${opts.method}:${uri}`);
    const response = qop ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${nonce}:${ha2}`);
    let auth = `Digest username="${CAM_USER}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}"`;
    if (qop) auth += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
    res = await fetch(url, { ...opts, signal: AbortSignal.timeout(15000), headers: { ...opts.headers, Authorization: auth } });
  }
  if (!res.ok) throw new Error(`La cámara respondió ${res.status} en ${pathname}`);
  return res.text();
}

async function listRecordings(channel, from, to) {
  const segs = new Map();
  for (let pos = 0; pos < 1000; pos += 100) {
    const xml = await isapi('/ISAPI/ContentMgmt/search', `<CMSearchDescription><searchID>poc-${Date.now()}</searchID><trackList><trackID>${channel}</trackID></trackList><timeSpanList><timeSpan><startTime>${from.toISOString().slice(0, 19)}Z</startTime><endTime>${to.toISOString().slice(0, 19)}Z</endTime></timeSpan></timeSpanList><maxResults>100</maxResults><searchResultPostion>${pos}</searchResultPostion><metadataList><metadataDescriptor>//recordType.meta.std-cgi.com</metadataDescriptor></metadataList></CMSearchDescription>`);
    for (const m of xml.matchAll(/<startTime>([^<]*)<\/startTime>\s*<endTime>([^<]*)<\/endTime>/g)) {
      const a = new Date(m[1]), b = new Date(m[2]);
      if (!isNaN(a) && !isNaN(b)) segs.set(m[1], { start: toLocalStr(a), end: toLocalStr(b), seconds: Math.round((b - a) / 1000) });
    }
    if (!/<responseStatusStrg>MORE</.test(xml)) break;
  }
  return [...segs.values()].sort((x, y) => x.start.localeCompare(y.start));
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (files[url.pathname]) {
    const file = path.join(__dirname, files[url.pathname]);
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] });
    return fs.createReadStream(file).pipe(res);
  }

  if (url.pathname === '/recordings') {
    const channel = url.searchParams.get('channel');
    const from = localToDate(url.searchParams.get('from')), to = localToDate(url.searchParams.get('to'));
    if (!CHANNELS.has(channel) || !from || !to || to <= from) return sendJson(res, 400, { error: 'Parámetros inválidos' });
    return listRecordings(channel, from, to)
      .then((segments) => sendJson(res, 200, { channel, segments }))
      .catch((e) => sendJson(res, 502, { error: e.message }));
  }

  let rtsp;
  if (url.pathname === '/stream' || url.pathname === '/probe') {
    try { rtsp = buildUrl(url.searchParams); } catch (e) { return sendJson(res, 400, { error: e.message }); }
  }

  if (url.pathname === '/probe') {
    const args = ['-v', 'error', '-rtsp_transport', 'tcp', '-timeout', '15000000',
      '-show_entries', 'stream=codec_type,codec_name,width,height,r_frame_rate', '-of', 'json', rtsp];
    return execFile(FFPROBE, args, { timeout: 25000 }, (err, stdout, stderr) => {
      if (err) return sendJson(res, 502, { url: mask(rtsp), error: (stderr || err.message).replace(rtsp, mask(rtsp)).trim() });
      sendJson(res, 200, { url: mask(rtsp), ...JSON.parse(stdout) });
    });
  }

  if (url.pathname === '/stream') {
    const transcode = url.searchParams.get('transcode') === '1';
    const video = transcode
      ? ['-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency', '-vf', 'scale=1920:-2:flags=fast_bilinear', '-maxrate', '4M', '-bufsize', '4M', '-g', '50']
      : ['-c:v', 'copy'];
    const args = ['-hide_banner', '-loglevel', 'error', '-rtsp_transport', 'tcp', '-timeout', '15000000', '-i', rtsp,
      ...video, '-c:a', 'aac', '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', 'pipe:1'];
    console.log(`[stream] ${mask(rtsp)} transcode=${transcode}`);
    const ff = spawn(FFMPEG, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let errText = '';
    let started = false;
    ff.stderr.on('data', (d) => { errText += d; console.error(`[ffmpeg] ${String(d).replace(rtsp, mask(rtsp)).trim()}`); });
    ff.stdout.once('data', () => {
      started = true;
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store' });
    });
    ff.stdout.on('data', (chunk) => res.write(chunk));
    ff.on('close', (code) => {
      if (!started) return sendJson(res, 502, { url: mask(rtsp), error: errText.replace(rtsp, mask(rtsp)).trim() || `ffmpeg salió con código ${code}` });
      res.end();
    });
    ff.on('error', (e) => { if (!started) sendJson(res, 500, { error: `No se pudo ejecutar ffmpeg: ${e.message}` }); });
    req.on('close', () => ff.kill('SIGKILL'));
    return;
  }

  res.writeHead(404);
  res.end();
}).listen(PORT, () => console.log(`PoC RTSP en http://localhost:${PORT}`));
