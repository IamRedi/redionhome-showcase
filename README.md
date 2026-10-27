# RediOnHome

**Dein Raum. Vernetzt. Unter deiner Kontrolle.**

Eine räumliche Benutzeroberfläche für Räume, Inhalte und vernetzte Objekte: 360° erkunden, ein Objekt auswählen, im Kontext bearbeiten und gezielt als Showroom freigeben.

[![CI](https://github.com/IamRedi/redionhome-showcase/actions/workflows/ci.yml/badge.svg)](https://github.com/IamRedi/redionhome-showcase/actions/workflows/ci.yml)

**React · TypeScript · Photo Sphere Viewer · Express · SQLite · Local-first**

![Actual application with public CC0 demonstration panorama](docs/assets/screenshots/space.webp)

**[English](README.en.md)** · [Verification](EVIDENCE.md) · [Architecture](docs/ARCHITECTURE.md) · [Media provenance](docs/MEDIA.md)


> **Nachweisstand und Grenzen:** Separater, bereinigter Evaluationsstand mit unabhängigen CC0-Demoräumen; die private Heiminstallation und ihre Daten werden nicht veröffentlicht. Der Nachweis trennt nachgebautes Verhalten, implementierte Adapter und tatsächlich auf Hardware geprüfte Integrationen. [Prüfprotokoll (EN)](EVIDENCE.md).

## Eine Oberfläche, mehrere Perspektiven

- **Räume erleben:** Panorama, Portale zwischen Ansichten und Objekte direkt im Bild. Die Demo-Verbindungen sind illustrativ, kein vermessener Grundriss.
- **Im Kontext bearbeiten:** Objekt auswählen, passende Felder bearbeiten, Vorschau ansehen und versioniert speichern. Konflikte überschreiben keine fremde Änderung.
- **Freigabe bewusst gestalten:** Private Home und Showroom nutzen getrennte Objektprofile und ausdrücklich ausgewählte Snapshots. Private Änderungen veröffentlichen sich nicht automatisch.
- **Aktionen nachvollziehen:** R AI, Lejet (Berechtigungen), Ambiente und Aktiviteti nutzen die vorhandene Vorschlags-, Berechtigungs- und Ausführungsoberfläche. Hier reagieren ausschließlich virtuelle Geräte auf einen klar beschrifteten Offline-Skript-Assistenten.

## Kurzer Rundgang

[![Actual application screenshot sequence](docs/assets/video/walkthrough-preview.webp)](docs/assets/video/walkthrough-de.mp4)

**[Video DE](docs/assets/video/walkthrough-de.mp4)** · **[Video EN](docs/assets/video/walkthrough-en.mp4)** · [Transcript](docs/assets/video/transcript.md)

Der stumme Rundgang ist ein beschrifteter Montageschnitt aus echten Screenshots dieser lokalen Demo. Keine private Wohnung, keine Live-KI und keine physische Geräteaktion. Die Produktoberfläche ist derzeit **Albanisch**; Dokumentation und Videotitel sind DE/EN.

| Objekt im Kontext | Visuell bearbeiten |
|---|---|
| ![Object panel](docs/assets/screenshots/object.webp) | ![Existing visual editor](docs/assets/screenshots/editor.webp) |

| Berechtigungen | Getrennter Showroom |
|---|---|
| ![Permissions for virtual devices](docs/assets/screenshots/permissions.webp) | ![Explicit visitor preview](docs/assets/screenshots/showroom.webp) |

## Lokal ausprobieren

**Linux / WSL2, Node.js 22.12+, npm, WebGL-Browser.** FFmpeg/ffprobe, Poppler und gegebenenfalls Python/make/g++ werden für Medienverarbeitung und native SQLite benötigt.
```bash
npm ci
npm run demo:fetch
npm run demo:build
npm run demo
```

**http://127.0.0.1:8780** · Demo-Login: **owner** / **showcase-local-demo-only**

Das ist ein öffentlich dokumentiertes Demo-Passwort für fiktive lokale Daten, kein Zugang zur privaten Installation. Die Installation und `demo:fetch` benötigen Internet; die laufende Demo blockiert externe Verbindungen.

Der Launcher erstellt ausschließlich `.demo/`, übernimmt keine Provider-Schlüssel oder persönliche Konfiguration und verweigert eine unbekannte vorhandene Datenbank. Die beiden Panorama-Dateien werden gegen feste SHA-256-Werte geprüft. Demo-Änderungen bleiben nach einem Neustart erhalten. Zum Zurücksetzen nach dem Stoppen nur das erzeugte `.demo/` entfernen.

Im Assistenten können Sie `Hap studion` oder `Ndiz dritën` eingeben. Die Antwort ist absichtlich geskriptet. Für virtuelle Aktionen müssen die passenden Lejet erst bewusst erteilt werden. Mikrofon und echte Provider sind in der Demo deaktiviert.

```bash
docker compose up --build
```

Docker veröffentlicht ausschließlich den Loopback-Port und verwendet flüchtige Demo-Daten. Container- und Betriebssystemnachweise stehen im Prüfprotokoll; dies ist keine Freigabe für öffentliches Hosting.

## Qualität und Grenzen

```bash
npm run ci:quality
node scripts/showcase-smoke.mjs
```

Die CI prüft Veröffentlichungsdateien, Lint, Backend, Build, Desktop/Mobile, den echten Legacy-Update-/Draft-Pfad, Gitleaks und den Container. Der Legacy-Client ist als reine Quellcode-Testfixture enthalten; private Git-Historie und Betriebsdaten werden nicht übernommen. [Tatsächlich ausgeführte Prüfungen](EVIDENCE.md).

Dies ist ein entwickelter Prototyp, kein fertiges universelles Smart-Home- oder Mehrbenutzer-Cloudprodukt. Adaptercode, simulierte Aktionen und physisch verifizierte Integration sind unterschiedliche Nachweise. Vollständige TV-/LED-/Druckersteuerung, Energie-/Kostenhistorie und Spaces Lite als öffentlicher Dienst werden hier nicht behauptet. [Umfang](docs/PUBLIC_SCOPE.md) · [Sicherheit](SECURITY.md).

## Autor und Medien

**Redion Cekrezi / RediON** · [GitHub](https://github.com/IamRedi)

Source-available zur lokalen Bewertung; Produktion, kommerzielle Nutzung und Weiterverteilung benötigen schriftliche Erlaubnis. Kein Open-Source-Lizenzversprechen. [Lizenz](LICENSE).

Panoramen: **Artist Workshop** von Oliksiy Yakovlyev und **Brown Photostudio 02** von Sergej Majboroda — [Poly Haven, CC0](assets/demo/PROVENANCE.md). Dies sind unabhängige, öffentlich nutzbare Demoräume und keine Aufnahmen aus der Privatwohnung des Autors. Für Inhalte Dritter gelten deren jeweilige Lizenzen.
