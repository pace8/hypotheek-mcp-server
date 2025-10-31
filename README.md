# Hypotheek MCP Server

Een Model Context Protocol (MCP) server voor hypotheekberekeningen en actuele rentetarieven.

<a href="https://glama.ai/mcp/servers/@pace8/mcp-hypotheken-berekenen">
  <img width="380" height="200" src="https://glama.ai/mcp/servers/@pace8/mcp-hypotheken-berekenen/badge" alt="mcp-hypotheken-berekenen MCP server" />
</a>

## ✨ Features

- 🏠 **Maximale hypotheek berekening** - Bereken de maximale hypotheek op basis van inkomen, leeftijd, en bestaande leningen
- 💰 **Actuele rentes** - Haal de top 5 laagste hypotheekrentes op (NHG, non-NHG, verschillende LTV klasses)
- 🔌 **Stdio transport** - Optimaal voor Glama.ai en Claude Desktop
- ⚡ **Simpel & Betrouwbaar** - Minimale dependencies, maximale stabiliteit

## 🚀 Quick Start

### Installatie

```bash
git clone https://github.com/pace8/hypotheek-mcp-server.git
cd hypotheek-mcp-server
npm install
```

### Configuratie

Maak een `.env` bestand:

```env
REPLIT_API_KEY=your_api_key_here
```

### Build & Run

```bash
npm run build
npm start
```

## 📦 Deployment op Glama.ai

1. Push je code naar GitHub
2. Ga naar [glama.ai](https://glama.ai)
3. Koppel je repository
4. Zet `REPLIT_API_KEY` als environment variabele
5. Deploy! ✅

Glama.ai gebruikt automatisch stdio transport - geen extra configuratie nodig.

## 🛠️ Development

```bash
npm run dev  # Watch mode met hot reload
```

## 📚 API / Tools

### 1. bereken_hypotheek

Berekent de maximale hypotheek en maandlasten.

**Input:**
- `aanvragers`: Inkomen en geboortedatum van aanvrager(s)
- `bestaande_lening` (optioneel): Voor doorstromers met bestaande hypotheek
- `nieuwe_lening` (optioneel): Specifieke parameters voor nieuwe lening

**Output:**
- Maximale hypotheek
- Bruto maandlasten
- Overwaarde (bij doorstromers)
- Energielabel informatie

### 2. haal_actuele_rentes_op

Haalt de meest actuele top 5 laagste hypotheekrentes op.

**Input:** Geen parameters vereist

**Output:**
- Top 5 rentes per categorie (NHG, non-NHG, LTV klasses)
- Nieuwbouw vs bestaande bouw
- Per hypotheeksoort (annuïteit, lineair, aflossingsvrij)

## 🏗️ Project Structuur

```
hypotheek-mcp-server/
├── src/
│   └── index.ts          # Main server file
├── build/                # Compiled JavaScript
├── .env                  # Environment variables
├── package.json          # Dependencies
└── tsconfig.json         # TypeScript config
```

## 🔧 Environment Variabelen

| Variabele | Vereist | Beschrijving |
|-----------|---------|--------------|
| `REPLIT_API_KEY` | ✅ | API key voor Replit backend |

## 📖 MCP Protocol

Deze server implementeert het [Model Context Protocol](https://modelcontextprotocol.io/) en gebruikt stdio transport voor communicatie met MCP clients zoals:

- Claude Desktop
- Glama.ai
- Andere MCP-compatible tools

## 🔄 Recente Veranderingen

**v1.0.0** - Stdio-only release
- ✅ Verwijderd: SSE transport en Express dependency
- ✅ Vereenvoudigd: Alleen stdio transport
- ✅ Verbeterd: Kleinere bundle, snellere startup
- ✅ Geoptimaliseerd: Perfect voor Glama.ai

Zie [MIGRATION_GUIDE.md](./MIGRATION_GUIDE.md) voor meer details.

## 🐛 Troubleshooting

### Server start niet
- Check of `REPLIT_API_KEY` is ingesteld in `.env`
- Run `npm install` opnieuw
- Check `npm run build` voor errors

### API errors
- Verifieer dat je API key geldig is
- Check of de Replit backend online is
- Check network connectivity

### Glama.ai deployment
- Zorg dat environment variabelen zijn ingesteld in Glama.ai dashboard
- Check logs voor "stdio mode" bericht
- Verify repository URL is correct

## 📝 License

MIT

## 🤝 Contributing

Contributions zijn welkom! Open een issue of pull request.

## 🙋‍♂️ Support

Voor vragen of problemen:
1. Check de [MIGRATION_GUIDE.md](./MIGRATION_GUIDE.md)
2. Open een GitHub issue
3. Contact via Glama.ai community

## 🔗 Links

- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Glama.ai](https://glama.ai)
- [MCP SDK Docs](https://github.com/modelcontextprotocol/typescript-sdk)