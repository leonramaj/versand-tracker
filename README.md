# 📦 Versand-Tracker

Alle Sendungen an einem Ort verfolgen: **DHL, Deutsche Post, DPD, Hermes, GLS, UPS, FedEx, TNT, Amazon,
Österreichische Post, Schweizerische Post, PostNL, bpost, La Poste, Royal Mail, USPS, AliExpress/Cainiao** und viele mehr.
Die App erkennt den Paketdienst automatisch an der Sendungsnummer, zeigt Status und Verlauf an und lässt sich
auf dem Handy wie eine normale App installieren.

## Funktionen

- **Automatische Erkennung** des Paketdienstes anhand der Sendungsnummer, inkl. Prüfziffern-Kontrolle
  (UPS, DHL Express, internationale Post-Nummern) und Hinweis auf Tippfehler
- **Alle Postanbieter weltweit**: internationale Post-Sendungen (z. B. `RR123456785DE`) werden der Post
  des jeweiligen Landes zugeordnet; über Ship24 bzw. 17TRACK sind über 1.500 Paketdienste live abfragbar
- **Einheitlicher Status** für alle Dienste: Angekündigt → Unterwegs → In Zustellung → Zugestellt
  (plus Abholbereit, Zustellversuch fehlgeschlagen, Problem)
- **Sendungsverlauf** mit Zeit und Ort, voraussichtlichem Zustelltermin und Direktlink zur Sendungsverfolgung
  des Paketdienstes
- **Automatische Aktualisierung** alle 15 Minuten, optional mit **Benachrichtigung** bei Statusänderung
- **Installierbar als App** (PWA) auf Android, iPhone und Desktop – funktioniert auch offline mit den
  zuletzt bekannten Daten
- **Teilen aus anderen Apps** (Android): Versand-Mail „teilen“ → Versand-Tracker, die Nummer wird herausgesucht
- **Datenschutz**: Deine Sendungen werden nur in deinem Browser gespeichert; Export/Import als JSON-Datei
- Filter (Unterwegs / Zugestellt / Alle), Suche, Bezeichnungen, dunkles Design

## Schnellstart

Voraussetzung: [Node.js](https://nodejs.org) ab Version 20.12. Es müssen **keine Pakete installiert** werden.

```bash
git clone https://github.com/leonramaj/versand-tracker.git
cd versand-tracker
npm start
```

Dann im Browser **http://localhost:3000** öffnen. Zum Ausprobieren ohne API-Schlüssel die Demo-Nummern
`DEMO1` … `DEMO9` eingeben.

## Live-Status einrichten (API-Schlüssel)

Ohne Schlüssel funktionieren Erkennung, Links zu allen Paketdiensten und die Demo. Für den **Live-Status**
direkt in der App trägst du einen oder mehrere Schlüssel ein:

```bash
cp .env.example .env
# .env bearbeiten und Schlüssel eintragen, dann neu starten:
npm start
```

| Variable | Wofür | Woher |
| --- | --- | --- |
| `DHL_API_KEY` | DHL Paket, DHL Express, Deutsche Post (offizielle API, kostenlos) | [developer.dhl.com](https://developer.dhl.com) → App anlegen → API „Shipment Tracking – Unified“ |
| `SHIP24_API_KEY` | alle anderen Paketdienste weltweit (1.500+) | [ship24.com](https://www.ship24.com) → Dashboard → API |
| `TRACK17_API_KEY` | alle anderen Paketdienste weltweit (3.000+) | [api.17track.net](https://api.17track.net) → Settings → Access Key |

Es reicht ein Aggregator (Ship24 **oder** 17TRACK). Empfohlen: DHL-Schlüssel (kostenlos) + ein Aggregator.

So wählt der Server den Anbieter aus:

1. DHL- und Deutsche-Post-Nummern gehen zuerst an die offizielle DHL-API.
2. Findet DHL nichts (oder ist es kein DHL-Paket), fragt der Server Ship24 und danach 17TRACK.
3. Ohne passenden Schlüssel zeigt die App den Link zur Sendungsverfolgung des Paketdienstes.

Ergebnisse werden 10 Minuten zwischengespeichert (`CACHE_TTL_SECONDS`), damit kostenlose Kontingente reichen.
Bei 17TRACK werden neue Nummern automatisch angemeldet – die ersten Daten erscheinen dann nach wenigen Minuten.

## Auf dem Handy installieren

Die App muss dafür über **HTTPS** erreichbar sein (z. B. auf einem kleinen Server, siehe unten).

- **Android (Chrome):** Seite öffnen → Menü ⋮ → „App installieren“
- **iPhone (Safari):** Seite öffnen → Teilen-Symbol → „Zum Home-Bildschirm“

Im selben WLAN kannst du die App auch ohne Installation über `http://<IP-deines-PCs>:3000` im Handy-Browser nutzen.

## Betrieb auf einem Server

Mit Docker:

```bash
docker build -t versand-tracker .
docker run -d --name versand-tracker -p 3000:3000 --env-file .env --restart unless-stopped versand-tracker
```

Davor einen Reverse-Proxy mit HTTPS schalten (z. B. Caddy: `reverse_proxy localhost:3000`) und in der `.env`
`TRUST_PROXY=true` setzen. Der Server begrenzt Abfragen pro IP (`RATE_LIMIT_PER_MINUTE`), damit Fremde
nicht dein API-Kontingent verbrauchen.

## API

Der Server stellt eine kleine JSON-API bereit, die auch von anderen Programmen genutzt werden kann:

| Endpunkt | Beschreibung |
| --- | --- |
| `GET /api/track?number=…[&carrier=dpd][&force=1]` | Status und Verlauf einer Sendung |
| `GET /api/detect?number=…` | mögliche Paketdienste mit Tracking-Links |
| `GET /api/info` | aktive Live-Anbieter |

<details>
<summary>Beispielantwort von <code>/api/track</code></summary>

```json
{
  "number": "00340434161094042557",
  "carrier": { "id": "dhl", "name": "DHL Paket" },
  "trackingUrl": "https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode=00340434161094042557",
  "provider": "DHL API",
  "status": "out_for_delivery",
  "statusText": "Die Sendung wurde in das Zustellfahrzeug geladen.",
  "estimatedDelivery": "2026-09-29",
  "events": [
    { "time": "2026-09-28T07:12:00.000Z", "description": "Die Sendung wurde in das Zustellfahrzeug geladen.", "location": "Köln", "status": "out_for_delivery" }
  ],
  "fetchedAt": "2026-09-28T08:00:00.000Z"
}
```

Mögliche Status: `pending`, `info_received`, `in_transit`, `out_for_delivery`, `available_for_pickup`,
`failed_attempt`, `delivered`, `exception`, `expired`, `unknown`.
</details>

## Entwicklung

```bash
npm run dev   # Server mit automatischem Neustart
npm test      # Tests (Erkennung, Anbieter-Anbindungen, Server)
```

Projektstruktur:

```
shared/      Paketdienst-Verzeichnis, Erkennung und Status (von Server und Browser genutzt)
server/      HTTP-Server, Tracking-Service und Anbindungen (DHL, Ship24, 17TRACK, Demo)
public/      Web-App (HTML, CSS, JavaScript, Service Worker, Icons)
test/        Tests mit node:test
```

Einen neuen Paketdienst ergänzt du in `shared/carriers.js`: Eintrag mit Name, Farben, Tracking-Link
(`{n}` = Sendungsnummer) und Mustern für die Erkennung.
