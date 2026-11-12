'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { createApp } = require('../src/app');

let server;
let basis;

before(async () => {
  const app = createApp(openDb(':memory:'));
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  basis = `http://127.0.0.1:${server.address().port}/api`;
});

after(() => server.close());

async function call(pfad, method = 'GET', body) {
  const res = await fetch(basis + pfad, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const daten = res.status === 204 ? null : await res.json();
  return { status: res.status, daten };
}

test('Standard-Materialien sind angelegt', async () => {
  const { status, daten } = await call('/materialien');
  assert.equal(status, 200);
  assert.ok(daten.some((m) => m.name === 'Kupfer'));
});

test('Kunde anlegen, suchen, bearbeiten, Pflichtfeld prüfen', async () => {
  const neu = await call('/kunden', 'POST', { name: 'Hof Petersen', telefon: '04841 1234', adresse: 'Dorfstr. 1, Husum' });
  assert.equal(neu.status, 201);
  assert.equal(neu.daten.name, 'Hof Petersen');

  const suche = await call('/kunden?q=Husum');
  assert.equal(suche.daten.length, 1);

  const upd = await call(`/kunden/${neu.daten.id}`, 'PUT', { name: 'Hof Petersen GbR', telefon: '04841 1234' });
  assert.equal(upd.daten.name, 'Hof Petersen GbR');

  const fehler = await call('/kunden', 'POST', { name: '  ' });
  assert.equal(fehler.status, 400);
  assert.match(fehler.daten.fehler, /Name/);
});

test('Auftrag anlegen und validieren', async () => {
  const kunde = (await call('/kunden', 'POST', { name: 'Werkstatt Jensen' })).daten;
  const a = await call('/auftraege', 'POST', {
    kunde_id: kunde.id,
    typ: 'Abholung',
    termin: '2026-11-12T09:30',
    adresse: 'Hafenstr. 5',
    beschreibung: 'Alte Heizkörper',
  });
  assert.equal(a.status, 201);
  assert.equal(a.daten.kunde, 'Werkstatt Jensen');
  assert.equal(a.daten.status, 'offen');

  assert.equal((await call('/auftraege', 'POST', { typ: 'Quatsch' })).status, 400);
  assert.equal((await call('/auftraege', 'POST', { kunde_id: 99999 })).status, 400);
  assert.equal((await call('/auftraege', 'POST', { termin: 'morgen' })).status, 400);

  const erledigt = await call(`/auftraege/${a.daten.id}`, 'PUT', { ...a.daten, status: 'erledigt' });
  assert.equal(erledigt.daten.status, 'erledigt');
  assert.equal((await call('/auftraege?status=erledigt')).daten.length, 1);
});

test('Ankauf berechnet Betrag und nutzt Materialpreis als Standard', async () => {
  const kupfer = (await call('/materialien')).daten.find((m) => m.name === 'Kupfer');
  await call(`/materialien/${kupfer.id}`, 'PUT', { name: 'Kupfer', preis_pro_kg: 6.5 });

  const mitStandardpreis = await call('/ankaeufe', 'POST', { datum: '2026-11-10', material_id: kupfer.id, gewicht_kg: '12,4' });
  assert.equal(mitStandardpreis.status, 201);
  assert.equal(mitStandardpreis.daten.preis_pro_kg, 6.5);
  assert.equal(mitStandardpreis.daten.betrag, 80.6);

  const eigenerPreis = await call('/ankaeufe', 'POST', { datum: '2026-11-11', material_id: kupfer.id, gewicht_kg: 3, preis_pro_kg: 7 });
  assert.equal(eigenerPreis.daten.betrag, 21);

  assert.equal((await call('/ankaeufe', 'POST', { material_id: kupfer.id, gewicht_kg: 0 })).status, 400);
  assert.equal((await call('/ankaeufe', 'POST', { gewicht_kg: 5 })).status, 400);
  assert.equal((await call('/ankaeufe', 'POST', { material_id: kupfer.id, gewicht_kg: 5, datum: '10.11.2026' })).status, 400);

  const monat = await call('/ankaeufe?von=2026-11-01&bis=2026-11-30');
  assert.equal(monat.daten.length, 2);
});

test('Übersicht fasst Termine und Monatsankauf zusammen', async () => {
  const { daten } = await call('/uebersicht?heute=2026-11-12');
  assert.equal(daten.ankauf_monat.anzahl, 2);
  assert.equal(daten.ankauf_monat.betrag, 101.6);
  assert.equal(daten.ankauf_monat_nach_material[0].material, 'Kupfer');
  // der Termin am 12.11. wurde im Auftrags-Test auf erledigt gesetzt
  assert.equal(daten.termine_heute.length, 0);

  await call('/auftraege', 'POST', { termin: '2026-11-12T14:00', status: 'geplant' });
  await call('/auftraege', 'POST', { termin: '2026-11-15T10:00' });
  const neu = (await call('/uebersicht?heute=2026-11-12')).daten;
  assert.equal(neu.termine_heute.length, 1);
  assert.equal(neu.termine_naechste_7_tage.length, 1);
});

test('Kunde löschen behält Aufträge ohne Zuordnung', async () => {
  const k = (await call('/kunden', 'POST', { name: 'Zum Löschen' })).daten;
  const a = (await call('/auftraege', 'POST', { kunde_id: k.id })).daten;
  assert.equal((await call(`/kunden/${k.id}`, 'DELETE')).status, 204);
  const alle = (await call('/auftraege')).daten;
  assert.equal(alle.find((x) => x.id === a.id).kunde_id, null);
  assert.equal((await call(`/kunden/${k.id}`)).status, 404);
});

test('Doppelter Materialname wird abgelehnt', async () => {
  const r = await call('/materialien', 'POST', { name: 'Kupfer', preis_pro_kg: 1 });
  assert.equal(r.status, 400);
});
