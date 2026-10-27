# Architecture

```mermaid
flowchart LR
  UI[React + 360 panorama] --> API[Express authorization]
  API --> DB[SQLite revisions and audit]
  API --> MODEL[Object / action / capability contracts]
  MODEL --> MOCK[Virtual device adapter]
  MODEL --> AI[Scripted showcase planner]
  API --> PUB[Explicit showroom snapshot]
  PUB --> TOUR[Read-only visitor runtime]
```

Private Home and the public-viewer model share presentation components, not
provider command authority. Demo startup uses only the included public CC0
media and synthetic object model. External adapters remain inspectable source,
but receive no credentials and cannot make external connections in demo mode.

The historical update fixture contains client source only. Installer tests
operate on disposable folders, a fake service manager and local HTTP fixtures;
they do not target the owner's original installation.
