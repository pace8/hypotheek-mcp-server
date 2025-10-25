# Hypotheek MCP Server

Een Model Context Protocol (MCP) server voor hypotheekberekeningen en actuele rentetarieven.

## Features

- 🏠 Maximale hypotheek berekening
- 💰 Actuele rentes ophalen
- 🔄 SSE streaming support voor Glama.ai

## Installatie
```bash
npm install
npm run build
npm start
```

## Environment Variables

- `REPLIT_API_KEY` - API key voor Replit backend
- `MCP_TRANSPORT` - `stdio` (lokaal) of `sse` (online)
- `PORT` - Poort voor SSE server (default: 3000)

## Deployment

Deze server is deployment-ready voor Glama.ai via Docker.