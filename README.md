# Mein Revier – Hegen, Ernten, Ansitzen

Revier-Aufbauspiel für Jäger nach dem Hay-Day-Prinzip. Läuft als installierbare Web-App (PWA) im Handy-Browser.

## Aufbau

- **Frontend:** statische Dateien ohne Build-Schritt (`index.html`, `style.css`, `js/`). Läuft auf GitHub Pages.
- **Backend:** Supabase-Projekt `revier-spiel` (Frankfurt). Die gesamte Spiellogik liegt als Datenbank-Funktionen auf dem Server – der Browser zeigt nur an.
- **Timer:** als Zeitstempel gespeichert; alles wächst weiter, auch wenn die App zu ist.
- **Wirtschaft als Daten:** Pflanzen, Rezepte, Preise, Level und Drop-Raten stehen in den `cfg_*`-Tabellen und lassen sich ohne neue Version ändern.
- **Anmeldung:** Gastzugang (anonym) beim ersten Start; „Revier übertragen“ per Code.

## Lokal testen

```bash
node test/ui-test.mjs   # Handy-Simulation mit nachgebautem Server, Screenshots in test/shots/
```

## Meilenstein 1 (fertig)

Wildäcker (Wischen zum Säen/Ernten), Futtermühle, Hochsitz am Wildacker mit Ansitz-Szene, Wildkammer, Wildküche, Räucherei, Kanzel an der Kirrung, Gasthaus-Aufträge, Lager mit Ausbau über Baumaterial, Verkauf, Level 1–15 mit Freischaltungen, Saatgut-Kauf.

## Nächste Schritte

1. Push-Nachrichten („Dein Hochsitz hat Anblick“)
2. Revier per E-Mail sichern
3. Hofladen + „Jagdblatt“ (Spielermarkt)
4. Hegering + Hegering-Pokal
5. Eigene Grafiken statt Emoji
