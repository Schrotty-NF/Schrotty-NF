# Schrotty-NF – Verwaltung

Eine Verwaltungs-App für den Schrotthandel, die im Browser läuft. Sie verwaltet:

- **Übersicht**: Termine von heute und den nächsten 7 Tagen, offene Aufträge sowie Ankauf und Auszahlungen des laufenden Monats, auch nach Material aufgeschlüsselt
- **Aufträge & Abholtermine**: Abholung, Ankauf, Entrümpelung, Containerdienst; Status *offen / geplant / erledigt / storniert*
- **Ankäufe**: Material, Gewicht und Preis pro kg; der Auszahlungsbetrag wird automatisch berechnet; Monatsfilter mit Druckansicht
- **Kunden**: Kontaktdaten mit Suche; die Kundenseite zeigt alle Aufträge und Ankäufe des Kunden
- **Materialpreise**: die Ankaufspreise pro kg werden bei neuen Ankäufen vorgeschlagen

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

> Hinweis: Die App hat noch **keine Anmeldung**. Nur im eigenen Netz betreiben und nicht offen ins Internet stellen.

## Erste Schritte

1. Unter **Materialpreise** die eigenen Ankaufspreise eintragen. Alle Startpreise stehen auf 0 €.
2. Kunden anlegen.
3. Aufträge mit Termin anlegen. Sie erscheinen dann in der Übersicht.
4. Ankäufe beim Wiegen erfassen.

## Entwicklung

```bash
npm test
```

Aufbau:

- `server.js`: Startpunkt
- `src/db.js`: Datenbankschema und Startdaten
- `src/app.js`: REST-API unter `/api/...`
- `public/`: Oberfläche (HTML, CSS, JavaScript ohne Framework)
- `test/`: API-Tests
