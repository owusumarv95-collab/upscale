# Video-Upscaler — Einrichtung

Dauer: etwa 15 Minuten. Kein Terminal, kein VS Code. Alles im Browser.

Was du am Ende hast: eine eigene Adresse wie
`https://video-upscaler-xyz.up.railway.app`, hinter Login, als Symbol auf
dem Handy-Startbildschirm.

---

## Schritt 1 — Code auf GitHub legen

1. https://github.com/new öffnen (mit deinem Konto `owusumarv95-collab`)
2. Repository name: `video-upscaler`
3. **Private** anklicken
4. „Create repository" drücken
5. Auf der nächsten Seite: „uploading an existing file" anklicken
6. Den **Inhalt** des entpackten Ordners `video-upscaler` in das Fenster
   ziehen — also die Dateien `server.js`, `package.json`, `Dockerfile`,
   `.dockerignore`, `.gitignore` **und den Ordner `public`**.
   Chrome und Edge übernehmen Ordner samt Inhalt beim Ziehen.
7. Unten „Commit changes" drücken

Kontrolle: Im Repository müssen jetzt liegen
`Dockerfile`, `package.json`, `server.js`, `public/` (mit 4 Dateien darin).

---

## Schritt 2 — Auf Railway starten

1. https://railway.com öffnen → „Login" → „Login with GitHub"
2. „New Project" → „Deploy from GitHub repo"
3. Beim ersten Mal fragt GitHub, auf welche Repositories Railway zugreifen
   darf → `video-upscaler` freigeben
4. `video-upscaler` auswählen → „Deploy Now"

Railway erkennt die Datei `Dockerfile` und baut den Server. Das dauert
2–4 Minuten. Der erste Start **schlägt absichtlich fehl**, weil noch keine
Zugangsdaten gesetzt sind. Das ist der nächste Schritt.

---

## Schritt 3 — Zugangsdaten setzen

Im Railway-Projekt auf den Dienst klicken → Reiter **„Variables"** →
„New Variable". Drei Stück anlegen:

| Name | Wert |
|---|---|
| `APP_USER` | dein Benutzername, z. B. `naowu` |
| `APP_PASS` | ein langes Passwort (mindestens 12 Zeichen) |
| `SESSION_SECRET` | eine beliebige lange Zufallszeichenkette, 30+ Zeichen, z. B. per https://www.random.org/strings/ |

`SESSION_SECRET` ist der Schlüssel, mit dem der Server deine Anmeldung
signiert. Du musst ihn dir nicht merken, er darf nur nicht leer sein.

Optional:

| Name | Standard | Bedeutung |
|---|---|---|
| `MAX_UPLOAD_MB` | `4000` | Obergrenze pro Video in Megabyte |
| `KEEP_HOURS` | `24` | Nach so vielen Stunden werden fertige Videos gelöscht |
| `SESSION_DAYS` | `30` | So lange bleibst du auf dem Handy eingeloggt |

Nach dem Speichern startet Railway den Dienst automatisch neu.

---

## Schritt 4 — Adresse erzeugen

Reiter **„Settings"** → Abschnitt **„Networking"** → „Generate Domain".

Wenn nach einem Port gefragt wird: `3000`.

Die Adresse sieht dann so aus: `https://video-upscaler-production-xxxx.up.railway.app`

Aufrufen → Login-Seite muss erscheinen.

---

## Schritt 5 — Verknüpfung auf dem Handy

1. Adresse in **Chrome** auf dem Handy öffnen
2. Anmelden
3. Drei-Punkte-Menü oben rechts → **„Zum Startbildschirm hinzufügen"**
   (bei neueren Chrome-Versionen heißt es „App installieren")

Das Symbol öffnet die Seite ohne Browserleiste, wie eine App. Du bleibst
30 Tage angemeldet, danach einmal neu einloggen.

---

## Benutzen

1. Symbol antippen
2. **„Video upscalen"** drücken → Android öffnet die Dateiauswahl
3. Video wählen → Upload startet sofort, Fortschritt wird angezeigt
4. Nach dem Upload rechnet der Server. Du kannst die Seite schließen und
   das Handy weglegen. Die Rechnung läuft weiter.
5. Beim nächsten Öffnen: **„Herunterladen"** → landet im Download-Ordner
   und erscheint in der Galerie

Zielauflösung: Standard ist „So weit wie es geht" — doppelte Kantenlänge,
höchstens 4K. Aus 720p wird 1440p, aus 1080p wird 4K. Ein Video, das
schon 4K ist, wird nur nachgeschärft.

---

## Was es kostet und wie lange es dauert

**Railway:** 30 Tage Testphase mit 5 Dollar Guthaben, ohne Kreditkarte.
Danach Hobby-Plan, 5 Dollar im Monat, darin 5 Dollar Nutzungsguthaben.
Ein Server, der nur auf Uploads wartet, verbraucht fast nichts. Die
Rechenzeit fürs Upscaling wird sekundengenau abgerechnet — ein
10-Minuten-Video liegt grob bei 2 bis 5 Cent. Unsicher nach oben: Wenn
du viele lange Videos in 4K rechnest, kann das Guthaben überschritten
werden, dann kommt der Mehrverbrauch obendrauf. Railway zeigt den
Verbrauch live im Dashboard.

**Rechenzeit** auf dem Railway-Server, grobe Hausnummern:

| Video | Ziel | Dauer |
|---|---|---|
| 5 Min, 720p | 1440p | 3–6 Min |
| 5 Min, 1080p | 4K | 10–20 Min |
| 20 Min, 480p | 960p | 5–10 Min |
| 20 Min, 1080p | 4K | 40–80 Min |

Dazu kommt der Upload. Ein 500-MB-Video braucht im WLAN 1–3 Minuten, über
Mobilfunk deutlich länger — und kostet Datenvolumen.

---

## Wenn etwas nicht geht

**„Application failed to respond"** — Variablen fehlen oder falsch
geschrieben. Reiter „Deployments" → „View Logs" → dort steht die
Fehlermeldung im Klartext.

**Upload bricht bei großen Dateien ab** — WLAN statt Mobilfunk. Oder
`MAX_UPLOAD_MB` ist zu niedrig gesetzt.

**Fertige Videos verschwinden nach Neustart** — Normal: Railway löscht die
Festplatte beim Neustart des Dienstes. Wer das nicht will: im Dienst
rechte Maustaste → „Add Volume" → Mount Path `/data`. Kostet ein paar
Cent pro Monat pro Gigabyte.

**Passwort vergessen** — in den Variables `APP_PASS` ändern, fertig.

**Sperre nach Fehlversuchen** — 5 falsche Passwörter sperren die
IP-Adresse für 15 Minuten. Absichtlich.
