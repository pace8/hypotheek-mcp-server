#!/usr/bin/env node
import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import express from "express";

// Je Replit API URLs en API Key
const REPLIT_API_URL_BEREKENEN = "https://digital-mortgage-calculator.replit.app/berekenen/maximaal";
const REPLIT_API_URL_RENTES = "https://digital-mortgage-calculator.replit.app/rentes";
const API_KEY = process.env.REPLIT_API_KEY;

if (!API_KEY) {
  console.error("FOUT: REPLIT_API_KEY environment variabele is niet ingesteld!");
  process.exit(1);
};

const server = new Server(
  {
    name: "hypotheek-berekening-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Lijst met beschikbare tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "bereken_hypotheek",
        description: "Berekent de maximale hypotheek en maandlasten op basis van inkomen, bestaande lening en nieuwe leningparameters. Geeft terug: maximale hypotheek, bruto maandlasten, overwaarde, en energielabel informatie. BELANGRIJK: Vraag de gebruiker om zijn/haar leeftijd (of leeftijden bij partner) - reken dit om naar een geboortedatum waarbij de persoon morgen jarig zou zijn. Voor bestaande lening: dit is alleen voor doorstromers (mensen met een huidige koopwoning en hypotheek). Voor starters is dit niet nodig. Voor nieuwe lening: alleen invullen als de gebruiker specifieke wensen noemt (bijv. andere looptijd of rente). Standaardwaarden worden anders gebruikt.",
        inputSchema: {
          type: "object",
          properties: {
            aanvragers: {
              type: "object",
              description: "Gegevens van de aanvrager(s). Vraag altijd naar inkomen en leeftijd. Bij 'heeft_partner: true' ook naar inkomen en leeftijd van partner vragen.",
              properties: {
                inkomen_aanvrager: {
                  type: "number",
                  description: "Jaarinkomen van de hoofdaanvrager in euro's",
                },
                heeft_partner: {
                  type: "boolean",
                  description: "Heeft de aanvrager een partner? Als true, vraag dan ook naar inkomen_partner en geboortedatum_partner.",
                },
                inkomen_partner: {
                  type: "number",
                  description: "OPTIONEEL - Jaarinkomen van de partner in euro's. Alleen vereist indien heeft_partner: true",
                },
                geboortedatum_aanvrager: {
                  type: "string",
                  description: "Geboortedatum aanvrager in formaat YYYY-MM-DD. TIP: Vraag de gebruiker naar zijn/haar leeftijd en reken dit om naar een geboortedatum waarbij de persoon morgen jarig wordt. Bijvoorbeeld: leeftijd 20 → morgen 21, dus gebruik vandaag als geboortedatum (24 oktober 2005).",
                },
                geboortedatum_partner: {
                  type: "string",
                  description: "OPTIONEEL - Geboortedatum partner in formaat YYYY-MM-DD. Alleen vereist indien heeft_partner: true. TIP: Vraag naar leeftijd en reken om zoals bij hoofdaanvrager.",
                },
                verplichtingen_pm: {
                  type: "number",
                  description: "Maandelijkse verplichtingen in euro's (bijv. andere leningen, alimentatie). Als niets wordt genoemd, gebruik 0.",
                },
              },
              required: [
                "inkomen_aanvrager",
                "heeft_partner",
                "geboortedatum_aanvrager",
                "verplichtingen_pm",
              ],
            },
            bestaande_lening: {
              type: "object",
              description: "OPTIONEEL - Alleen voor doorstromers (mensen met een huidige koopwoning en hypotheek). Voor starters (eerste woning) dit object NIET meesturen. Er zijn twee invulmogelijkheden: 1) SIMPEL: Vraag naar totale schuld, gemiddelde rente, en resterende looptijd. Gebruik dan 1 leningdeel met rvp_months: 10 en loan_type: 'annuiteit'. 2) GEDETAILLEERD: Als gebruiker alle details van verschillende leningdelen deelt, voer deze allemaal in voor een nauwkeurigere berekening.",
              properties: {
                waarde_huidige_woning: {
                  type: "number",
                  description: "Huidige waarde van de woning in euro's",
                },
                existing_loan_parts: {
                  type: "array",
                  description: "Bestaande leningdelen. Voor simpele berekening: 1 leningdeel met totale schuld, gemiddelde rente, resterende looptijd, rvp_months: 10, loan_type: 'annuiteit'. Voor gedetailleerde berekening: alle leningdelen apart invoeren.",
                  items: {
                    type: "object",
                    properties: {
                      principal: {
                        type: "number",
                        description: "Hoofdsom van het leningdeel (restschuld in euro's)",
                      },
                      contract_rate: {
                        type: "number",
                        description: "Contractrente als decimaal (bijv. 0.02 voor 2%, 0.041 voor 4.1%)",
                      },
                      term_months: {
                        type: "number",
                        description: "Resterende looptijd in maanden",
                      },
                      rvp_months: {
                        type: "number",
                        description: "Resterende rentevaste periode in maanden. Bij simpele berekening: gebruik 10 maanden.",
                      },
                      loan_type: {
                        type: "string",
                        description: "Type lening: 'annuiteit' (vaste maandlast), 'lineair' (aflopende maandlast), of 'aflossingsvrij' (alleen rente). Bij simpele berekening: gebruik 'annuiteit'.",
                        enum: ["annuiteit", "lineair", "aflossingsvrij"],
                      },
                    },
                    required: ["principal", "contract_rate", "term_months", "rvp_months", "loan_type"],
                  },
                },
              },
              required: ["waarde_huidige_woning", "existing_loan_parts"],
            },
            nieuwe_lening: {
              type: "object",
              description: "OPTIONEEL - Parameters voor de nieuwe lening. Alleen invullen als de gebruiker specifieke vragen stelt over looptijd, rente, energielabel, NHG, LTV of leningtype. Als de gebruiker hier niets over zegt, dan dit object NIET meesturen - de API gebruikt dan standaardwaarden. Je kunt ook maar een deel van de velden invullen (bijv. alleen rente), de rest wordt dan standaard ingevuld.",
              properties: {
                looptijd_jaren: {
                  type: "number",
                  description: "OPTIONEEL - Looptijd van de nieuwe lening in jaren (bijv. 30). Alleen invullen als gebruiker hierover vraagt.",
                },
                rentevast_periode_jaren: {
                  type: "number",
                  description: "OPTIONEEL - Rentevaste periode in jaren (bijv. 10, 15, 20). Alleen invullen als gebruiker hierover vraagt.",
                },
                rente: {
                  type: "number",
                  description: "OPTIONEEL - Rentepercentage als getal (bijv. 4.1 voor 4.1%, 3.5 voor 3.5%). Alleen invullen als gebruiker een specifieke rente noemt.",
                },
                energielabel: {
                  type: ["string", "null"],
                  description: "OPTIONEEL - Energielabel van de nieuwe woning (A, B, C, D, E, F, of G), of null als onbekend. Alleen invullen als gebruiker dit noemt.",
                },
                nhg: {
                  type: "boolean",
                  description: "OPTIONEEL - Nationale Hypotheek Garantie van toepassing? Alleen invullen als gebruiker hierover vraagt.",
                },
                ltv: {
                  type: "string",
                  description: "OPTIONEEL - Loan-to-Value percentage (bijv. '100%', '90%', '80%'). Alleen invullen als gebruiker hierover vraagt.",
                },
                loan_type: {
                  type: "string",
                  description: "OPTIONEEL - Type nieuwe lening: 'annuiteit' (vaste maandlast, meest gebruikt), 'lineair' (aflopende maandlast), of 'aflossingsvrij' (alleen rente betalen). Alleen invullen als gebruiker hier specifiek naar vraagt.",
                  enum: ["annuiteit", "lineair", "aflossingsvrij"],
                },
              },
            },
          },
          required: ["aanvragers"],
        },
      },
      {
        name: "haal_actuele_rentes_op",
        description: "Haalt de meest actuele top 5 laagste hypotheekrentes op. Geeft een overzicht van de beste beschikbare rentes op de markt. De rentes zijn onderverdeeld in categorieën: NHG en non-NHG, de verschillende Loan-to-Value (LTV) klasses, nieuwbouw of bestaande bouw en per hypotheeksoort (annuïteit, lineair of aflossingsvrij).",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
    ],
  };
});

// Tool execution handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "bereken_hypotheek") {
    try {
      const response = await fetch(REPLIT_API_URL_BEREKENEN, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request.params.arguments),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error bij het berekenen van hypotheek: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  if (request.params.name === "haal_actuele_rentes_op") {
    try {
      const response = await fetch(REPLIT_API_URL_RENTES, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${API_KEY}`,
        },
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(data, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `Error bij het ophalen van actuele rentes: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  throw new Error(`Onbekende tool: ${request.params.name}`);
});

// Start de server
async function main() {
  const transportMode = process.env.MCP_TRANSPORT || "stdio";
  
  if (transportMode === "sse") {
    // SSE transport voor online streaming (Glama.ai)
    const app = express();
    const PORT = process.env.PORT || 3000;

    app.get("/health", (req, res) => {
      res.json({ status: "ok" });
    });

    app.get("/sse", async (req, res) => {
      console.error("SSE connection established");
      const transport = new SSEServerTransport("/message", res);
      await server.connect(transport);
    });

    app.post("/message", async (req, res) => {
      // Handle incoming messages
      res.sendStatus(200);
    });

    app.listen(PORT, () => {
      console.error(`Hypotheek MCP Server draait op poort ${PORT} (SSE mode)!`);
    });
  } else {
    // Stdio transport voor lokaal gebruik
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Hypotheek MCP Server draait (stdio mode)!");
  }
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});