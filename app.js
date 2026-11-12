const form = document.getElementById('form');
const video = document.getElementById('video');
const logEl = document.getElementById('log');

const log = (msg) => { logEl.textContent = `[${new Date().toLocaleTimeString()}] ${msg}\n${logEl.textContent}`; };

function params() {
  const data = new FormData(form);
  const p = new URLSearchParams({ channel: data.get('channel'), mode: data.get('mode') });
  if (data.get('mode') === 'playback') {
    p.set('start', data.get('start') || '');
    if (data.get('end')) p.set('end', data.get('end'));
  }
  if (data.get('transcode')) p.set('transcode', '1');
  return p;
}

function syncMode() {
  const playback = form.mode.value === 'playback';
  form.start.disabled = form.end.disabled = !playback;
  if (playback && !form.start.value) {
    const d = new Date(Date.now() - 60 * 60 * 1000);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    form.start.value = d.toISOString().slice(0, 19);  // hora local del navegador
  }
}

function syncTranscode() {
  form.transcode.checked = form.channel.value.startsWith('1');
}

function stop() {
  video.pause();
  video.removeAttribute('src');
  video.load();
}

form.addEventListener('change', (e) => {
  if (e.target.name === 'mode') syncMode();
  if (e.target.name === 'channel') syncTranscode();
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  stop();
  const p = params();
  if (p.get('mode') === 'playback' && !p.get('start')) return log('Elegí una fecha de inicio.');
  const src = `/stream?${p}`;
  log(`Pidiendo ${src}`);
  video.src = src;
  try { await video.play(); } catch { /* autoplay lo maneja el atributo */ }
});

document.getElementById('probe').addEventListener('click', async () => {
  const p = params();
  log(`ffprobe ${p}… (hasta 25 s)`);
  const res = await fetch(`/probe?${p}`);
  const body = await res.json();
  log(`${res.ok ? 'OK' : 'ERROR'} ${JSON.stringify(body, null, 2)}`);
});

document.getElementById('recordings').addEventListener('click', async () => {
  const day = (form.start.value || new Date().toISOString()).slice(0, 10);
  const q = new URLSearchParams({ channel: form.channel.value, from: `${day}T00:00:00`, to: `${day}T23:59:59` });
  log(`Buscando grabaciones del ${day}…`);
  const res = await fetch(`/recordings?${q}`);
  const body = await res.json();
  if (!res.ok) return log(`ERROR ${body.error}`);
  const list = document.getElementById('segList');
  list.replaceChildren();
  for (const s of body.segments) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = `${s.start.slice(11)} → ${s.end.slice(11)}  (${Math.floor(s.seconds / 60)}m ${s.seconds % 60}s)`;
    btn.addEventListener('click', () => {
      form.mode.value = 'playback';
      syncMode();
      form.start.value = s.start;
      form.end.value = s.end;
      form.requestSubmit();
    });
    li.append(btn);
    list.append(li);
  }
  document.getElementById('segments').hidden = !body.segments.length;
  log(`${body.segments.length} segmentos el ${day}. Click en uno para reproducirlo.`);
});

document.getElementById('stop').addEventListener('click', () => { stop(); log('Detenido.'); });

video.addEventListener('playing', () => log(`Reproduciendo (${video.videoWidth}x${video.videoHeight}).`));
video.addEventListener('error', async () => {
  if (!video.getAttribute('src')) return;
  const code = video.error?.code;
  let detail = '';
  try {
    const res = await fetch(video.src, { method: 'GET' });
    if (!res.ok) detail = JSON.stringify(await res.json());
    else res.body?.cancel();
  } catch { /* sin detalle */ }
  log(`Error de video (code ${code}). ${detail || 'Si el canal es HEVC, activá "Transcodificar".'}`);
});

syncMode();
syncTranscode();
