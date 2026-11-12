'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS kunden (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  telefon     TEXT,
  email       TEXT,
  adresse     TEXT,
  notiz       TEXT,
  erstellt_am TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS materialien (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL UNIQUE,
  preis_pro_kg REAL    NOT NULL DEFAULT 0 CHECK (preis_pro_kg >= 0),
  aktiv        INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS auftraege (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kunde_id     INTEGER REFERENCES kunden(id) ON DELETE SET NULL,
  typ          TEXT    NOT NULL DEFAULT 'Abholung',
  adresse      TEXT,
  termin       TEXT,
  status       TEXT    NOT NULL DEFAULT 'offen',
  beschreibung TEXT,
  erstellt_am  TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE IF NOT EXISTS ankaeufe (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  datum        TEXT    NOT NULL,
  kunde_id     INTEGER REFERENCES kunden(id) ON DELETE SET NULL,
  auftrag_id   INTEGER REFERENCES auftraege(id) ON DELETE SET NULL,
  material_id  INTEGER NOT NULL REFERENCES materialien(id),
  gewicht_kg   REAL    NOT NULL CHECK (gewicht_kg > 0),
  preis_pro_kg REAL    NOT NULL CHECK (preis_pro_kg >= 0),
  betrag       REAL    NOT NULL,
  notiz        TEXT
);

CREATE INDEX IF NOT EXISTS idx_auftraege_termin ON auftraege(termin);
CREATE INDEX IF NOT EXISTS idx_ankaeufe_datum ON ankaeufe(datum);
`;

// Startwerte – reine Platzhalter, in der App unter "Materialpreise" anpassen.
const STANDARD_MATERIALIEN = [
  ['Kupfer', 0],
  ['Messing', 0],
  ['Aluminium', 0],
  ['Edelstahl', 0],
  ['Blei', 0],
  ['Kabel', 0],
  ['Eisen / Stahl (Mischschrott)', 0],
  ['Elektroschrott', 0],
];

function openDb(dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'schrotty.db')) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);

  const { n } = db.prepare('SELECT COUNT(*) AS n FROM materialien').get();
  if (n === 0) {
    const insert = db.prepare('INSERT INTO materialien (name, preis_pro_kg) VALUES (?, ?)');
    for (const [name, preis] of STANDARD_MATERIALIEN) insert.run(name, preis);
  }
  return db;
}

module.exports = { openDb };
