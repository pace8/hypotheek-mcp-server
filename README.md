# Hypotheek MCP Server v5.0

MCP-server voor Nederlandse hypotheekberekeningen. Levert compacte tools, prompts en resources zodat AI-agents (n8n, Claude, GPT, ...) direct hypotheekvragen kunnen afhandelen.

---

## 🚀 Quick Start

```bash
git clone https://github.com/pace8/hypotheek-mcp-server.git
cd hypotheek-mcp-server
npm install
cp .env.example .env   # vul je REPLIT_API_KEY in
npm run build
npm start
```

- `npm run dev` — TypeScript watch mode
- `npm test` — Jest test suites
- `npm run lint` — ESLint controle

Meer configuratie-opties staan in [`docs/CONFIG.md`](./docs/CONFIG.md).

---

## 🛠️ Beschikbare tools

| Tool | Beschrijving | Output |
|------|---------------|--------|
| `bereken_hypotheek_starter` | Maximale hypotheek voor starters | Max bedrag + maandlast + NHG-vergelijking |
| `bereken_hypotheek_doorstromer` | Maximale hypotheek voor doorstromers | Max bedrag + maandlast + overwaarde |
| `bereken_hypotheek_uitgebreid` | Maatwerkparameters (rente, looptijd, energielabel) | Custom leenbedrag |
| `opzet_hypotheek_starter` | Complete financiering voor gewenste woning (starter) | Totaal benodigd bedrag + financieringsmix + maandlast |
| `opzet_hypotheek_doorstromer` | Financieringsmix voor doorstromers (bestaand + nieuw) | Benodigd bedrag + overwaarde + maandlasten |
| `opzet_hypotheek_uitgebreid` | Opzet met maatwerk leningdelen | Custom opzet, zowel bestaand als nieuw |
| `haal_actuele_rentes_op` | Actuele rentes per rentevaste periode | JSON met NHG en niet-NHG tarieven |

---

## 📚 MCP Resources & Prompts

- `hypotheek://v4/guide/opzet-intake` — intake checklist, defaults & velddefinities
- `hypotheek://v4/guide/output-formatting` — hoe je tooloutput toont aan klanten
- `hypotheek://v4/guide/quick-ref` — toolselectie, formatregels, valkuilen
- `hypotheek://v4/guide/playbook` — 10 uitgewerkte voorbeeldgesprekken

Prompts (`list_prompts`) verwijzen automatisch naar deze resources zodat agents detailinformatie kunnen ophalen wanneer nodig.

---

## 🔧 Development notes

- Config wordt centraal geladen via `src/config/index.ts` (Zod-validatie)
- Toolhandlers zitten in `src/index.ts` en gebruiken gedeelde helperfuncties
- Markdown-resources wonen in `docs/` en worden via `src/resources/index.ts` beschikbaar gemaakt
- Testen draaien op Node ≥18 met Jest (ESM + ts-jest)

Zie [`CHANGELOG.md`](./CHANGELOG.md) voor volledige release notes.
