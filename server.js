'use strict';

// ---------------------------------------------------------------
//  Video-Upscaler Server
//  Login -> Upload -> ffmpeg im Hintergrund -> Download
// ---------------------------------------------------------------

const express = require('express');
const multer = require('multer');
const cookieSession = require('cookie-session');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------- Einstellungen (kommen aus den Railway-Variablen) ----
const PORT = parseInt(process.env.PORT || '3000', 10);
const APP_USER = process.env.APP_USER;
const APP_PASS = process.env.APP_PASS;
const SESSION_SECRET = process.env.SESSION_SECRET;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const MAX_UPLOAD_MB = parseInt(process.env.MAX_UPLOAD_MB || '4000', 10);
const KEEP_HOURS = parseInt(process.env.KEEP_HOURS || '24', 10);
const SESSION_DAYS = parseInt(process.env.SESSION_DAYS || '30', 10);

if (!APP_USER || !APP_PASS || !SESSION_SECRET) {
  console.error('FEHLER: Die Variablen APP_USER, APP_PASS und SESSION_SECRET muessen gesetzt sein.');
  process.exit(1);
}

const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const OUTPUT_DIR = path.join(DATA_DIR, 'outputs');
const JOBS_FILE = path.join(DATA_DIR, 'jobs.json');
for (const d of [UPLOAD_DIR, OUTPUT_DIR]) fs.mkdirSync(d, { recursive: true });

// ---------- Jobs (Auftraege) ------------------------------------
// Ein Job = ein hochgeladenes Video mit Status und Fortschritt.
let jobs = new Map();

function loadJobs() {
  try {
    const raw = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8'));
    for (const j of raw) {
      // Was beim letzten Neustart mitten im Lauf war, ist verloren
      if (j.status === 'processing' || j.status === 'queued') {
        j.status = 'error';
        j.error = 'Server wurde neu gestartet. Bitte erneut hochladen.';
      }
      if (j.status === 'done' && !(j.output && fs.existsSync(j.output))) {
        continue; // Ausgabedatei weg -> Job weg
      }
      jobs.set(j.id, j);
    }
  } catch (_) { /* noch keine Datei, ist ok */ }
}

function saveJobs() {
  try {
    fs.writeFileSync(JOBS_FILE, JSON.stringify([...jobs.values()], null, 1));
  } catch (e) {
    console.error('jobs.json konnte nicht geschrieben werden:', e.message);
  }
}

loadJobs();

function publicJob(j) {
  return {
    id: j.id,
    name: j.name,
    status: j.status,
    progress: j.progress || 0,
    created: j.created,
    error: j.error || null,
    info: j.info || null,
    outName: j.outName || null,
    outSize: j.outSize || null,
  };
}

// ---------- ffprobe: Video vermessen -----------------------------
function probe(file) {
  return new Promise((resolve, reject) => {
    execFile('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,r_frame_rate:format=duration',
      '-of', 'json', file,
    ], (err, stdout) => {
      if (err) return reject(new Error('Datei ist kein lesbares Video.'));
      try {
        const d = JSON.parse(stdout);
        const s = d.streams && d.streams[0];
        if (!s) throw new Error();
        const [n, den] = String(s.r_frame_rate || '25/1').split('/').map(Number);
        resolve({
          width: s.width,
          height: s.height,
          fps: den ? +(n / den).toFixed(2) : 25,
          duration: parseFloat(d.format && d.format.duration) || 0,
        });
      } catch (_) {
        reject(new Error('Video konnte nicht analysiert werden.'));
      }
    });
  });
}

// ---------- Zielaufloesung berechnen -----------------------------
// mode: "max" = so weit es geht (2x, hoechstens 4K)
//       "1080" = auf Full HD
//       "2x"   = doppelt, ohne Obergrenze
function planTarget(info, mode) {
  const w = info.width, h = info.height;
  const long = Math.max(w, h), short = Math.min(w, h);
  let scale;

  if (mode === '1080') {
    scale = Math.min(1920 / long, 1080 / short);
  } else if (mode === '2x') {
    scale = 2;
  } else {
    scale = Math.min(2, 3840 / long, 2160 / short);
  }

  // Wenn das Original schon gross genug ist: nur nachschaerfen
  if (scale < 1.05) scale = 1;

  const even = (n) => Math.max(2, Math.round(n / 2) * 2);
  return { width: even(w * scale), height: even(h * scale), scale: +scale.toFixed(2) };
}

// ---------- ffmpeg: die eigentliche Arbeit ------------------------
function runFfmpeg(job) {
  return new Promise((resolve, reject) => {
    const t = job.target;
    const filters = [];
    if (job.denoise) filters.push('hqdn3d=2:1:2:3');
    if (t.scale !== 1) filters.push(`scale=${t.width}:${t.height}:flags=lanczos`);
    filters.push('unsharp=5:5:0.7:5:5:0.0');

    const args = [
      '-hide_banner', '-y', '-nostdin',
      '-i', job.input,
      '-vf', filters.join(','),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '160k',
      '-movflags', '+faststart',
      '-progress', 'pipe:1', '-nostats',
      job.output,
    ];

    const p = spawn('ffmpeg', args);
    let stderrTail = '';
    let buf = '';

    p.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        const m = /^out_time_us=(\d+)/.exec(line) || /^out_time_ms=(\d+)/.exec(line);
        if (m && job.info.duration > 0) {
          const sec = parseInt(m[1], 10) / 1e6;
          job.progress = Math.min(99, Math.round((sec / job.info.duration) * 100));
        }
      }
    });
    p.stderr.on('data', (c) => { stderrTail = (stderrTail + c.toString()).slice(-1500); });
    p.on('error', (e) => reject(new Error('ffmpeg konnte nicht gestartet werden: ' + e.message)));
    p.on('close', (code) => {
      if (code === 0) return resolve();
      console.error('ffmpeg stderr:', stderrTail);
      reject(new Error('ffmpeg ist abgebrochen (Code ' + code + ').'));
    });
  });
}

// ---------- Warteschlange: ein Video nach dem anderen -------------
let working = false;

async function pump() {
  if (working) return;
  const next = [...jobs.values()].find((j) => j.status === 'queued');
  if (!next) return;
  working = true;

  next.status = 'processing';
  next.progress = 0;
  saveJobs();

  try {
    await runFfmpeg(next);
    next.status = 'done';
    next.progress = 100;
    next.outSize = fs.statSync(next.output).size;
    next.finished = Date.now();
  } catch (e) {
    next.status = 'error';
    next.error = e.message;
    try { fs.unlinkSync(next.output); } catch (_) {}
  } finally {
    try { fs.unlinkSync(next.input); } catch (_) {}
    next.input = null;
    saveJobs();
    working = false;
    setImmediate(pump);
  }
}

// ---------- Aufraeumen: alte Ergebnisse loeschen -----------------
function cleanup() {
  const limit = Date.now() - KEEP_HOURS * 3600 * 1000;
  let changed = false;
  for (const j of [...jobs.values()]) {
    const ts = j.finished || j.created;
    if ((j.status === 'done' || j.status === 'error') && ts < limit) {
      for (const f of [j.output, j.input]) {
        if (f) { try { fs.unlinkSync(f); } catch (_) {} }
      }
      jobs.delete(j.id);
      changed = true;
    }
  }
  if (changed) saveJobs();
}
setInterval(cleanup, 60 * 60 * 1000);
cleanup();

// ---------- Login-Schutz -------------------------------------------
const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(cookieSession({
  name: 'upscaler',
  keys: [SESSION_SECRET],
  maxAge: SESSION_DAYS * 24 * 3600 * 1000,
  httpOnly: true,
  sameSite: 'lax',
}));
app.use(express.json({ limit: '10kb' }));

// Bremse gegen Passwort-Raten: 5 Fehlversuche -> 15 Minuten Sperre
const failures = new Map();
function locked(ip) {
  const f = failures.get(ip);
  return f && f.count >= 5 && Date.now() - f.last < 15 * 60 * 1000;
}
function noteFailure(ip) {
  const f = failures.get(ip) || { count: 0, last: 0 };
  if (Date.now() - f.last > 15 * 60 * 1000) f.count = 0;
  f.count += 1;
  f.last = Date.now();
  failures.set(ip, f);
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function requireAuth(req, res, next) {
  if (req.session && req.session.user === APP_USER) return next();
  res.status(401).json({ error: 'Nicht eingeloggt.' });
}

app.post('/api/login', (req, res) => {
  const ip = req.ip;
  if (locked(ip)) {
    return res.status(429).json({ error: 'Zu viele Fehlversuche. 15 Minuten warten.' });
  }
  const { username, password } = req.body || {};
  if (safeEqual(username, APP_USER) && safeEqual(password, APP_PASS)) {
    failures.delete(ip);
    req.session.user = APP_USER;
    return res.json({ ok: true, user: APP_USER });
  }
  noteFailure(ip);
  res.status(401).json({ error: 'Benutzername oder Passwort falsch.' });
});

app.post('/api/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  if (req.session && req.session.user === APP_USER) return res.json({ user: APP_USER });
  res.status(401).json({ user: null });
});

// ---------- Upload -------------------------------------------------
const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => {
      const ext = (path.extname(file.originalname) || '.mp4').toLowerCase().slice(0, 8);
      cb(null, crypto.randomBytes(8).toString('hex') + ext);
    },
  }),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
});

app.post('/api/upload', requireAuth, (req, res) => {
  upload.single('video')(req, res, async (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE'
        ? `Datei zu gross (maximal ${MAX_UPLOAD_MB} MB).`
        : 'Upload fehlgeschlagen: ' + err.message;
      return res.status(400).json({ error: msg });
    }
    if (!req.file) return res.status(400).json({ error: 'Keine Datei erhalten.' });

    let info;
    try {
      info = await probe(req.file.path);
    } catch (e) {
      try { fs.unlinkSync(req.file.path); } catch (_) {}
      return res.status(400).json({ error: e.message });
    }

    const mode = ['max', '1080', '2x'].includes(req.body.mode) ? req.body.mode : 'max';
    const target = planTarget(info, mode);
    const id = crypto.randomBytes(6).toString('hex');
    const base = path.parse(req.file.originalname).name.replace(/[^\w.\-äöüÄÖÜß ]+/g, '_').slice(0, 60) || 'video';
    const outName = `${base}_${target.width}x${target.height}.mp4`;

    const job = {
      id,
      name: req.file.originalname,
      status: 'queued',
      progress: 0,
      created: Date.now(),
      input: req.file.path,
      output: path.join(OUTPUT_DIR, `${id}.mp4`),
      outName,
      denoise: req.body.denoise === '1',
      info: { ...info, target },
      target,
    };
    jobs.set(id, job);
    saveJobs();
    pump();
    res.json(publicJob(job));
  });
});

// ---------- Status, Liste, Loeschen ---------------------------------
app.get('/api/jobs', requireAuth, (_req, res) => {
  const list = [...jobs.values()].sort((a, b) => b.created - a.created).map(publicJob);
  res.json(list);
});

app.get('/api/jobs/:id', requireAuth, (req, res) => {
  const j = jobs.get(req.params.id);
  if (!j) return res.status(404).json({ error: 'Unbekannter Auftrag.' });
  res.json(publicJob(j));
});

app.delete('/api/jobs/:id', requireAuth, (req, res) => {
  const j = jobs.get(req.params.id);
  if (!j) return res.status(404).json({ error: 'Unbekannter Auftrag.' });
  if (j.status === 'processing') return res.status(409).json({ error: 'Laeuft gerade noch.' });
  for (const f of [j.output, j.input]) {
    if (f) { try { fs.unlinkSync(f); } catch (_) {} }
  }
  jobs.delete(j.id);
  saveJobs();
  res.json({ ok: true });
});

// ---------- Download -----------------------------------------------
app.get('/download/:id', requireAuth, (req, res) => {
  const j = jobs.get(req.params.id);
  if (!j || j.status !== 'done' || !fs.existsSync(j.output)) {
    return res.status(404).send('Datei nicht (mehr) vorhanden.');
  }
  res.download(j.output, j.outName);
});

// ---------- Statische Seite -----------------------------------------
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

app.listen(PORT, () => {
  console.log(`Upscaler laeuft auf Port ${PORT}, Daten in ${DATA_DIR}`);
});
