'use strict';

const crypto = require('node:crypto');
const express = require('express');

const COOKIE = 'schrotty_sitzung';
const SITZUNG_TAGE = 30;
const MIN_PASSWORT = 8;
// Schutz gegen Durchprobieren von Passwörtern: max. Fehlversuche pro IP in diesem Zeitfenster
const MAX_FEHLVERSUCHE = 10;
const SPERRFENSTER_MS = 15 * 60 * 1000;

class AuthError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function hashPasswort(passwort, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(passwort, salt, 64).toString('hex');
  return { salt, hash };
}

function passwortStimmt(passwort, salt, hash) {
  const probe = crypto.scryptSync(passwort, salt, 64);
  const soll = Buffer.from(hash, 'hex');
  return probe.length === soll.length && crypto.timingSafeEqual(probe, soll);
}

// Gespeichert wird nur ein Hash des Sitzungs-Tokens, nie das Token selbst.
const tokenHash = (token) => crypto.createHash('sha256').update(token).digest('hex');

function cookiesLesen(header = '') {
  const out = {};
  for (const teil of header.split(';')) {
    const i = teil.indexOf('=');
    if (i > 0) out[teil.slice(0, i).trim()] = decodeURIComponent(teil.slice(i + 1).trim());
  }
  return out;
}

function pruefeZugangsdaten(b, { mitPasswort = true } = {}) {
  const name = typeof b.name === 'string' ? b.name.trim() : '';
  if (!name) throw new AuthError(400, 'Benutzername ist erforderlich');
  if (name.length > 50) throw new AuthError(400, 'Benutzername ist zu lang');
  if (mitPasswort) pruefePasswort(b.passwort);
  return name;
}

function pruefePasswort(p) {
  if (typeof p !== 'string' || p.length < MIN_PASSWORT) {
    throw new AuthError(400, `Passwort muss mindestens ${MIN_PASSWORT} Zeichen haben`);
  }
  if (p.length > 200) throw new AuthError(400, 'Passwort ist zu lang');
}

function createAuth(db) {
  const router = express.Router();
  const fehlversuche = new Map(); // ip -> { anzahl, seit }

  const anzahlBenutzer = () => db.prepare('SELECT COUNT(*) AS n FROM benutzer').get().n;

  function sitzungStarten(req, res, benutzerId) {
    const token = crypto.randomBytes(32).toString('hex');
    const ablauf = new Date(Date.now() + SITZUNG_TAGE * 864e5).toISOString();
    db.prepare('DELETE FROM sitzungen WHERE ablauf < ?').run(new Date().toISOString());
    db.prepare('INSERT INTO sitzungen (token_hash, benutzer_id, ablauf) VALUES (?, ?, ?)').run(
      tokenHash(token),
      benutzerId,
      ablauf
    );
    const teile = [
      `${COOKIE}=${token}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Strict',
      `Max-Age=${SITZUNG_TAGE * 86400}`,
    ];
    if (req.secure) teile.push('Secure');
    res.setHeader('Set-Cookie', teile.join('; '));
  }

  function aktuellerBenutzer(req) {
    const token = cookiesLesen(req.headers.cookie)[COOKIE];
    if (!token) return null;
    return (
      db
        .prepare(
          `SELECT b.id, b.name FROM sitzungen s JOIN benutzer b ON b.id = s.benutzer_id
           WHERE s.token_hash = ? AND s.ablauf > ?`
        )
        .get(tokenHash(token), new Date().toISOString()) || null
    );
  }

  function gesperrt(ip) {
    const e = fehlversuche.get(ip);
    if (!e) return false;
    if (Date.now() - e.seit > SPERRFENSTER_MS) {
      fehlversuche.delete(ip);
      return false;
    }
    return e.anzahl >= MAX_FEHLVERSUCHE;
  }

  function fehlversuch(ip) {
    const e = fehlversuche.get(ip);
    if (!e || Date.now() - e.seit > SPERRFENSTER_MS) fehlversuche.set(ip, { anzahl: 1, seit: Date.now() });
    else e.anzahl++;
  }

  // ---------- öffentlich ----------
  router.get('/status', (req, res) => {
    res.json({ benutzer: aktuellerBenutzer(req), einrichtung_noetig: anzahlBenutzer() === 0 });
  });

  // Erster Zugang: nur möglich, solange noch kein Benutzer existiert.
  router.post('/einrichten', (req, res) => {
    const name = pruefeZugangsdaten(req.body);
    if (anzahlBenutzer() > 0) throw new AuthError(403, 'Die App ist bereits eingerichtet');
    const { salt, hash } = hashPasswort(req.body.passwort);
    const { lastInsertRowid } = db
      .prepare('INSERT INTO benutzer (name, salt, passwort_hash) VALUES (?, ?, ?)')
      .run(name, salt, hash);
    sitzungStarten(req, res, Number(lastInsertRowid));
    res.status(201).json({ benutzer: { id: Number(lastInsertRowid), name } });
  });

  router.post('/anmelden', (req, res) => {
    const ip = req.ip;
    if (gesperrt(ip)) throw new AuthError(429, 'Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen.');
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const passwort = typeof req.body.passwort === 'string' ? req.body.passwort : '';
    const b = db.prepare('SELECT id, name, salt, passwort_hash FROM benutzer WHERE name = ?').get(name);
    if (!b || !passwortStimmt(passwort, b.salt, b.passwort_hash)) {
      fehlversuch(ip);
      throw new AuthError(401, 'Benutzername oder Passwort falsch');
    }
    fehlversuche.delete(ip);
    sitzungStarten(req, res, b.id);
    res.json({ benutzer: { id: b.id, name: b.name } });
  });

  router.post('/abmelden', (req, res) => {
    const token = cookiesLesen(req.headers.cookie)[COOKIE];
    if (token) db.prepare('DELETE FROM sitzungen WHERE token_hash = ?').run(tokenHash(token));
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`);
    res.status(204).end();
  });

  // ---------- Schutz für alles Weitere ----------
  function schutz(req, res, next) {
    const b = aktuellerBenutzer(req);
    if (!b) return res.status(401).json({ fehler: 'Bitte anmelden' });
    req.benutzer = b;
    next();
  }

  // ---------- Benutzerverwaltung (nur angemeldet) ----------
  const verwaltung = express.Router();

  verwaltung.get('/', (req, res) => {
    res.json(db.prepare('SELECT id, name, erstellt_am FROM benutzer ORDER BY name').all());
  });

  verwaltung.post('/', (req, res) => {
    const name = pruefeZugangsdaten(req.body);
    if (db.prepare('SELECT 1 FROM benutzer WHERE name = ?').get(name)) {
      throw new AuthError(400, 'Benutzername ist schon vergeben');
    }
    const { salt, hash } = hashPasswort(req.body.passwort);
    const { lastInsertRowid } = db
      .prepare('INSERT INTO benutzer (name, salt, passwort_hash) VALUES (?, ?, ?)')
      .run(name, salt, hash);
    res.status(201).json({ id: Number(lastInsertRowid), name });
  });

  verwaltung.put('/:id/passwort', (req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM benutzer WHERE id = ?').get(id)) throw new AuthError(404, 'Nicht gefunden');
    pruefePasswort(req.body.passwort);
    const { salt, hash } = hashPasswort(req.body.passwort);
    db.prepare('UPDATE benutzer SET salt = ?, passwort_hash = ? WHERE id = ?').run(salt, hash, id);
    // Andere Sitzungen dieses Benutzers beenden (die eigene bleibt bestehen)
    const eigenes = tokenHash(cookiesLesen(req.headers.cookie)[COOKIE] || '');
    db.prepare('DELETE FROM sitzungen WHERE benutzer_id = ? AND token_hash != ?').run(id, eigenes);
    res.status(204).end();
  });

  verwaltung.delete('/:id', (req, res) => {
    const id = Number(req.params.id);
    if (id === req.benutzer.id) throw new AuthError(400, 'Den eigenen Zugang kann man nicht löschen');
    const r = db.prepare('DELETE FROM benutzer WHERE id = ?').run(id);
    if (r.changes === 0) throw new AuthError(404, 'Nicht gefunden');
    res.status(204).end();
  });

  return { router, schutz, verwaltung };
}

module.exports = { createAuth, AuthError };
