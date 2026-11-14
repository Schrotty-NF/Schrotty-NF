'use strict';

// ---------- Hilfsfunktionen ----------
const $ = (sel) => document.querySelector(sel);
const inhalt = $('#inhalt');

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const euro = (n) => Number(n || 0).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const kg = (n) => Number(n || 0).toLocaleString('de-DE', { maximumFractionDigits: 2 }) + ' kg';

function lokalesDatum(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function datumDe(iso) {
  if (!iso) return '–';
  const [d, t] = iso.split('T');
  const [j, m, tag] = d.split('-');
  return `${tag}.${m}.${j}${t ? ' ' + t.slice(0, 5) + ' Uhr' : ''}`;
}

async function api(pfad, optionen = {}) {
  const res = await fetch('/api' + pfad, {
    headers: { 'Content-Type': 'application/json' },
    ...optionen,
    body: optionen.body ? JSON.stringify(optionen.body) : undefined,
  });
  if (res.status === 204) return null;
  const daten = await res.json().catch(() => ({}));
  if (res.status === 401 && !pfad.startsWith('/auth/')) {
    loginZeigen(false);
    throw new Error(daten.fehler || 'Bitte anmelden');
  }
  if (!res.ok) throw new Error(daten.fehler || `Fehler ${res.status}`);
  return daten;
}

let meldungTimer;
function meldung(text) {
  const el = $('#meldung');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(meldungTimer);
  meldungTimer = setTimeout(() => (el.hidden = true), 2500);
}

const telLink = (t) => (t ? `<a href="tel:${esc(t.replace(/[^\d+]/g, ''))}">${esc(t)}</a>` : '');
const statusBadge = (s) => `<span class="badge ${esc(s)}">${esc(s)}</span>`;

// ---------- Formular-Dialog ----------
/**
 * felder: [{ name, label, typ: 'text'|'textarea'|'select'|'number'|'date'|'datetime-local', optionen: [[wert, text]], wert }]
 * speichern(daten) -> Promise
 */
function formular({ titel, felder, speichern, beiAenderung }) {
  const dialog = $('#dialog');
  const form = $('#dialog-form');
  const fehler = $('#dialog-fehler');
  $('#dialog-titel').textContent = titel;
  fehler.hidden = true;

  $('#dialog-felder').innerHTML = felder
    .map((f) => {
      const id = 'f-' + f.name;
      const req = f.pflicht ? 'required' : '';
      let eingabe;
      if (f.typ === 'textarea') {
        eingabe = `<textarea id="${id}" name="${f.name}" rows="3" ${req}>${esc(f.wert)}</textarea>`;
      } else if (f.typ === 'select') {
        eingabe = `<select id="${id}" name="${f.name}" ${req}>${f.optionen
          .map(([w, t]) => `<option value="${esc(w)}" ${String(w) === String(f.wert ?? '') ? 'selected' : ''}>${esc(t)}</option>`)
          .join('')}</select>`;
      } else if (f.typ === 'info') {
        return `<p class="vorschau" id="${id}"></p>`;
      } else {
        const extra = f.typ === 'number' ? 'step="any" min="0" inputmode="decimal"' : '';
        eingabe = `<input id="${id}" name="${f.name}" type="${f.typ || 'text'}" value="${esc(f.wert)}" ${extra} ${req}>`;
      }
      return `<div class="feld"><label for="${id}">${esc(f.label)}</label>${eingabe}</div>`;
    })
    .join('');

  const lesen = () => Object.fromEntries(new FormData(form).entries());
  form.oninput = beiAenderung ? () => beiAenderung(lesen()) : null;
  if (beiAenderung) beiAenderung(lesen());

  form.onsubmit = async (e) => {
    e.preventDefault();
    try {
      await speichern(lesen());
      dialog.close();
      meldung('Gespeichert');
      zeigen();
    } catch (err) {
      fehler.textContent = err.message;
      fehler.hidden = false;
    }
  };
  $('#dialog-abbrechen').onclick = () => dialog.close();
  dialog.showModal();
  dialog.querySelector('input, select, textarea')?.focus();
}

async function loeschen(frage, pfad) {
  if (!confirm(frage)) return;
  try {
    await api(pfad, { method: 'DELETE' });
    meldung('Gelöscht');
    zeigen();
  } catch (err) {
    alert(err.message);
  }
}

// Gemeinsam genutzte Listen (bei Bedarf geladen)
const kundenOptionen = async () => [['', '– kein Kunde –'], ...(await api('/kunden')).map((k) => [k.id, k.name])];

// ---------- Ansichten ----------
const ansichten = {};

ansichten.uebersicht = async () => {
  const u = await api('/uebersicht?heute=' + lokalesDatum());
  const terminZeile = (a) => `<tr>
      <td>${datumDe(a.termin)}</td>
      <td>${esc(a.typ)}</td>
      <td>${esc(a.kunde || '–')}<br><span class="klein">${telLink(a.kunde_telefon)}</span></td>
      <td>${esc(a.adresse || '')}</td>
    </tr>`;
  const terminTabelle = (liste, leer) =>
    liste.length
      ? `<div class="tabelle-wrap"><table><tr><th>Termin</th><th>Art</th><th>Kunde</th><th>Adresse</th></tr>${liste
          .map(terminZeile)
          .join('')}</table></div>`
      : `<p class="leer">${leer}</p>`;

  inhalt.innerHTML = `
    <div class="kopf"><h2>Übersicht</h2><span class="klein">Stand: ${datumDe(u.heute)}</span></div>
    <div class="kacheln">
      <div class="kachel"><div class="wert">${u.termine_heute.length}</div><div class="label">Termine heute</div></div>
      <div class="kachel"><div class="wert">${u.offene_auftraege}</div><div class="label">Offene Aufträge${
        u.ohne_termin ? ` (${u.ohne_termin} ohne Termin)` : ''
      }</div></div>
      <div class="kachel"><div class="wert">${kg(u.ankauf_monat.gewicht_kg)}</div><div class="label">Ankauf diesen Monat</div></div>
      <div class="kachel"><div class="wert">${euro(u.ankauf_monat.betrag)}</div><div class="label">Ausgezahlt diesen Monat</div></div>
    </div>
    <div class="karte"><h3>Heute</h3>${terminTabelle(u.termine_heute, 'Heute keine Termine.')}</div>
    <div class="karte"><h3>Nächste 7 Tage</h3>${terminTabelle(u.termine_naechste_7_tage, 'Keine weiteren Termine.')}</div>
    <div class="karte"><h3>Ankauf diesen Monat nach Material</h3>${
      u.ankauf_monat_nach_material.length
        ? `<div class="tabelle-wrap"><table><tr><th>Material</th><th class="zahl">Gewicht</th><th class="zahl">Betrag</th></tr>${u.ankauf_monat_nach_material
            .map((m) => `<tr><td>${esc(m.material)}</td><td class="zahl">${kg(m.gewicht_kg)}</td><td class="zahl">${euro(m.betrag)}</td></tr>`)
            .join('')}</table></div>`
        : '<p class="leer">Noch keine Ankäufe in diesem Monat.</p>'
    }</div>`;
};

const filterZustand = { auftragStatus: 'aktiv', ankaufMonat: lokalesDatum().slice(0, 7), kundeSuche: '' };

ansichten.auftraege = async () => {
  const meta = await api('/meta');
  const statusParam = ['offen', 'geplant', 'erledigt', 'storniert'].includes(filterZustand.auftragStatus)
    ? '?status=' + filterZustand.auftragStatus
    : '';
  let liste = await api('/auftraege' + statusParam);
  if (filterZustand.auftragStatus === 'aktiv') liste = liste.filter((a) => a.status === 'offen' || a.status === 'geplant');

  inhalt.innerHTML = `
    <div class="kopf">
      <h2>Aufträge &amp; Abholtermine</h2>
      <div class="filter">
        <select id="status-filter">
          ${[['aktiv', 'Offen + geplant'], ['alle', 'Alle'], ...meta.status.map((s) => [s, s])]
            .map(([w, t]) => `<option value="${w}" ${w === filterZustand.auftragStatus ? 'selected' : ''}>${t}</option>`)
            .join('')}
        </select>
        <button id="neu">+ Neuer Auftrag</button>
      </div>
    </div>
    ${
      liste.length
        ? `<div class="tabelle-wrap"><table>
            <tr><th>Termin</th><th>Art</th><th>Kunde</th><th>Adresse</th><th>Beschreibung</th><th>Status</th><th></th></tr>
            ${liste
              .map(
                (a) => `<tr>
                <td>${datumDe(a.termin)}</td>
                <td>${esc(a.typ)}</td>
                <td>${esc(a.kunde || '–')}<br><span class="klein">${telLink(a.kunde_telefon)}</span></td>
                <td>${esc(a.adresse || '')}</td>
                <td>${esc(a.beschreibung || '')}</td>
                <td>${statusBadge(a.status)}</td>
                <td class="aktionen">
                  ${a.status !== 'erledigt' ? `<button class="klein zweitrangig" data-erledigt="${a.id}">Erledigt</button>` : ''}
                  <button class="klein zweitrangig" data-bearbeiten="${a.id}">Bearbeiten</button>
                  <button class="klein gefahr" data-loeschen="${a.id}">Löschen</button>
                </td></tr>`
              )
              .join('')}
          </table></div>`
        : '<p class="leer">Keine Aufträge vorhanden.</p>'
    }`;

  $('#status-filter').onchange = (e) => {
    filterZustand.auftragStatus = e.target.value;
    zeigen();
  };

  const kunden = await api('/kunden');
  const oeffnen = (a = {}) =>
    formular({
      titel: a.id ? 'Auftrag bearbeiten' : 'Neuer Auftrag',
      felder: [
        { name: 'kunde_id', label: 'Kunde', typ: 'select', optionen: [['', '– kein Kunde –'], ...kunden.map((k) => [k.id, k.name])], wert: a.kunde_id },
        { name: 'typ', label: 'Art', typ: 'select', optionen: meta.typen.map((t) => [t, t]), wert: a.typ || 'Abholung' },
        { name: 'termin', label: 'Termin', typ: 'datetime-local', wert: a.termin },
        { name: 'adresse', label: 'Adresse (leer = Kundenadresse)', wert: a.adresse },
        { name: 'beschreibung', label: 'Beschreibung (was wird abgeholt?)', typ: 'textarea', wert: a.beschreibung },
        { name: 'status', label: 'Status', typ: 'select', optionen: meta.status.map((s) => [s, s]), wert: a.status || 'offen' },
      ],
      speichern: (d) => {
        if (!d.adresse && d.kunde_id) d.adresse = kunden.find((k) => String(k.id) === d.kunde_id)?.adresse || '';
        if (d.termin && d.status === 'offen' && !a.id) d.status = 'geplant';
        return api(a.id ? '/auftraege/' + a.id : '/auftraege', { method: a.id ? 'PUT' : 'POST', body: d });
      },
    });

  $('#neu').onclick = () => oeffnen();
  inhalt.querySelectorAll('[data-bearbeiten]').forEach((b) => (b.onclick = () => oeffnen(liste.find((a) => a.id == b.dataset.bearbeiten))));
  inhalt.querySelectorAll('[data-loeschen]').forEach((b) => (b.onclick = () => loeschen('Auftrag wirklich löschen?', '/auftraege/' + b.dataset.loeschen)));
  inhalt.querySelectorAll('[data-erledigt]').forEach(
    (b) =>
      (b.onclick = async () => {
        const a = liste.find((x) => x.id == b.dataset.erledigt);
        await api('/auftraege/' + a.id, { method: 'PUT', body: { ...a, status: 'erledigt' } });
        meldung('Als erledigt markiert');
        zeigen();
      })
  );
};

ansichten.ankaeufe = async () => {
  const [j, m] = filterZustand.ankaufMonat.split('-').map(Number);
  const von = `${filterZustand.ankaufMonat}-01`;
  const bis = lokalesDatum(new Date(j, m, 0));
  const liste = await api(`/ankaeufe?von=${von}&bis=${bis}`);
  const summeKg = liste.reduce((s, a) => s + a.gewicht_kg, 0);
  const summeEuro = liste.reduce((s, a) => s + a.betrag, 0);

  inhalt.innerHTML = `
    <div class="kopf">
      <h2>Ankäufe</h2>
      <div class="filter">
        <input type="month" id="monat" value="${filterZustand.ankaufMonat}">
        <button class="zweitrangig" onclick="window.print()">Drucken</button>
        <button id="neu">+ Neuer Ankauf</button>
      </div>
    </div>
    <div class="kacheln">
      <div class="kachel"><div class="wert">${liste.length}</div><div class="label">Ankäufe</div></div>
      <div class="kachel"><div class="wert">${kg(summeKg)}</div><div class="label">Gesamtgewicht</div></div>
      <div class="kachel"><div class="wert">${euro(summeEuro)}</div><div class="label">Ausgezahlt</div></div>
    </div>
    ${
      liste.length
        ? `<div class="tabelle-wrap"><table>
            <tr><th>Datum</th><th>Kunde</th><th>Material</th><th class="zahl">Gewicht</th><th class="zahl">€/kg</th><th class="zahl">Betrag</th><th>Notiz</th><th></th></tr>
            ${liste
              .map(
                (a) => `<tr>
                <td>${datumDe(a.datum)}</td>
                <td>${esc(a.kunde || '–')}</td>
                <td>${esc(a.material)}</td>
                <td class="zahl">${kg(a.gewicht_kg)}</td>
                <td class="zahl">${euro(a.preis_pro_kg)}</td>
                <td class="zahl">${euro(a.betrag)}</td>
                <td>${esc(a.notiz || '')}</td>
                <td class="aktionen"><button class="klein gefahr" data-loeschen="${a.id}">Löschen</button></td></tr>`
              )
              .join('')}
          </table></div>`
        : '<p class="leer">Keine Ankäufe in diesem Monat.</p>'
    }`;

  $('#monat').onchange = (e) => {
    if (e.target.value) filterZustand.ankaufMonat = e.target.value;
    zeigen();
  };
  inhalt.querySelectorAll('[data-loeschen]').forEach((b) => (b.onclick = () => loeschen('Ankauf wirklich löschen?', '/ankaeufe/' + b.dataset.loeschen)));

  $('#neu').onclick = async () => {
    const materialien = (await api('/materialien')).filter((x) => x.aktiv);
    const preisVon = (id) => materialien.find((x) => String(x.id) === String(id))?.preis_pro_kg ?? 0;
    let letztesMaterial = null;
    formular({
      titel: 'Neuer Ankauf',
      felder: [
        { name: 'datum', label: 'Datum', typ: 'date', wert: lokalesDatum(), pflicht: true },
        { name: 'kunde_id', label: 'Kunde', typ: 'select', optionen: await kundenOptionen() },
        { name: 'material_id', label: 'Material', typ: 'select', optionen: materialien.map((x) => [x.id, x.name]), pflicht: true },
        { name: 'gewicht_kg', label: 'Gewicht (kg)', typ: 'number', pflicht: true },
        { name: 'preis_pro_kg', label: 'Preis pro kg (€)', typ: 'number', wert: materialien[0]?.preis_pro_kg ?? '' },
        { name: 'vorschau', typ: 'info' },
        { name: 'notiz', label: 'Notiz', typ: 'textarea' },
      ],
      beiAenderung: (d) => {
        const preisFeld = $('#f-preis_pro_kg');
        if (d.material_id !== letztesMaterial) {
          if (letztesMaterial !== null) preisFeld.value = preisVon(d.material_id);
          letztesMaterial = d.material_id;
        }
        const g = Number(String(d.gewicht_kg).replace(',', '.')) || 0;
        const p = Number(String(preisFeld.value).replace(',', '.')) || 0;
        $('#f-vorschau').textContent = `Auszuzahlen: ${euro(Math.round(g * p * 100) / 100)}`;
      },
      speichern: (d) => {
        delete d.vorschau;
        return api('/ankaeufe', { method: 'POST', body: d });
      },
    });
  };
};

ansichten.kunden = async () => {
  const q = filterZustand.kundeSuche;
  const liste = await api('/kunden' + (q ? '?q=' + encodeURIComponent(q) : ''));

  inhalt.innerHTML = `
    <div class="kopf">
      <h2>Kunden</h2>
      <div class="filter">
        <input type="search" id="suche" placeholder="Suchen…" value="${esc(q)}">
        <button id="neu">+ Neuer Kunde</button>
      </div>
    </div>
    ${
      liste.length
        ? `<div class="tabelle-wrap"><table>
            <tr><th>Name</th><th>Telefon</th><th>E-Mail</th><th>Adresse</th><th>Notiz</th><th></th></tr>
            ${liste
              .map(
                (k) => `<tr>
                <td><a href="#kunde/${k.id}">${esc(k.name)}</a></td>
                <td>${telLink(k.telefon)}</td>
                <td>${k.email ? `<a href="mailto:${esc(k.email)}">${esc(k.email)}</a>` : ''}</td>
                <td>${esc(k.adresse || '')}</td>
                <td>${esc(k.notiz || '')}</td>
                <td class="aktionen">
                  <button class="klein zweitrangig" data-bearbeiten="${k.id}">Bearbeiten</button>
                  <button class="klein gefahr" data-loeschen="${k.id}">Löschen</button>
                </td></tr>`
              )
              .join('')}
          </table></div>`
        : `<p class="leer">${q ? 'Keine Treffer.' : 'Noch keine Kunden angelegt.'}</p>`
    }`;

  const suche = $('#suche');
  let t;
  suche.oninput = () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      filterZustand.kundeSuche = suche.value;
      await zeigen();
      const s = $('#suche');
      s.focus();
      s.setSelectionRange(s.value.length, s.value.length);
    }, 250);
  };

  $('#neu').onclick = () => kundeFormular();
  inhalt.querySelectorAll('[data-bearbeiten]').forEach((b) => (b.onclick = () => kundeFormular(liste.find((k) => k.id == b.dataset.bearbeiten))));
  inhalt.querySelectorAll('[data-loeschen]').forEach(
    (b) =>
      (b.onclick = () =>
        loeschen('Kunde wirklich löschen? Aufträge und Ankäufe bleiben erhalten, aber ohne Kundenzuordnung.', '/kunden/' + b.dataset.loeschen))
  );
};

function kundeFormular(k = {}) {
  formular({
    titel: k.id ? 'Kunde bearbeiten' : 'Neuer Kunde',
    felder: [
      { name: 'name', label: 'Name / Firma', wert: k.name, pflicht: true },
      { name: 'telefon', label: 'Telefon', typ: 'tel', wert: k.telefon },
      { name: 'email', label: 'E-Mail', typ: 'email', wert: k.email },
      { name: 'adresse', label: 'Adresse', wert: k.adresse },
      { name: 'notiz', label: 'Notiz', typ: 'textarea', wert: k.notiz },
    ],
    speichern: (d) => api(k.id ? '/kunden/' + k.id : '/kunden', { method: k.id ? 'PUT' : 'POST', body: d }),
  });
}

ansichten.kunde = async (id) => {
  const k = await api('/kunden/' + id);
  const summe = k.ankaeufe.reduce((s, a) => s + a.betrag, 0);
  inhalt.innerHTML = `
    <div class="kopf">
      <h2>${esc(k.name)}</h2>
      <div class="filter"><a href="#kunden" class="klein">← zurück zu Kunden</a><button id="bearbeiten">Bearbeiten</button></div>
    </div>
    <div class="raster">
      <div class="karte"><h3>Kontakt</h3>
        <p>${telLink(k.telefon) || '<span class="klein">kein Telefon</span>'}<br>
        ${k.email ? `<a href="mailto:${esc(k.email)}">${esc(k.email)}</a>` : ''}<br>
        ${esc(k.adresse || '')}</p>
        ${k.notiz ? `<p class="klein">${esc(k.notiz)}</p>` : ''}
        <p class="klein">Kunde seit ${datumDe(k.erstellt_am.slice(0, 10))}</p>
      </div>
      <div class="karte"><h3>Bisher</h3>
        <p>${k.auftraege.length} Aufträge<br>${k.ankaeufe.length} Ankäufe, insgesamt ${euro(summe)} ausgezahlt</p>
      </div>
    </div>
    <div class="karte"><h3>Aufträge</h3>${
      k.auftraege.length
        ? `<div class="tabelle-wrap"><table><tr><th>Termin</th><th>Art</th><th>Beschreibung</th><th>Status</th></tr>${k.auftraege
            .map((a) => `<tr><td>${datumDe(a.termin)}</td><td>${esc(a.typ)}</td><td>${esc(a.beschreibung || '')}</td><td>${statusBadge(a.status)}</td></tr>`)
            .join('')}</table></div>`
        : '<p class="leer">Keine Aufträge.</p>'
    }</div>
    <div class="karte"><h3>Ankäufe</h3>${
      k.ankaeufe.length
        ? `<div class="tabelle-wrap"><table><tr><th>Datum</th><th>Material</th><th class="zahl">Gewicht</th><th class="zahl">Betrag</th></tr>${k.ankaeufe
            .map((a) => `<tr><td>${datumDe(a.datum)}</td><td>${esc(a.material)}</td><td class="zahl">${kg(a.gewicht_kg)}</td><td class="zahl">${euro(a.betrag)}</td></tr>`)
            .join('')}</table></div>`
        : '<p class="leer">Keine Ankäufe.</p>'
    }</div>`;
  $('#bearbeiten').onclick = () => kundeFormular(k);
};

ansichten.materialien = async () => {
  const liste = await api('/materialien');
  inhalt.innerHTML = `
    <div class="kopf">
      <h2>Materialpreise</h2>
      <div class="filter"><button id="neu">+ Neues Material</button></div>
    </div>
    <p class="klein">Der Preis pro kg wird bei neuen Ankäufen automatisch vorgeschlagen und kann dort noch angepasst werden. Bereits erfasste Ankäufe ändern sich nicht.</p>
    <div class="tabelle-wrap"><table>
      <tr><th>Material</th><th class="zahl">Ankaufspreis €/kg</th><th>Aktiv</th><th></th></tr>
      ${liste
        .map(
          (x) => `<tr data-id="${x.id}">
          <td><input value="${esc(x.name)}" data-feld="name"></td>
          <td class="zahl"><input class="preis" type="number" step="0.01" min="0" value="${x.preis_pro_kg}" data-feld="preis_pro_kg"></td>
          <td><input type="checkbox" data-feld="aktiv" ${x.aktiv ? 'checked' : ''} style="width:auto"></td>
          <td class="aktionen"><button class="klein" data-speichern>Speichern</button></td></tr>`
        )
        .join('')}
    </table></div>`;

  inhalt.querySelectorAll('[data-speichern]').forEach(
    (b) =>
      (b.onclick = async () => {
        const zeile = b.closest('tr');
        const wert = (f) => zeile.querySelector(`[data-feld="${f}"]`);
        try {
          await api('/materialien/' + zeile.dataset.id, {
            method: 'PUT',
            body: { name: wert('name').value, preis_pro_kg: wert('preis_pro_kg').value, aktiv: wert('aktiv').checked },
          });
          meldung('Preis gespeichert');
        } catch (err) {
          alert(err.message);
        }
      })
  );

  $('#neu').onclick = () =>
    formular({
      titel: 'Neues Material',
      felder: [
        { name: 'name', label: 'Bezeichnung', pflicht: true },
        { name: 'preis_pro_kg', label: 'Ankaufspreis €/kg', typ: 'number', wert: 0, pflicht: true },
      ],
      speichern: (d) => api('/materialien', { method: 'POST', body: d }),
    });
};

ansichten.benutzer = async () => {
  const [liste, status] = await Promise.all([api('/benutzer'), api('/auth/status')]);
  const ich = status.benutzer;
  inhalt.innerHTML = `
    <div class="kopf">
      <h2>Benutzer</h2>
      <div class="filter"><button id="neu">+ Neuer Benutzer</button></div>
    </div>
    <p class="klein">Alle Benutzer haben die gleichen Rechte. Ein neuer Benutzer kann sein Passwort nach der ersten Anmeldung hier selbst ändern.</p>
    <div class="tabelle-wrap"><table>
      <tr><th>Benutzername</th><th>Angelegt</th><th></th></tr>
      ${liste
        .map(
          (b) => `<tr>
          <td>${esc(b.name)}${b.id === ich.id ? ' <span class="klein">(du)</span>' : ''}</td>
          <td>${datumDe((b.erstellt_am || '').replace(' ', 'T'))}</td>
          <td class="aktionen">
            <button class="klein zweitrangig" data-pw="${b.id}" data-name="${esc(b.name)}">Passwort ändern</button>
            ${b.id === ich.id ? '' : `<button class="klein gefahr" data-loeschen="${b.id}" data-name="${esc(b.name)}">Löschen</button>`}
          </td></tr>`
        )
        .join('')}
    </table></div>`;

  const passwortFelder = [
    { name: 'passwort', label: 'Passwort (mind. 8 Zeichen)', typ: 'password', pflicht: true },
    { name: 'wdh', label: 'Passwort wiederholen', typ: 'password', pflicht: true },
  ];
  const gleich = (d) => {
    if (d.passwort !== d.wdh) throw new Error('Die Passwörter stimmen nicht überein');
  };

  $('#neu').onclick = () =>
    formular({
      titel: 'Neuer Benutzer',
      felder: [{ name: 'name', label: 'Benutzername', pflicht: true }, ...passwortFelder],
      speichern: (d) => (gleich(d), api('/benutzer', { method: 'POST', body: { name: d.name, passwort: d.passwort } })),
    });

  inhalt.querySelectorAll('[data-pw]').forEach(
    (b) =>
      (b.onclick = () =>
        formular({
          titel: `Passwort ändern: ${b.dataset.name}`,
          felder: passwortFelder,
          speichern: (d) => (gleich(d), api(`/benutzer/${b.dataset.pw}/passwort`, { method: 'PUT', body: { passwort: d.passwort } })),
        }))
  );
  inhalt.querySelectorAll('[data-loeschen]').forEach(
    (b) => (b.onclick = () => loeschen(`Benutzer „${b.dataset.name}“ wirklich löschen?`, '/benutzer/' + b.dataset.loeschen))
  );
};

// ---------- Anmeldung ----------
let einrichtung = false;

function loginZeigen(ersteinrichtung) {
  einrichtung = ersteinrichtung;
  document.body.classList.add('abgemeldet');
  $('#login').hidden = false;
  $('#sitzung').hidden = true;
  inhalt.innerHTML = '';
  $('#login-titel').textContent = einrichtung ? 'Ersten Zugang anlegen' : 'Anmelden';
  $('#login-knopf').textContent = einrichtung ? 'Zugang anlegen' : 'Anmelden';
  $('#login-hinweis').hidden = !einrichtung;
  $('#login-wdh-feld').hidden = !einrichtung;
  $('#login-wdh').required = einrichtung;
  $('#login-passwort').autocomplete = einrichtung ? 'new-password' : 'current-password';
  $('#login-fehler').hidden = true;
  $('#login-name').focus();
}

function angemeldet(benutzer) {
  document.body.classList.remove('abgemeldet');
  $('#login').hidden = true;
  $('#login-form').reset();
  $('#sitzung').hidden = false;
  $('#angemeldet-als').textContent = benutzer.name;
  zeigen();
}

$('#login-form').onsubmit = async (e) => {
  e.preventDefault();
  const d = Object.fromEntries(new FormData(e.target).entries());
  const fehler = $('#login-fehler');
  try {
    if (einrichtung && d.passwort !== d.wdh) throw new Error('Die Passwörter stimmen nicht überein');
    const r = await api(einrichtung ? '/auth/einrichten' : '/auth/anmelden', {
      method: 'POST',
      body: { name: d.name, passwort: d.passwort },
    });
    angemeldet(r.benutzer);
  } catch (err) {
    fehler.textContent = err.message;
    fehler.hidden = false;
  }
};

$('#abmelden').onclick = async () => {
  await api('/auth/abmelden', { method: 'POST' }).catch(() => {});
  loginZeigen(false);
};

async function start() {
  try {
    const s = await api('/auth/status');
    if (s.benutzer) angemeldet(s.benutzer);
    else loginZeigen(s.einrichtung_noetig);
  } catch (err) {
    inhalt.innerHTML = `<p class="fehler">Server nicht erreichbar: ${esc(err.message)}</p>`;
  }
}

// ---------- Navigation ----------
async function zeigen() {
  const [tab, param] = (location.hash.slice(1) || 'uebersicht').split('/');
  const ansicht = ansichten[tab] || ansichten.uebersicht;
  const navTab = tab === 'kunde' ? 'kunden' : ansichten[tab] ? tab : 'uebersicht';
  document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('aktiv', a.dataset.tab === navTab));
  try {
    await ansicht(param);
  } catch (err) {
    inhalt.innerHTML = `<p class="fehler">Fehler beim Laden: ${esc(err.message)}</p>`;
  }
}

window.addEventListener('hashchange', () => {
  if (!document.body.classList.contains('abgemeldet')) zeigen();
});
start();
