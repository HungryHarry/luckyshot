# 🎯 LuckyShot

Ein Echtzeit-Partyspiel für bis zu 30 Spieler: Wähle eine Zahl, die sonst niemand wählt.
Läuft als statische Seite auf GitHub Pages. Für die Echtzeit-Synchronisation nutzt es die Firebase Realtime Database.

## Spielregeln

- Jede Runde wählt jeder Spieler innerhalb von **10 Sekunden** eine Karte von **1 bis Anzahl der verbliebenen Spieler**.
- Wählen zwei oder mehr Spieler **dieselbe Zahl**, fliegen sie alle raus und landen auf dem Friedhof.
- Wer **keine Karte** wählt, fliegt ebenfalls raus.
- Haben in einer Runde **alle dieselbe Zahl**, gewinnen alle verbliebenen Spieler gemeinsam.
- Bleibt nur **ein Spieler** übrig, gewinnt er als Last Man Standing.
- Fliegen **alle** gleichzeitig raus (z. B. 3-3-1-1), **verliert die Gruppe** und es gibt keinen Gewinner.

## Dateien

| Datei | Zweck |
|---|---|
| `index.html` | Einstiegsseite |
| `app.js` | Spiellogik, Rendering und Datenanbindung |
| `i18n.js` | Alle Texte auf Deutsch und Englisch |
| `styles.css` | Design auf Basis des Verivox Design Systems (`--ds-*`-Tokens oben in `:root`) |
| `fonts/` | Selawik 400/700 (DS-Hausschrift, aus dem Verivox DS übernommen) |
| `config.js` | Firebase-Zugang (gemeinsames Projekt mit Farbspur), Demo-Code und Zeiten |
| `database.rules.json` | Komplette Sicherheitsregeln: Farbspur + LuckyShot zusammengeführt |

## Sofort testen (Demo-Modus, ohne Firebase)

Ist in `config.js` kein `apiKey` eingetragen, läuft das Spiel im **Demo-Modus**. Zum lokalen Testen kannst du den `apiKey` vorübergehend leeren.
Dann synchronisiert es nur zwischen Tabs **im selben Browser**.

```bash
cd luckyshot
python3 -m http.server 8000
# → http://localhost:8000 öffnen
```

1. Gib einen Namen ein und wähle einen Avatar. Öffne „Ich bin Spielleiter“ und gib den Code `LUCKY2026` ein (der Demo-Code aus `config.js`). Dann auf **Beitreten** klicken.
2. Füge mit **+ Testbot / + 5 Bots** Mitspieler hinzu, oder öffne weitere Tabs als echte Spieler.
3. Klicke auf **Spiel starten**.

> Die Seite muss über einen Webserver laufen (wegen der ES-Module). Ein Doppelklick auf `index.html` reicht nicht.

## Firebase einrichten (gemeinsames Projekt mit Farbspur)

LuckyShot nutzt dasselbe Firebase-Projekt und dasselbe Sicherheitsmodell wie Farbspur:
Jeder Spieler wird im Hintergrund **anonym angemeldet**, und der **Server prüft den Spielleiter-Code**.

1. **Zugangsdaten:** Sie sind in `config.js` bereits eingetragen (Projekt `farbspur`).
2. **Anonyme Anmeldung:** Prüfe unter **Build → Authentication → Sign-in method**, ob „Anonym“ aktiviert ist. Bei Farbspur sollte das schon so sein.
3. **Spielleiter-Code anlegen:** Gehe zu **Realtime Database → Daten**, fahre mit der Maus über den Knoten `config` und klicke auf **+**.
   Name: `luckyshotHostKey`, Wert: dein Code, z. B. `Lucky2026` (Groß- und Kleinschreibung zählt).
   Soll es derselbe Code wie bei Farbspur sein, kopiere einfach den Wert von `config/hostKey`.
   Der Code steht nur in der Datenbank. Niemand kann ihn dort auslesen, und er taucht nirgends im Code auf.
4. **Regeln:** Ersetze im Tab **Regeln** den gesamten Inhalt durch `database.rules.json` und klicke auf **Veröffentlichen**.
   Die Datei enthält die bisherigen Farbspur-Regeln unverändert und zusätzlich die LuckyShot-Regeln.

Was die Regeln absichern:
- Lesen dürfen nur angemeldete Spieler.
- Jeder Spieler darf nur seinen eigenen Eintrag anlegen, und das nur in der Lobby. Danach kann er nur noch selbst austreten.
- Eine Zahl darf ein Spieler nur für sich selbst wählen, und nur solange die Runde läuft und er noch im Spiel ist.
- Spielstatus, Auswertung, Entfernen von Spielern und Testbots sind nur dem Spielleiter erlaubt, also nur mit gültigem Code.

## Auf GitHub Pages veröffentlichen

1. Lege ein neues Repository an, z. B. `luckyshot`, und lade alle Dateien ins Hauptverzeichnis hoch.
2. Gehe zu **Settings → Pages → Build and deployment**, wähle als Source „Deploy from a branch“ und als Branch `main` / `/root`.
3. Nach ca. 1 Minute ist das Spiel erreichbar unter `https://<user>.github.io/luckyshot/`.
4. Optional für mehr Sicherheit: Trage in der Google Cloud Console unter API-Schlüssel die GitHub-Pages-Domain als HTTP-Referrer ein.

## Ablauf für den Spielleiter

- Teile den Link. Mit `?room=teamevent` erzeugst du einen eigenen Raum, z. B. `…/luckyshot/?room=teamevent`.
- Der Spielleiter meldet sich mit Code an und spielt selbst mit (👑).
  Wer bereits beigetreten ist, kann sich auch nachträglich oben über **„Spielleiter?“** anmelden.
- In der Lobby kann der Spielleiter Spieler entfernen (✕). Ab 2 Spielern lässt sich das Spiel starten.
- Ablauf jeder Runde: 3 s „Bereit?“, 10 s Wählen, dann automatisches Aufdecken. Danach bleibt das Ergebnis stehen,
  bis der Spielleiter auf **„Runde X starten“** klickt. Ist das Spiel entschieden, klickt er auf **„Siegertreppchen zeigen“**.
- Nach Spielende startet **Neues Spiel** eine neue Partie. Alle Spieler bleiben in der Lobby, und neue können dazukommen.
- Sprache: Oben rechts wählt jeder Spieler **DE** oder **EN**. Die Wahl wird im Browser gespeichert, beim ersten Besuch gilt die Browsersprache.
- Testbots gibt es im Demo-Modus immer. Im Firebase-Modus erscheinen sie nur mit `?bots=1` in der URL.

## Wichtig zu wissen

- **Das Gerät des Spielleiters ist der Schiedsrichter.** Es wertet die Runden aus.
  Lass den Tab im Vordergrund geöffnet, am besten auf einem Laptop oder Beamer. Ist der Tab geschlossen oder das Handy gesperrt, pausiert das Spiel.
  Nach dem Neuladen geht es weiter.
- Alle Zeiten basieren auf der Firebase-Serverzeit. So sehen alle Spieler denselben Countdown.
- Der Spielleiter-Code wird vom Server geprüft. `hostCode` in `config.js` gilt nur für den Demo-Modus.
- Die gewählten Zahlen sind für angemeldete Spieler lesbar, damit sie beim Aufdecken angezeigt werden können. Ein technisch versierter Spieler könnte sie also während der Runde in den Entwicklertools sehen. Für ein Teamevent ist das unkritisch.
- Zeiten, Spielerzahl und Code lassen sich in `config.js` anpassen. Farben, Typo, Abstände und Radien stammen aus dem Verivox Design System (`--ds-*`-Tokens in `styles.css` → `:root`): Orange `#FF5600` nur für den Haupt-CTA und aktive Zustände, Selawik als Schrift, Buttons nach `ds-button` (primary/secondary/tertiary), Karten mit 1px-Rahmen statt Schatten. Der Friedhof ist bewusst eine eigene, dunkle Spielwelt.
