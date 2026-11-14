# Schrotty-NF – Verwaltung

Eine Verwaltungs-App für den Schrotthandel, die im Browser läuft. Sie verwaltet:

- **Übersicht**: Termine von heute und den nächsten 7 Tagen, offene Aufträge sowie Ankauf und Auszahlungen des laufenden Monats, auch nach Material aufgeschlüsselt
- **Aufträge & Abholtermine**: Abholung, Ankauf, Entrümpelung, Containerdienst; Status *offen / geplant / erledigt / storniert*
- **Ankäufe**: Material, Gewicht und Preis pro kg; der Auszahlungsbetrag wird automatisch berechnet; Monatsfilter mit Druckansicht
- **Kunden**: Kontaktdaten mit Suche; die Kundenseite zeigt alle Aufträge und Ankäufe des Kunden
- **Materialpreise**: die Ankaufspreise pro kg werden bei neuen Ankäufen vorgeschlagen
- **Anmeldung & Benutzer**: Zugang nur mit Benutzername und Passwort; weitere Benutzer anlegen, Passwörter ändern

## Starten

Voraussetzung: [Node.js](https://nodejs.org) ab Version 22.5.

```bash
npm install
npm start
```

Danach im Browser **http://localhost:3000** öffnen.

Die Daten werden in `data/schrotty.db` (SQLite) gespeichert. Für eine Sicherung reicht es, diese Datei zu kopieren.

### Einstellungen

| Variable  | Standard              | Bedeutung |
|-----------|-----------------------|-----------|
| `PORT`    | `3000`                | Port des Servers |
| `HOST`    | `127.0.0.1`           | `0.0.0.0` setzen, um von Handy/Tablet im selben WLAN zuzugreifen |
| `DB_PATH` | `data/schrotty.db`    | Speicherort der Datenbank |

### Anmeldung

Beim allerersten Aufruf fragt die App nach dem **ersten Zugang** (Benutzername und Passwort, mind. 8 Zeichen). Danach ist alles nur noch nach Anmeldung erreichbar. Weitere Benutzer legst du unter **Benutzer** an. Alle Benutzer haben die gleichen Rechte.

- Passwörter werden nur als Hash (scrypt) gespeichert.
- Eine Anmeldung bleibt 30 Tage gültig, „Abmelden“ beendet sie sofort.
- Nach 10 falschen Versuchen wird die Anmeldung von dieser Adresse für 15 Minuten gesperrt.
- Ändert man ein Passwort, werden alle anderen Sitzungen dieses Benutzers beendet.

> Den ersten Zugang **gleich nach dem ersten Start** anlegen: Solange keiner existiert, könnte ihn jeder im Netz anlegen.
>
> Für den Betrieb über das Internet die App hinter HTTPS stellen (z. B. über einen Reverse-Proxy), sonst werden Passwörter unverschlüsselt übertragen.

**Passwort vergessen?** Ein anderer Benutzer kann es unter *Benutzer* neu setzen. Gibt es keinen anderen Benutzer, die Tabelle `benutzer` in der Datenbank leeren (z. B. `sqlite3 data/schrotty.db "DELETE FROM benutzer;"`). Beim nächsten Aufruf fragt die App dann wieder nach dem ersten Zugang. Alle anderen Daten bleiben erhalten.

## Erste Schritte

1. Den ersten Zugang anlegen (erscheint beim ersten Aufruf automatisch).
2. Unter **Materialpreise** die eigenen Ankaufspreise eintragen. Alle Startpreise stehen auf 0 €.
3. Kunden anlegen.
4. Aufträge mit Termin anlegen. Sie erscheinen dann in der Übersicht.
5. Ankäufe beim Wiegen erfassen.

## Entwicklung

```bash
npm test
```

Aufbau:

- `server.js`: Startpunkt
- `src/db.js`: Datenbankschema und Startdaten
- `src/app.js`: REST-API unter `/api/...`
- `src/auth.js`: Anmeldung, Sitzungen und Benutzerverwaltung
- `public/`: Oberfläche (HTML, CSS, JavaScript ohne Framework)
- `test/`: API-Tests
