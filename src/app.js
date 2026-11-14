'use strict';

const path = require('node:path');
const express = require('express');
const { createAuth, AuthError } = require('./auth');

const AUFTRAG_TYPEN = ['Abholung', 'Ankauf', 'Entrümpelung', 'Containerdienst', 'Sonstiges'];
const AUFTRAG_STATUS = ['offen', 'geplant', 'erledigt', 'storniert'];

class ValidationError extends Error {}

const text = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());

function zahl(v, feld, { min = -Infinity, exklusiv = false } = {}) {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  if (v === '' || v === null || v === undefined || !Number.isFinite(n)) {
    throw new ValidationError(`${feld} muss eine Zahl sein`);
  }
  if (exklusiv ? n <= min : n < min) {
    throw new ValidationError(`${feld} muss ${exklusiv ? 'größer als' : 'mindestens'} ${min} sein`);
  }
  return n;
}

function optId(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new ValidationError('Ungültige ID');
  return n;
}

const runde2 = (n) => Math.round(n * 100) / 100;

function createApp(db) {
  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'public')));

  // Schutz gegen Cross-Site-Requests: Ändernde Anfragen müssen JSON senden.
  // Ein fremdes HTML-Formular kann das nicht, zusammen mit SameSite=Strict-Cookies.
  app.use('/api', (req, res, next) => {
    const typ = (req.headers['content-type'] || '').toLowerCase();
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !typ.startsWith('application/json')) {
      return res.status(415).json({ fehler: 'Anfrage muss JSON sein' });
    }
    next();
  });

  const auth = createAuth(db);
  app.use('/api/auth', auth.router);
  app.use('/api', auth.schutz);
  app.use('/api/benutzer', auth.verwaltung);

  const api = express.Router();

  const existiert = (tabelle, id) =>
    id === null || db.prepare(`SELECT 1 FROM ${tabelle} WHERE id = ?`).get(id) !== undefined;

  // ---------- Kunden ----------
  function kundeAusBody(b) {
    const name = text(b.name);
    if (!name) throw new ValidationError('Name ist erforderlich');
    return [name, text(b.telefon), text(b.email), text(b.adresse), text(b.notiz)];
  }

  api.get('/kunden', (req, res) => {
    const q = text(req.query.q);
    const rows = q
      ? db
          .prepare(
            `SELECT * FROM kunden WHERE name LIKE ? OR telefon LIKE ? OR adresse LIKE ? ORDER BY name COLLATE NOCASE`
          )
          .all(`%${q}%`, `%${q}%`, `%${q}%`)
      : db.prepare('SELECT * FROM kunden ORDER BY name COLLATE NOCASE').all();
    res.json(rows);
  });

  api.get('/kunden/:id', (req, res) => {
    const k = db.prepare('SELECT * FROM kunden WHERE id = ?').get(req.params.id);
    if (!k) return res.status(404).json({ fehler: 'Kunde nicht gefunden' });
    k.auftraege = db
      .prepare('SELECT * FROM auftraege WHERE kunde_id = ? ORDER BY termin DESC')
      .all(k.id);
    k.ankaeufe = db
      .prepare(
        `SELECT a.*, m.name AS material FROM ankaeufe a JOIN materialien m ON m.id = a.material_id
         WHERE a.kunde_id = ? ORDER BY a.datum DESC, a.id DESC`
      )
      .all(k.id);
    res.json(k);
  });

  api.post('/kunden', (req, res) => {
    const r = db
      .prepare('INSERT INTO kunden (name, telefon, email, adresse, notiz) VALUES (?, ?, ?, ?, ?)')
      .run(...kundeAusBody(req.body));
    res.status(201).json(db.prepare('SELECT * FROM kunden WHERE id = ?').get(r.lastInsertRowid));
  });

  api.put('/kunden/:id', (req, res) => {
    const r = db
      .prepare('UPDATE kunden SET name = ?, telefon = ?, email = ?, adresse = ?, notiz = ? WHERE id = ?')
      .run(...kundeAusBody(req.body), req.params.id);
    if (r.changes === 0) return res.status(404).json({ fehler: 'Kunde nicht gefunden' });
    res.json(db.prepare('SELECT * FROM kunden WHERE id = ?').get(req.params.id));
  });

  api.delete('/kunden/:id', (req, res) => {
    const r = db.prepare('DELETE FROM kunden WHERE id = ?').run(req.params.id);
    if (r.changes === 0) return res.status(404).json({ fehler: 'Kunde nicht gefunden' });
    res.status(204).end();
  });

  // ---------- Materialien ----------
  api.get('/materialien', (req, res) => {
    res.json(db.prepare('SELECT * FROM materialien ORDER BY aktiv DESC, name COLLATE NOCASE').all());
  });

  function materialAusBody(b) {
    const name = text(b.name);
    if (!name) throw new ValidationError('Name ist erforderlich');
    return [name, zahl(b.preis_pro_kg, 'Preis pro kg', { min: 0 }), b.aktiv === false || b.aktiv === 0 ? 0 : 1];
  }

  api.post('/materialien', (req, res) => {
    try {
      const r = db
        .prepare('INSERT INTO materialien (name, preis_pro_kg, aktiv) VALUES (?, ?, ?)')
        .run(...materialAusBody(req.body));
      res.status(201).json(db.prepare('SELECT * FROM materialien WHERE id = ?').get(r.lastInsertRowid));
    } catch (e) {
      if (/UNIQUE/.test(e.message)) throw new ValidationError('Material existiert bereits');
      throw e;
    }
  });

  api.put('/materialien/:id', (req, res) => {
    let r;
    try {
      r = db
        .prepare('UPDATE materialien SET name = ?, preis_pro_kg = ?, aktiv = ? WHERE id = ?')
        .run(...materialAusBody(req.body), req.params.id);
    } catch (e) {
      if (/UNIQUE/.test(e.message)) throw new ValidationError('Material existiert bereits');
      throw e;
    }
    if (r.changes === 0) return res.status(404).json({ fehler: 'Material nicht gefunden' });
    res.json(db.prepare('SELECT * FROM materialien WHERE id = ?').get(req.params.id));
  });

  // ---------- Aufträge / Abholtermine ----------
  const AUFTRAG_SELECT = `SELECT a.*, k.name AS kunde, k.telefon AS kunde_telefon
                          FROM auftraege a LEFT JOIN kunden k ON k.id = a.kunde_id`;

  function auftragAusBody(b) {
    const kundeId = optId(b.kunde_id);
    if (!existiert('kunden', kundeId)) throw new ValidationError('Kunde existiert nicht');
    const typ = text(b.typ) || 'Abholung';
    if (!AUFTRAG_TYPEN.includes(typ)) throw new ValidationError('Ungültiger Auftragstyp');
    const status = text(b.status) || 'offen';
    if (!AUFTRAG_STATUS.includes(status)) throw new ValidationError('Ungültiger Status');
    const termin = text(b.termin);
    if (termin && Number.isNaN(Date.parse(termin))) throw new ValidationError('Ungültiger Termin');
    return [kundeId, typ, text(b.adresse), termin, status, text(b.beschreibung)];
  }

  api.get('/auftraege', (req, res) => {
    const where = [];
    const params = [];
    if (text(req.query.status)) {
      where.push('a.status = ?');
      params.push(req.query.status);
    }
    if (text(req.query.von)) {
      where.push('a.termin >= ?');
      params.push(req.query.von);
    }
    if (text(req.query.bis)) {
      where.push('a.termin < ?');
      params.push(req.query.bis);
    }
    const sql = `${AUFTRAG_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY a.termin IS NULL, a.termin, a.id`;
    res.json(db.prepare(sql).all(...params));
  });

  api.post('/auftraege', (req, res) => {
    const r = db
      .prepare(
        'INSERT INTO auftraege (kunde_id, typ, adresse, termin, status, beschreibung) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(...auftragAusBody(req.body));
    res.status(201).json(db.prepare(`${AUFTRAG_SELECT} WHERE a.id = ?`).get(r.lastInsertRowid));
  });

  api.put('/auftraege/:id', (req, res) => {
    const r = db
      .prepare(
        'UPDATE auftraege SET kunde_id = ?, typ = ?, adresse = ?, termin = ?, status = ?, beschreibung = ? WHERE id = ?'
      )
      .run(...auftragAusBody(req.body), req.params.id);
    if (r.changes === 0) return res.status(404).json({ fehler: 'Auftrag nicht gefunden' });
    res.json(db.prepare(`${AUFTRAG_SELECT} WHERE a.id = ?`).get(req.params.id));
  });

  api.delete('/auftraege/:id', (req, res) => {
    const r = db.prepare('DELETE FROM auftraege WHERE id = ?').run(req.params.id);
    if (r.changes === 0) return res.status(404).json({ fehler: 'Auftrag nicht gefunden' });
    res.status(204).end();
  });

  // ---------- Ankäufe ----------
  const ANKAUF_SELECT = `SELECT a.*, m.name AS material, k.name AS kunde
                         FROM ankaeufe a
                         JOIN materialien m ON m.id = a.material_id
                         LEFT JOIN kunden k ON k.id = a.kunde_id`;

  function ankaufAusBody(b) {
    const datum = text(b.datum) || new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) throw new ValidationError('Datum im Format JJJJ-MM-TT angeben');
    const kundeId = optId(b.kunde_id);
    if (!existiert('kunden', kundeId)) throw new ValidationError('Kunde existiert nicht');
    const auftragId = optId(b.auftrag_id);
    if (!existiert('auftraege', auftragId)) throw new ValidationError('Auftrag existiert nicht');
    const materialId = optId(b.material_id);
    const material = materialId && db.prepare('SELECT * FROM materialien WHERE id = ?').get(materialId);
    if (!material) throw new ValidationError('Material ist erforderlich');
    const gewicht = zahl(b.gewicht_kg, 'Gewicht', { min: 0, exklusiv: true });
    const preis =
      b.preis_pro_kg === undefined || b.preis_pro_kg === null || b.preis_pro_kg === ''
        ? material.preis_pro_kg
        : zahl(b.preis_pro_kg, 'Preis pro kg', { min: 0 });
    return [datum, kundeId, auftragId, materialId, gewicht, preis, runde2(gewicht * preis), text(b.notiz)];
  }

  api.get('/ankaeufe', (req, res) => {
    const where = [];
    const params = [];
    if (text(req.query.von)) {
      where.push('a.datum >= ?');
      params.push(req.query.von);
    }
    if (text(req.query.bis)) {
      where.push('a.datum <= ?');
      params.push(req.query.bis);
    }
    const sql = `${ANKAUF_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY a.datum DESC, a.id DESC`;
    res.json(db.prepare(sql).all(...params));
  });

  api.post('/ankaeufe', (req, res) => {
    const r = db
      .prepare(
        `INSERT INTO ankaeufe (datum, kunde_id, auftrag_id, material_id, gewicht_kg, preis_pro_kg, betrag, notiz)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(...ankaufAusBody(req.body));
    res.status(201).json(db.prepare(`${ANKAUF_SELECT} WHERE a.id = ?`).get(r.lastInsertRowid));
  });

  api.delete('/ankaeufe/:id', (req, res) => {
    const r = db.prepare('DELETE FROM ankaeufe WHERE id = ?').run(req.params.id);
    if (r.changes === 0) return res.status(404).json({ fehler: 'Ankauf nicht gefunden' });
    res.status(204).end();
  });

  // ---------- Übersicht ----------
  api.get('/uebersicht', (req, res) => {
    const heute = text(req.query.heute) || new Date().toISOString().slice(0, 10);
    const monat = heute.slice(0, 7);
    const in7 = new Date(Date.parse(heute) + 7 * 864e5).toISOString().slice(0, 10);

    res.json({
      heute,
      termine_heute: db
        .prepare(`${AUFTRAG_SELECT} WHERE substr(a.termin, 1, 10) = ? AND a.status IN ('offen','geplant') ORDER BY a.termin`)
        .all(heute),
      termine_naechste_7_tage: db
        .prepare(
          `${AUFTRAG_SELECT} WHERE substr(a.termin, 1, 10) > ? AND substr(a.termin, 1, 10) <= ?
           AND a.status IN ('offen','geplant') ORDER BY a.termin`
        )
        .all(heute, in7),
      offene_auftraege: db
        .prepare(`SELECT COUNT(*) AS n FROM auftraege WHERE status IN ('offen','geplant')`)
        .get().n,
      ohne_termin: db
        .prepare(`SELECT COUNT(*) AS n FROM auftraege WHERE termin IS NULL AND status IN ('offen','geplant')`)
        .get().n,
      kunden: db.prepare('SELECT COUNT(*) AS n FROM kunden').get().n,
      ankauf_monat: db
        .prepare(
          `SELECT COUNT(*) AS anzahl, COALESCE(SUM(gewicht_kg), 0) AS gewicht_kg, COALESCE(SUM(betrag), 0) AS betrag
           FROM ankaeufe WHERE substr(datum, 1, 7) = ?`
        )
        .get(monat),
      ankauf_monat_nach_material: db
        .prepare(
          `SELECT m.name AS material, SUM(a.gewicht_kg) AS gewicht_kg, SUM(a.betrag) AS betrag
           FROM ankaeufe a JOIN materialien m ON m.id = a.material_id
           WHERE substr(a.datum, 1, 7) = ? GROUP BY m.id ORDER BY gewicht_kg DESC`
        )
        .all(monat),
    });
  });

  api.get('/meta', (req, res) => res.json({ typen: AUFTRAG_TYPEN, status: AUFTRAG_STATUS }));

  app.use('/api', api);

  app.use('/api', (req, res) => res.status(404).json({ fehler: 'Nicht gefunden' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof AuthError) return res.status(err.status).json({ fehler: err.message });
    if (err instanceof ValidationError) return res.status(400).json({ fehler: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ fehler: 'Ungültiges JSON' });
    console.error(err);
    res.status(500).json({ fehler: 'Interner Fehler' });
  });

  return app;
}

module.exports = { createApp };
