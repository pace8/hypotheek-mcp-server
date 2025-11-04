#!/usr/bin/env node
import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
// ============================================================================
// FASE 1: Nieuwe imports voor type safety, validatie, logging en config
// ============================================================================
import { createLogger } from './utils/logger.js';
import { getConfig } from './config/index.js';
import { 
  validateBaseArguments, 
  validateDoorstromerArguments,
  validateLeningdeel,
  validateBestaandeHypotheek
} from './validation/schemas.js';
import { ValidationError, normalizeEnergielabel, APIError, ErrorCode } from './types/index.js';
import { getApiClient } from './api/client.js';
import { enforceRateLimit } from './middleware/rate-limiter.js';
import { 
  normalizeDoorstromerArgs,
  normalizeOpzetDoorstromerArgs,
} from './adapters/field-normalizer.js';
import { recordToolCall, recordValidationError } from './metrics/exporter.js';
import { listResources, readResource } from './resources/index.js';
import { getPrompt, listPrompts } from './prompts/index.js';


// ============================================================================
// FASE 1: Config laden (vervangt hardcoded URLs en API key check)
// ============================================================================
const config = getConfig(); // Dit gooit automatisch error als REPLIT_API_KEY ontbreekt

// API URLs uit config
const REPLIT_API_URL_BEREKENEN = config.replitApiUrlBerekenen;
const REPLIT_API_URL_OPZET = config.replitApiUrlOpzet;
const REPLIT_API_URL_RENTES = config.replitApiUrlRentes;
const API_KEY = config.replitApiKey;

// Oude check niet meer nodig - getConfig() doet dit al


// Type definitions voor de arguments
interface BaseArguments {
  session_id?: string; // OPTIONEEL - Sessie ID van de gebruiker uit n8n chat trigger: "When chat message received"
  inkomen_aanvrager: number;
  geboortedatum_aanvrager: string;
  heeft_partner: boolean;
  inkomen_partner?: number;
  geboortedatum_partner?: string;
  verplichtingen_pm?: number;
}

interface Leningdeel {
  huidige_schuld: number;
  huidige_rente: number;
  resterende_looptijd_in_maanden: number;
  rentevasteperiode_maanden: number;
  hypotheekvorm: string;
}

interface BestaandeHypotheek {
  leningdelen: Leningdeel[];
}

interface DoorstromerArguments extends BaseArguments {
  waarde_huidige_woning: number;
  bestaande_hypotheek: BestaandeHypotheek;
}

interface NieuweHypotheek {
  looptijd_maanden?: number;
  rentevaste_periode_maanden?: number;
  rente?: number;
  hypotheekvorm?: string;
  energielabel?: string;
  nhg?: boolean;
  ltv?: number;
}

interface UitgebreidArguments extends BaseArguments {
  is_doorstromer?: boolean;
  waarde_huidige_woning?: number;
  bestaande_hypotheek?: BestaandeHypotheek;
  nieuwe_hypotheek?: NieuweHypotheek;
}

// Type definitions voor opzet hypotheek
interface OpzetBaseArguments {
  session_id?: string; // OPTIONEEL - Sessie ID van de gebruiker uit n8n chat trigger: "When chat message received"
  inkomen_aanvrager: number;
  geboortedatum_aanvrager: string;
  heeft_partner: boolean;
  inkomen_partner?: number;
  geboortedatum_partner?: string;
  verplichtingen_pm?: number;
  eigen_vermogen?: number;
}

interface NieuweWoning {
  waarde_woning: number;
  bedrag_verbouwen?: number;
  bedrag_verduurzamen?: number;
  kosten_percentage?: number;
  energielabel?: string;
}

interface OpzetStarterArguments extends OpzetBaseArguments {
  nieuwe_woning: NieuweWoning;
}

interface OpzetDoorstromerArguments extends OpzetBaseArguments {
  nieuwe_woning: NieuweWoning;
  waarde_huidige_woning: number;
  bestaande_hypotheek: BestaandeHypotheek;
}

interface Renteklasse {
  naam: string;
  lowerbound_ltv_pct: number;
  higherbound_ltv_pct: number;
  nhg: boolean;
  rente_jaarlijks_pct: number;
}

interface OpzetNieuweLening {
  looptijd_jaren?: number;
  rentevast_periode_jaren?: number;
  nhg?: boolean;
  renteklassen?: Renteklasse[];
}

interface OpzetUitgebreidArguments extends OpzetBaseArguments {
  nieuwe_woning: NieuweWoning;
  is_doorstromer?: boolean;
  waarde_huidige_woning?: number;
  bestaande_hypotheek?: BestaandeHypotheek;
  nieuwe_lening?: OpzetNieuweLening;
}

const OPZET_GUIDE_URI = 'hypotheek://v4/guide/opzet-intake';

const baseIntakeProperties = {
  inkomen_aanvrager: {
    type: "number",
    description: "Bruto jaarinkomen hoofdaanvrager in euro's.",
  },
  geboortedatum_aanvrager: {
    type: "string",
    description: "Geboortedatum hoofdaanvrager (YYYY-MM-DD).",
  },
  heeft_partner: {
    type: "boolean",
    description: "Geeft aan of een partner mee leent.",
  },
  inkomen_partner: {
    type: "number",
    description: "Optioneel partnerinkomen in euro's.",
  },
  geboortedatum_partner: {
    type: "string",
    description: "Optionele geboortedatum partner (YYYY-MM-DD).",
  },
  verplichtingen_pm: {
    type: "number",
    description: "Optionele maandelijkse verplichtingen in euro's.",
    default: 0,
  },
};

const baseIntakeRequired = ["inkomen_aanvrager", "geboortedatum_aanvrager", "heeft_partner"];

const nieuweWoningSchema = {
  type: "object",
  description: `Kerngegevens nieuwe woning (detailuitleg: ${OPZET_GUIDE_URI}).`,
  properties: {
    waarde_woning: {
      type: "number",
      description: "Koopsom nieuwe woning in euro's.",
    },
    bedrag_verbouwen: {
      type: "number",
      description: "Optionele verbouwingskosten in euro's.",
      default: 0,
    },
    bedrag_verduurzamen: {
      type: "number",
      description: "Optionele verduurzamingskosten in euro's.",
      default: 0,
    },
    kosten_percentage: {
      type: "number",
      description: "Optioneel kostenpercentage koper als decimaal.",
      default: 0.05,
    },
    energielabel: {
      type: "string",
      description: "Optioneel energielabel van de woning.",
      enum: ["A++++ (met garantie)", "A++++", "A+++", "A++", "A+", "A", "B", "C", "D", "E", "F", "G"],
    },
  },
  required: ["waarde_woning"],
};

const bestaandeHypotheekSchema = {
  type: "object",
  description: `Bestaande leningdelen voor doorstromer (detailuitleg: ${OPZET_GUIDE_URI}).`,
  properties: {
    leningdelen: {
      type: "array",
      description: "Minimaal één leningdeel met restschuld en rente.",
      items: {
        type: "object",
        properties: {
          huidige_schuld: {
            type: "number",
            description: "Restschuld in euro's.",
          },
          huidige_rente: {
            type: "number",
            description: "Rente als decimaal (bijv. 0.028).",
          },
          resterende_looptijd_in_maanden: {
            type: "number",
            description: "Resterende looptijd in maanden.",
          },
          rentevasteperiode_maanden: {
            type: "number",
            description: "Resterende rentevaste periode in maanden.",
          },
          hypotheekvorm: {
            type: "string",
            description: "Hypotheekvorm van het leningdeel.",
            enum: ["annuiteit", "lineair", "aflossingsvrij"],
          },
        },
        required: ["huidige_schuld", "huidige_rente", "resterende_looptijd_in_maanden", "rentevasteperiode_maanden", "hypotheekvorm"],
      },
    },
  },
  required: ["leningdelen"],
};

const server = new Server(
  {
    name: "hypotheek-berekening-server",
    version: config.serverVersion,
  },
  {
    capabilities: {
      tools: {},
      resources: {},
      prompts: {},
    },
  }
);

// Helper functie om energielabel te normaliseren
// ============================================================================
// FASE 1: normalizeEnergielabel is nu geïmporteerd uit types/index.ts
// Oude functie hieronder is niet meer nodig, maar we laten hem staan voor backwards compat
// ============================================================================
// (verwijderd in Fase 1)

// Lijst met beschikbare tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      // Tool 1: Starters - Simpele berekening
      {
        name: "bereken_hypotheek_starter",
        description: "Berekent de maximale hypotheek voor starters. Output: maximaal leenbedrag, maandlast en NHG-vergelijking.",
        inputSchema: {
          type: "object",
          description: `Gebruik basisintakevelden; zie ${OPZET_GUIDE_URI} voor detaildefinities.`,
          properties: {
            ...baseIntakeProperties,
            session_id: {
              type: "string",
              description: "Optioneel sessie-ID vanuit n8n (voor logging).",
            },
          },
          required: baseIntakeRequired,
        },
      },
      
      // Tool 2: Doorstromers - Met bestaande hypotheek
      {
        name: "bereken_hypotheek_doorstromer",
        description: "Berekent de maximale hypotheek voor doorstromers. Output: nieuw leenbedrag, maandlast en overwaarde-indicatie.",
        inputSchema: {
          type: "object",
          description: `Gebruik basisintakevelden plus huidige woninginformatie; zie ${OPZET_GUIDE_URI} voor detaildefinities.`,
          properties: {
            ...baseIntakeProperties,
            waarde_huidige_woning: {
              type: "number",
              description: "Huidige marktwaarde van de bestaande woning.",
            },
            bestaande_hypotheek: {
              ...bestaandeHypotheekSchema,
            },
            session_id: {
              type: "string",
              description: "Optioneel sessie-ID vanuit n8n (voor logging).",
            },
          },
          required: [
            ...baseIntakeRequired,
            "waarde_huidige_woning",
            "bestaande_hypotheek",
          ],
        },
      },
      
      // Tool 3: Uitgebreid - Alle parameters configureerbaar
      {
        name: "bereken_hypotheek_uitgebreid",
        description: "Gebruik dit voor maatwerk (rente, looptijd, energielabel). Output: maatwerk leenbedrag met maandlast en NHG-inschatting.",
        inputSchema: {
          type: "object",
          description: `Alle velden zijn optioneel bovenop de basisintake; zie ${OPZET_GUIDE_URI} voor velduitleg en defaults.`,
          properties: {
            ...baseIntakeProperties,
            eigen_vermogen: {
              type: "number",
              description: "Optioneel beschikbaar eigen geld in euro's.",
              default: 0,
            },
            is_doorstromer: {
              type: "boolean",
              description: "Geeft aan of de aanvrager een doorstromer is.",
            },
            waarde_huidige_woning: {
              type: "number",
              description: "Optionele huidige woningwaarde in euro's.",
            },
            bestaande_hypotheek: {
              ...bestaandeHypotheekSchema,
            },
            nieuwe_woning: {
              ...nieuweWoningSchema,
            },
            nieuwe_hypotheek: {
              type: "object",
              description: `Optionele maatwerk leningparameters (looptijd, rentevast, rente). Detailuitleg: ${OPZET_GUIDE_URI}.`,
            },
            nieuwe_lening: {
              type: "object",
              description: `Optionele structuur voor looptijd/rentevast/NHG en renteklassen (detailuitleg: ${OPZET_GUIDE_URI}).`,
            },
            session_id: {
              type: "string",
              description: "Optioneel sessie-ID vanuit n8n (voor logging).",
            },
          },
          required: baseIntakeRequired,
        },
      },
      // Tool 4: Actuele rentes ophalen
      {
        name: "haal_actuele_rentes_op",
        description: "Haalt actuele hypotheekrentes op per rentevaste periode. Output: overzicht met NHG- en niet-NHG-tarieven.",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      
      // Tool 5: Opzet hypotheek - Starters
      {
        name: "opzet_hypotheek_starter",
        description: "Berekent de hypotheekopzet voor starters. Output: totaal benodigd bedrag, financieringsoverzicht en maandlast.",
        inputSchema: {
          type: "object",
          description: `Gebruik basisintake plus woninginfo; zie ${OPZET_GUIDE_URI} voor detailvelden en defaults.`,
          properties: {
            ...baseIntakeProperties,
            eigen_vermogen: {
              type: "number",
              description: "Optioneel beschikbaar eigen geld in euro's.",
              default: 0,
            },
            nieuwe_woning: {
              ...nieuweWoningSchema,
            },
            session_id: {
              type: "string",
              description: "Optioneel sessie-ID vanuit n8n (voor logging).",
            },
          },
          required: [
            ...baseIntakeRequired,
            "nieuwe_woning",
          ],
        },
      },
      // Tool 6: Opzet hypotheek - Doorstromers
      {
        name: "opzet_hypotheek_doorstromer",
        description: "Berekent de hypotheekopzet voor doorstromers met bestaande woning. Output: benodigd bedrag, financiering per component en maandlasten (bestaand versus nieuw).",
        inputSchema: {
          type: "object",
          description: `Gebruik basisintake, huidige woning en bestaande leningdelen; zie ${OPZET_GUIDE_URI} voor detailvelden en defaults.`,
          properties: {
            ...baseIntakeProperties,
            eigen_vermogen: {
              type: "number",
              description: "Optioneel beschikbaar eigen geld in euro's.",
              default: 0,
            },
            waarde_huidige_woning: {
              type: "number",
              description: "Marktwaarde van de huidige woning.",
            },
            bestaande_hypotheek: {
              ...bestaandeHypotheekSchema,
            },
            nieuwe_woning: {
              ...nieuweWoningSchema,
            },
            session_id: {
              type: "string",
              description: "Optioneel sessie-ID vanuit n8n (voor logging).",
            },
          },
          required: [
            ...baseIntakeRequired,
            "waarde_huidige_woning",
            "bestaande_hypotheek",
            "nieuwe_woning",
          ],
        },
      },
      // Tool 7: Opzet hypotheek - Uitgebreid
      {
        name: "opzet_hypotheek_uitgebreid",
        description: `GEAVANCEERDE opzet hypotheek berekening met VOLLEDIGE controle over alle parameters. Geschikt voor zowel starters als doorstromers.
  
  **Output bevat alles van de starter/doorstromer tools, plus:**
  - Mogelijkheid om elk leningdeel handmatig te definiëren
  - Custom rentepercentages, looptijden en rentevast periodes
  - NHG, energielabel en verbouwing/duurzaamheidsbudget in één scenario
  - Volledige balans check en praktische toelichtingen
  
  Gebruik deze tool alleen wanneer afwijkende parameters nodig zijn; anders de specifieke starter/doorstromer varianten gebruiken.`,
        inputSchema: {
          type: "object",
          properties: {
            inkomen_aanvrager: {
              type: "number",
              description: "Bruto jaarinkomen van de hoofdaanvrager in euro's",
            },
            geboortedatum_aanvrager: {
              type: "string",
              description: "Geboortedatum aanvrager in formaat YYYY-MM-DD",
            },
            heeft_partner: {
              type: "boolean",
              description: "Heeft de aanvrager een partner die mee aanvraagt?",
            },
            inkomen_partner: {
              type: "number",
              description: "OPTIONEEL - Bruto jaarinkomen van de partner in euro's.",
            },
            geboortedatum_partner: {
              type: "string",
              description: "OPTIONEEL - Geboortedatum partner in formaat YYYY-MM-DD.",
            },
            verplichtingen_pm: {
              type: "number",
              description: "Maandelijkse verplichtingen in euro's.",
              default: 0,
            },
            eigen_vermogen: {
              type: "number",
              description: "Eigen geld beschikbaar in euro's.",
              default: 0,
            },
            is_doorstromer: {
              type: "boolean",
              description: "Is dit een doorstromer met bestaande woning en hypotheek?",
            },
            waarde_huidige_woning: {
              type: "number",
              description: "OPTIONEEL - Alleen voor doorstromers: huidige woningwaarde in euro's",
            },
            bestaande_hypotheek: {
              type: "object",
              description: "OPTIONEEL - Alleen voor doorstromers: gegevens van de bestaande hypotheek.",
              properties: {
                leningdelen: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      huidige_schuld: {
                        type: "number",
                        description: "Restschuld in euro's",
                      },
                      huidige_rente: {
                        type: "number",
                        description: "Rente als decimaal (bijv. 0.041 voor 4.1%)",
                      },
                      resterende_looptijd_in_maanden: {
                        type: "number",
                        description: "Resterende looptijd in MAANDEN",
                      },
                      rentevasteperiode_maanden: {
                        type: "number",
                        description: "Resterende rentevaste periode in MAANDEN",
                      },
                      hypotheekvorm: {
                        type: "string",
                        description: "Type hypotheek",
                        enum: ["annuiteit", "lineair", "aflossingsvrij"],
                      },
                    },
                    required: ["huidige_schuld", "huidige_rente", "resterende_looptijd_in_maanden", "rentevasteperiode_maanden", "hypotheekvorm"],
                  },
                },
              },
              required: ["leningdelen"],
            },
            nieuwe_woning: {
              type: "object",
              description: "Gegevens van de nieuwe woning die gekocht wordt",
              properties: {
                waarde_woning: {
                  type: "number",
                  description: "Koopsom van de nieuwe woning in euro's",
                },
                bedrag_verbouwen: {
                  type: "number",
                  description: "OPTIONEEL - Geschatte kosten voor verbouwing/meerwerk in euro's.",
                  default: 0,
                },
                bedrag_verduurzamen: {
                  type: "number",
                  description: "OPTIONEEL - Geschatte kosten voor verduurzaming in euro's.",
                  default: 0,
                },
                kosten_percentage: {
                  type: "number",
                  description: "OPTIONEEL - Koperkosten als decimaal (bijv. 0.05 voor 5%). Standaard: 0.05",
                  default: 0.05,
                },
                energielabel: {
                  type: "string",
                  description: "OPTIONEEL - Energielabel van de nieuwe woning.",
                  enum: ["A++++ (met garantie)", "A++++", "A+++", "A++", "A+", "A", "B", "C", "D", "E", "F", "G"],
                },
              },
              required: ["waarde_woning"],
            },
            nieuwe_lening: {
              type: "object",
              description: "OPTIONEEL - Specifieke parameters voor de nieuwe lening. Gebruik deze sectie om looptijd, rentevast periode, NHG of renteklassen aan te passen.",
              properties: {
                looptijd_jaren: {
                  type: "number",
                  description: "Looptijd van de hypotheek in JAREN. Standaard: 30 jaar. Voorbeelden: 20, 25, 30",
                  default: 30,
                },
                rentevast_periode_jaren: {
                  type: "number",
                  description: "Rentevaste periode in JAREN. Standaard: 10 jaar. Voorbeelden: 5, 10, 15, 20",
                  default: 10,
                },
                nhg: {
                  type: "boolean",
                  description: "Nationale Hypotheek Garantie aanvragen? Standaard: false",
                  default: false,
                },
                renteklassen: {
                  type: "array",
                  description: "OPTIONEEL - Custom renteklassen met specifieke LTV-grenzen en rentepercentages. Alleen invullen als je specifieke renteklassen wilt definiëren.",
                  items: {
                    type: "object",
                    properties: {
                      naam: {
                        type: "string",
                        description: "Naam van de renteklasse (bijv. 'NHG 0-200', 'Niet-NHG 75-90')",
                      },
                      lowerbound_ltv_pct: {
                        type: "number",
                        description: "Ondergrens LTV in procenten (bijv. 0.0, 75.0)",
                      },
                      higherbound_ltv_pct: {
                        type: "number",
                        description: "Bovengrens LTV in procenten (bijv. 75.0, 200.0)",
                      },
                      nhg: {
                        type: "boolean",
                        description: "Is dit een NHG renteklasse?",
                      },
                      rente_jaarlijks_pct: {
                        type: "number",
                        description: "Rentepercentage als getal (bijv. 3.2 voor 3.2%, 4.0 voor 4.0%)",
                      },
                    },
                    required: ["naam", "lowerbound_ltv_pct", "higherbound_ltv_pct", "nhg", "rente_jaarlijks_pct"],
                  },
                },
              },
            },
            session_id: {
              type: "string",
              description: "OPTIONEEL - Sessie ID voor het traceren van de conversatie. Haal deze waarde uit de n8n chat trigger: 'When chat message received' -> sessionId variabele.",
            },
          },
          required: [
            "inkomen_aanvrager",
            "geboortedatum_aanvrager",
            "heeft_partner",
            "nieuwe_woning",
          ],
        },
      },
    ],
  };
});

server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: listResources(),
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => ({
  contents: [readResource(request.params.uri)],
}));

server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: listPrompts(),
}));

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const args = request.params.arguments ? { ...request.params.arguments } : undefined;
  const prompt = getPrompt(request.params.name, args as Record<string, unknown> | undefined);
  return {
    description: prompt.description,
    messages: prompt.messages,
  };
});

// Functie om response mooi te formatteren
function formatResponse(data: any, toolName: string): string {
  let output = "";

  if (toolName === "bereken_hypotheek_starter") {
    output += "🏠 **HYPOTHEEKBEREKENING VOOR STARTER**\n\n";
    
    if (data.resultaat && Array.isArray(data.resultaat)) {
      data.resultaat.forEach((resultaat: any, index: number) => {
        const scenario = resultaat.resultaat_omschrijving || `Scenario ${index + 1}`;
        const hypotheekData = resultaat.gebruikte_hypotheekgegevens?.opzet_nieuwe_hypotheek?.[0];
        
        output += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        output += `📊 **${scenario}**\n`;
        output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        
        output += `💰 **Maximale hypotheek:** €${resultaat.maximaal_bedrag?.toLocaleString('nl-NL') || 'N/A'}\n`;
        output += `📈 **Maandlast:** €${resultaat.bruto_maandlasten_nieuwe_lening?.toLocaleString('nl-NL', {minimumFractionDigits: 2, maximumFractionDigits: 2}) || 'N/A'}\n`;
        
        if (hypotheekData) {
          output += `🏦 **Hypotheekvorm:** ${hypotheekData.hypotheekvorm || 'N/A'}\n`;
          output += `⏱️ **Looptijd:** ${hypotheekData.looptijd_maanden ? (hypotheekData.looptijd_maanden / 12).toFixed(0) + ' jaar' : 'N/A'}\n`;
          output += `🔒 **Rentevaste periode:** ${hypotheekData.rentevastperiode_maanden ? (hypotheekData.rentevastperiode_maanden / 12).toFixed(0) + ' jaar' : 'N/A'}\n`;
          output += `📊 **Rentepercentage:** ${hypotheekData.rente ? (hypotheekData.rente * 100).toFixed(2) + '%' : 'N/A'}\n`;
        }
        
        output += `⚡ **Energielabel:** ${resultaat.gebruikte_hypotheekgegevens?.energielabel || 'N/A'}\n`;
        output += `🛡️ **NHG:** ${resultaat.gebruikte_hypotheekgegevens?.nhg_toegepast ? 'Ja' : 'Nee'}\n\n`;
      });
    }
    
    // Voeg energielabel info toe als beschikbaar
    if (data.energielabel_verschil) {
      output += `\n💡 **Energielabel impact:**\n`;
      output += `${data.energielabel_verschil.opmerking}\n\n`;
      if (data.energielabel_verschil.verschil_per_label) {
        output += `Verschil per energielabel:\n`;
        Object.entries(data.energielabel_verschil.verschil_per_label).forEach(([label, bedrag]: [string, any]) => {
          output += `• ${label}: €${bedrag?.toLocaleString('nl-NL') || '0'} ${bedrag > 0 ? 'extra' : ''}\n`;
        });
      }
    }
  } else if (toolName === "bereken_hypotheek_doorstromer") {
    output += "🏠 **HYPOTHEEKBEREKENING VOOR DOORSTROMER**\n\n";
    
    if (data.resultaat && Array.isArray(data.resultaat)) {
      data.resultaat.forEach((resultaat: any, index: number) => {
        const scenario = resultaat.resultaat_omschrijving || `Scenario ${index + 1}`;
        const hypotheekData = resultaat.gebruikte_hypotheekgegevens?.opzet_nieuwe_hypotheek?.[0];
        
        output += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        output += `📊 **${scenario}**\n`;
        output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        
        output += `💰 **Maximale nieuwe hypotheek:** €${resultaat.maximaal_bedrag?.toLocaleString('nl-NL') || 'N/A'}\n`;
        output += `📈 **Nieuwe maandlast:** €${resultaat.bruto_maandlasten_nieuwe_lening?.toLocaleString('nl-NL', {minimumFractionDigits: 2, maximumFractionDigits: 2}) || 'N/A'}\n`;
        output += `💵 **Overwaarde:** €${resultaat.overwaarde?.toLocaleString('nl-NL') || 'N/A'}\n`;
        
        if (hypotheekData) {
          output += `🏦 **Hypotheekvorm:** ${hypotheekData.hypotheekvorm || 'N/A'}\n`;
          output += `⏱️ **Looptijd:** ${hypotheekData.looptijd_maanden ? (hypotheekData.looptijd_maanden / 12).toFixed(0) + ' jaar' : 'N/A'}\n`;
          output += `🔒 **Rentevaste periode:** ${hypotheekData.rentevastperiode_maanden ? (hypotheekData.rentevastperiode_maanden / 12).toFixed(0) + ' jaar' : 'N/A'}\n`;
          output += `📊 **Rentepercentage:** ${hypotheekData.rente ? (hypotheekData.rente * 100).toFixed(2) + '%' : 'N/A'}\n`;
        }
        
        output += `⚡ **Energielabel:** ${resultaat.gebruikte_hypotheekgegevens?.energielabel || 'N/A'}\n`;
        output += `🛡️ **NHG:** ${resultaat.gebruikte_hypotheekgegevens?.nhg_toegepast ? 'Ja' : 'Nee'}\n\n`;
        
        if (resultaat.bestaande_situatie) {
          output += `\n**🏠 Huidige situatie:**\n`;
          output += `• Woningwaarde: €${resultaat.bestaande_situatie.woningwaarde?.toLocaleString('nl-NL') || 'N/A'}\n`;
          output += `• Totale restschuld: €${resultaat.bestaande_situatie.totale_restschuld?.toLocaleString('nl-NL') || 'N/A'}\n`;
          output += `• Huidige maandlast: €${resultaat.bestaande_situatie.huidige_maandlast?.toLocaleString('nl-NL', {minimumFractionDigits: 2, maximumFractionDigits: 2}) || 'N/A'}\n\n`;
        }
      });
    }
    
    // Voeg energielabel info toe als beschikbaar
    if (data.energielabel_verschil) {
      output += `\n💡 **Energielabel impact:**\n`;
      output += `${data.energielabel_verschil.opmerking}\n\n`;
      if (data.energielabel_verschil.verschil_per_label) {
        output += `Verschil per energielabel:\n`;
        Object.entries(data.energielabel_verschil.verschil_per_label).forEach(([label, bedrag]: [string, any]) => {
          output += `• ${label}: €${bedrag?.toLocaleString('nl-NL') || '0'} ${bedrag > 0 ? 'extra' : ''}\n`;
        });
      }
    }
  } else if (toolName === "bereken_hypotheek_uitgebreid") {
    output += "🏠 **UITGEBREIDE HYPOTHEEKBEREKENING**\n\n";
    
    if (data.resultaat && Array.isArray(data.resultaat)) {
      data.resultaat.forEach((resultaat: any, index: number) => {
        const scenario = resultaat.resultaat_omschrijving || `Scenario ${index + 1}`;
        const hypotheekData = resultaat.gebruikte_hypotheekgegevens?.opzet_nieuwe_hypotheek?.[0];
        
        output += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        output += `📊 **${scenario}**\n`;
        output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        
        output += `💰 **Maximale hypotheek:** €${resultaat.maximaal_bedrag?.toLocaleString('nl-NL') || 'N/A'}\n`;
        output += `📈 **Maandlast:** €${resultaat.bruto_maandlasten_nieuwe_lening?.toLocaleString('nl-NL', {minimumFractionDigits: 2, maximumFractionDigits: 2}) || 'N/A'}\n`;
        
        if (resultaat.overwaarde !== undefined) {
          output += `💵 **Overwaarde:** €${resultaat.overwaarde?.toLocaleString('nl-NL') || 'N/A'}\n`;
        }
        
        if (hypotheekData) {
          output += `🏦 **Hypotheekvorm:** ${hypotheekData.hypotheekvorm || 'N/A'}\n`;
          output += `⏱️ **Looptijd:** ${hypotheekData.looptijd_maanden ? (hypotheekData.looptijd_maanden / 12).toFixed(0) + ' jaar' : 'N/A'}\n`;
          output += `🔒 **Rentevaste periode:** ${hypotheekData.rentevastperiode_maanden ? (hypotheekData.rentevastperiode_maanden / 12).toFixed(0) + ' jaar' : 'N/A'}\n`;
          output += `📊 **Rentepercentage:** ${hypotheekData.rente ? (hypotheekData.rente * 100).toFixed(2) + '%' : 'N/A'}\n`;
        }
        
        output += `⚡ **Energielabel:** ${resultaat.gebruikte_hypotheekgegevens?.energielabel || 'N/A'}\n`;
        output += `🛡️ **NHG:** ${resultaat.gebruikte_hypotheekgegevens?.nhg_toegepast ? 'Ja' : 'Nee'}\n\n`;
        
        if (resultaat.bestaande_situatie) {
          output += `\n**🏠 Huidige situatie:**\n`;
          output += `• Woningwaarde: €${resultaat.bestaande_situatie.woningwaarde?.toLocaleString('nl-NL') || 'N/A'}\n`;
          output += `• Totale restschuld: €${resultaat.bestaande_situatie.totale_restschuld?.toLocaleString('nl-NL') || 'N/A'}\n`;
          output += `• Huidige maandlast: €${resultaat.bestaande_situatie.huidige_maandlast?.toLocaleString('nl-NL', {minimumFractionDigits: 2, maximumFractionDigits: 2}) || 'N/A'}\n\n`;
        }
      });
    }
    
    // Voeg energielabel info toe als beschikbaar
    if (data.energielabel_verschil) {
      output += `\n💡 **Energielabel impact:**\n`;
      output += `${data.energielabel_verschil.opmerking}\n\n`;
      if (data.energielabel_verschil.verschil_per_label) {
        output += `Verschil per energielabel:\n`;
        Object.entries(data.energielabel_verschil.verschil_per_label).forEach(([label, bedrag]: [string, any]) => {
          output += `• ${label}: €${bedrag?.toLocaleString('nl-NL') || '0'} ${bedrag > 0 ? 'extra' : ''}\n`;
        });
      }
    }
  }

  // Formattering voor opzet hypotheek tools
  if (toolName.startsWith("opzet_hypotheek_")) {
    const toolType = toolName.replace("opzet_hypotheek_", "").toUpperCase();
    const isDoorstromer = toolName.includes("doorstromer");
    
    output += `🏠 **OPZET HYPOTHEEK - ${toolType}**\n\n`;
    
    if (data.resultaat) {
      const resultaat = data.resultaat;
      
      // ========================================================================
      // SECTIE 1: BENODIGD BEDRAG
      // ========================================================================
      output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      output += `📊 **TOTAAL BENODIGD BEDRAG**\n`;
      output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
      
      if (resultaat.Benodigd_bedrag) {
        output += `🏡 Koopsom woning: €${resultaat.Benodigd_bedrag.Woning_koopsom?.toLocaleString('nl-NL') || 'N/A'}\n`;
        
        if (resultaat.Benodigd_bedrag.Verbouwingskosten_meerwerk > 0) {
          output += `🔨 Verbouwing/meerwerk: €${resultaat.Benodigd_bedrag.Verbouwingskosten_meerwerk?.toLocaleString('nl-NL') || 'N/A'}\n`;
        }
        if (resultaat.Benodigd_bedrag.Verduurzamingskosten > 0) {
          output += `♻️ Verduurzaming: €${resultaat.Benodigd_bedrag.Verduurzamingskosten?.toLocaleString('nl-NL') || 'N/A'}\n`;
        }
        output += `💼 Kosten koper: €${resultaat.Benodigd_bedrag.Kosten?.toLocaleString('nl-NL') || 'N/A'}\n`;
        
        // Bereken totaal (fallback als API het niet geeft)
        const totaalBenodigd = resultaat.Benodigd_bedrag.Totaal_benodigd || 
          ((resultaat.Benodigd_bedrag.Woning_koopsom || 0) + 
           (resultaat.Benodigd_bedrag.Verbouwingskosten_meerwerk || 0) +
           (resultaat.Benodigd_bedrag.Verduurzamingskosten || 0) +
           (resultaat.Benodigd_bedrag.Kosten || 0));
        
        output += `${'─'.repeat(45)}\n`;
        output += `💰 **TOTAAL BENODIGD: €${totaalBenodigd.toLocaleString('nl-NL')}**\n\n`;
      }
      
      // ========================================================================
      // SECTIE 2: FINANCIERING (met breakdown voor doorstromers)
      // ========================================================================
      output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      output += `💵 **FINANCIERING**\n`;
      output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
      
      if (resultaat.Financiering) {
        // Voor doorstromers: toon bestaande hypotheek
        if (isDoorstromer && resultaat.Financiering.Bestaande_hypotheek) {
          const bestaand = resultaat.Financiering.Bestaande_hypotheek;
          output += `🔄 Bestaande hypotheek (over te sluiten): €${bestaand.Totaal_schuld?.toLocaleString('nl-NL') || 'N/A'}\n`;
        } else if (isDoorstromer) {
          // Fallback: bereken uit opzet_nieuwe_hypotheek
          let bestaandeSchuld = 0;
          if (resultaat.gebruikte_hypotheekgegevens?.opzet_nieuwe_hypotheek) {
            resultaat.gebruikte_hypotheekgegevens.opzet_nieuwe_hypotheek.forEach((deel: any) => {
              if (deel.type === 'bestaand_leningdeel') {
                bestaandeSchuld += deel.hypotheekbedrag || 0;
              }
            });
          }
          if (bestaandeSchuld > 0) {
            output += `🔄 Bestaande hypotheek (over te sluiten): €${bestaandeSchuld.toLocaleString('nl-NL')}\n`;
          }
        }
        
        // Nieuwe hypotheek
        const nieuweHypotheek = resultaat.Financiering.Nieuwe_hypotheek || resultaat.Financiering.Hypotheek || 0;
        if (isDoorstromer && nieuweHypotheek > 0) {
          output += `🆕 Nieuwe hypotheek (extra): €${nieuweHypotheek.toLocaleString('nl-NL')}\n`;
        } else {
          output += `🏦 Hypotheek: €${nieuweHypotheek.toLocaleString('nl-NL')}\n`;
        }
        
        // Overwaarde
        if (resultaat.Financiering.Overwaarde !== undefined && resultaat.Financiering.Overwaarde > 0) {
          output += `📈 Overwaarde huidige woning: €${resultaat.Financiering.Overwaarde?.toLocaleString('nl-NL')}\n`;
        }
        
        // Eigen geld
        const eigenGeld = resultaat.Financiering.Eigen_geld || 0;
        if (eigenGeld > 0) {
          output += `💎 Eigen geld: €${eigenGeld.toLocaleString('nl-NL')}\n`;
        }
        
        // Bereken totaal financiering (fallback als API het niet geeft)
        let totaalFinanciering = resultaat.Financiering.Totaal_financiering;
        if (!totaalFinanciering) {
          const bestaandBedrag = resultaat.Financiering.Bestaande_hypotheek?.Totaal_schuld || 0;
          totaalFinanciering = bestaandBedrag + nieuweHypotheek + 
            (resultaat.Financiering.Overwaarde || 0) + eigenGeld;
        }
        
        output += `${'─'.repeat(45)}\n`;
        output += `💵 **TOTAAL FINANCIERING: €${totaalFinanciering.toLocaleString('nl-NL')}**\n\n`;
        
        // Balans check
        if (resultaat.Benodigd_bedrag) {
          const totaalBenodigd = resultaat.Benodigd_bedrag.Totaal_benodigd || 
            ((resultaat.Benodigd_bedrag.Woning_koopsom || 0) + 
             (resultaat.Benodigd_bedrag.Verbouwingskosten_meerwerk || 0) +
             (resultaat.Benodigd_bedrag.Verduurzamingskosten || 0) +
             (resultaat.Benodigd_bedrag.Kosten || 0));
          
          const verschil = Math.abs(totaalFinanciering - totaalBenodigd);
          
          if (verschil < 1) {
            output += `✅ **Balans: Financiering dekt benodigd bedrag** ✓\n\n`;
          } else if (totaalFinanciering < totaalBenodigd) {
            output += `⚠️ **Let op: Tekort van €${verschil.toLocaleString('nl-NL')}**\n`;
            output += `   → Meer eigen geld of hogere hypotheek nodig\n\n`;
          } else {
            output += `ℹ️ **Overschot van €${verschil.toLocaleString('nl-NL')}**\n`;
            output += `   → Kan als buffer/reserve dienen\n\n`;
          }
        }
      }
      
      // ========================================================================
      // SECTIE 3: MAANDLASTEN (met breakdown voor doorstromers)
      // ========================================================================
      output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      output += `📊 **MAANDLASTEN**\n`;
      output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
      
      // Check of API nieuwe Maandlasten object heeft
      if (resultaat.Maandlasten) {
        // NIEUW: API geeft breakdown
        if (isDoorstromer) {
          output += `🔄 Bestaande hypotheek: €${Math.round(resultaat.Maandlasten.Bestaande_hypotheek || 0).toLocaleString('nl-NL')}/maand\n`;
          output += `🆕 Nieuwe hypotheek (extra): €${Math.round(resultaat.Maandlasten.Nieuwe_hypotheek || 0).toLocaleString('nl-NL')}/maand\n`;
          output += `${'─'.repeat(45)}\n`;
          output += `💰 **TOTAAL MAANDLAST: €${Math.round(resultaat.Maandlasten.Totaal).toLocaleString('nl-NL')}/maand**\n\n`;
          
          const verschil = resultaat.Maandlasten.Verschil || 0;
          if (verschil > 0) {
            output += `📈 **Stijging maandlast: +€${Math.round(verschil).toLocaleString('nl-NL')}/maand**\n\n`;
          } else if (verschil < 0) {
            output += `📉 **Daling maandlast: -€${Math.round(Math.abs(verschil)).toLocaleString('nl-NL')}/maand**\n\n`;
          } else {
            output += `➡️ **Maandlast blijft gelijk**\n\n`;
          }
        } else {
          // Starter: alleen totaal
          output += `💰 **Bruto maandlast: €${Math.round(resultaat.Maandlasten.Totaal).toLocaleString('nl-NL')}/maand**\n\n`;
        }
      } else {
        // FALLBACK: oude API response zonder breakdown
        if (isDoorstromer && resultaat.gebruikte_hypotheekgegevens?.opzet_nieuwe_hypotheek) {
          // Bereken breakdown handmatig
          let bestaandeMaandlast = 0;
          let nieuweMaandlast = 0;
          
          resultaat.gebruikte_hypotheekgegevens.opzet_nieuwe_hypotheek.forEach((deel: any) => {
            const bedrag = deel.hypotheekbedrag || 0;
            const rente = deel.rente || 0;
            const geschatteMaandlast = (bedrag * rente) / 12;
            
            if (deel.type === 'bestaand_leningdeel') {
              bestaandeMaandlast += geschatteMaandlast;
            } else {
              nieuweMaandlast += geschatteMaandlast;
            }
          });
          
          output += `🔄 Bestaande hypotheek: €${Math.round(bestaandeMaandlast).toLocaleString('nl-NL')}/maand (geschat)\n`;
          output += `🆕 Nieuwe hypotheek (extra): €${Math.round(nieuweMaandlast).toLocaleString('nl-NL')}/maand (geschat)\n`;
          output += `${'─'.repeat(45)}\n`;
          output += `💰 **TOTAAL MAANDLAST: €${(resultaat.bruto_maandlasten_nieuwe_lening || 0).toLocaleString('nl-NL', {minimumFractionDigits: 2})}/maand**\n\n`;
          
          const verschil = (resultaat.bruto_maandlasten_nieuwe_lening || 0) - Math.round(bestaandeMaandlast);
          if (verschil > 50) {
            output += `📈 **Stijging maandlast: +€${Math.round(verschil).toLocaleString('nl-NL')}/maand** (geschat)\n\n`;
          }
        } else {
          // Starter: alleen totaal
          output += `💰 **Bruto maandlast: €${(resultaat.bruto_maandlasten_nieuwe_lening || 0).toLocaleString('nl-NL', {minimumFractionDigits: 2})}/maand**\n\n`;
        }
      }
      
      // ========================================================================
      // SECTIE 4: HYPOTHEEKDETAILS
      // ========================================================================
      if (resultaat.gebruikte_hypotheekgegevens) {
        output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        output += `🔍 **HYPOTHEEKDETAILS**\n`;
        output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        
        output += `⚡ Energielabel: ${resultaat.gebruikte_hypotheekgegevens.energielabel || 'N/A'}`;
        if (resultaat.gebruikte_hypotheekgegevens.energielabel_toeslag > 0) {
          output += ` (+€${resultaat.gebruikte_hypotheekgegevens.energielabel_toeslag?.toLocaleString('nl-NL')} extra leencapaciteit)`;
        }
        output += `\n`;
        output += `🛡️ NHG: ${resultaat.gebruikte_hypotheekgegevens.nhg_toegepast ? 'Ja (lagere rente!)' : 'Nee'}\n\n`;
        
        if (resultaat.gebruikte_hypotheekgegevens.opzet_nieuwe_hypotheek && 
            Array.isArray(resultaat.gebruikte_hypotheekgegevens.opzet_nieuwe_hypotheek)) {
          output += `**📋 Opzet hypotheek:**
`;
          
          resultaat.gebruikte_hypotheekgegevens.opzet_nieuwe_hypotheek.forEach((deel: any, index: number) => {
            const deelType = deel.type === 'bestaand_leningdeel' ? '🔄 Bestaand deel' : '🆕 Nieuw deel';
            output += `
${deelType} ${index + 1}:
`;
            output += `  • Bedrag: €${deel.hypotheekbedrag?.toLocaleString('nl-NL') || 'N/A'}
`;
            output += `  • Rente: ${deel.rente ? (deel.rente * 100).toFixed(2) + '%' : 'N/A'}
`;
            output += `  • Type: ${deel.hypotheekvorm || 'N/A'}
`;
            
            if (deel.type === 'bestaand_leningdeel') {
              output += `  • Resterende looptijd: ${deel.resterende_looptijd_maanden ? (deel.resterende_looptijd_maanden / 12).toFixed(0) + ' jaar' : 'N/A'}
`;
              output += `  • Nog rentevast: ${deel.rentevastperiode_maanden ? (deel.rentevastperiode_maanden / 12).toFixed(0) + ' jaar' : 'Variabel'}
`;
            } else {
              output += `  • Looptijd: ${deel.looptijd_maanden ? (deel.looptijd_maanden / 12).toFixed(0) + ' jaar' : 'N/A'}
`;
              output += `  • Rentevast: ${deel.rentevastperiode_maanden ? (deel.rentevastperiode_maanden / 12).toFixed(0) + ' jaar' : 'Variabel'}
`;
            }
          });
          output += `
`;
        }
      }
      
      // ========================================================================
      // SECTIE 5: PRAKTISCHE TOELICHTING
      // ========================================================================
      output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      output += `💡 **PRAKTISCHE TOELICHTING**\n`;
      output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
      
      // Context-aware feedback
      if (isDoorstromer) {
        if (resultaat.Financiering?.Overwaarde && resultaat.Financiering.Overwaarde > 50000) {
          output += `✓ U heeft een substantiële overwaarde van €${resultaat.Financiering.Overwaarde.toLocaleString('nl-NL')}. Dit geeft u ruimte voor de nieuwe woning of als buffer.\n`;
        }
        
        const totaalMaandlast = resultaat.Maandlasten?.Totaal || resultaat.bruto_maandlasten_nieuwe_lening || 0;
        if (totaalMaandlast > 2000) {
          output += `⚠️ Nieuwe maandlast is substantieel (€${Math.round(totaalMaandlast).toLocaleString('nl-NL')}). Zorg dat dit binnen uw budget past.\n`;
        }
        
        const verschil = resultaat.Maandlasten?.Verschil || 0;
        if (verschil > 500) {
          output += `ℹ️ Maandlast stijgt met €${Math.round(verschil).toLocaleString('nl-NL')}. Check of dit duurzaam is op lange termijn.\n`;
        }
      } else {
        // Starter specifieke tips
        if (resultaat.Financiering?.Nieuwe_hypotheek && resultaat.Benodigd_bedrag?.Woning_koopsom) {
          const hypotheek = resultaat.Financiering.Nieuwe_hypotheek || resultaat.Financiering.Hypotheek;
          const ltv = (hypotheek / resultaat.Benodigd_bedrag.Woning_koopsom) * 100;
          
          if (ltv > 100) {
            output += `⚠️ U financiert ${ltv.toFixed(0)}% (boven de woningwaarde). Dit betekent geen NHG. Overweeg meer eigen geld in te brengen.\n`;
          } else if (ltv > 95) {
            output += `ℹ️ U financiert ${ltv.toFixed(0)}% van de woningwaarde. Hoge financiering betekent vaak hogere rente.\n`;
          } else if (ltv < 90) {
            output += `✓ U financiert ${ltv.toFixed(0)}% - dit is gunstig voor uw rente.\n`;
          }
        }
        
        const eigenGeld = resultaat.Financiering?.Eigen_geld || 0;
        if (eigenGeld < 10000) {
          output += `ℹ️ Met meer eigen geld kunt u vaak een betere rente krijgen. Overweeg eventuele spaargeld of giften.\n`;
        }
      }
      
      // Energielabel tip
      if (resultaat.gebruikte_hypotheekgegevens?.energielabel) {
        const label = resultaat.gebruikte_hypotheekgegevens.energielabel;
        if (label === 'D' || label === 'E' || label === 'F' || label === 'G') {
          output += `💡 Tip: Met verduurzaming naar label A++ of hoger kunt u tot €30.000 extra lenen tegen een lagere rente!\n`;
        } else if (label.startsWith('A')) {
          output += `✓ Uitstekend energielabel! Dit geeft u extra leencapaciteit.\n`;
        }
      }
      
      output += `\n`;
    }
    
    // Disclaimers
    if (data.extra_informatie && data.extra_informatie.disclaimers) {
      output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      output += `⚠️ **DISCLAIMERS**\n`;
      output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
      data.extra_informatie.disclaimers.forEach((disclaimer: string) => {
        output += `• ${disclaimer}\n`;
      });
      output += `\n`;
    }
  }


  return output;
}

// Handler voor tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const startTime = Date.now();
  const toolName = request.params && (request.params.name || 'unknown_tool');
  let success = false;
  try {
    success = true;
  // Tool 1: Starters
  if (request.params.name === "bereken_hypotheek_starter") {
    try {
      // Type guard to check if arguments exists
      if (!request.params.arguments) {
        throw new Error("Arguments are required");
      }

      const args = request.params.arguments as unknown as BaseArguments;

      

// ========================================================================
// FASE 1: Validatie en logging voor bereken_hypotheek_starter
// ========================================================================
const logger = createLogger(args.session_id);
try {
  validateBaseArguments(args);
  logger.info('Validation passed', { 
    tool: 'bereken_hypotheek_starter',
    heeft_partner: args.heeft_partner,
    has_session_id: !!args.session_id
  });
} catch (validationError) {
  if (validationError instanceof ValidationError) {
    logger.validationWarning(
      validationError.message,
      // @ts-ignore
      validationError.field,
      // @ts-ignore
      validationError.value
    );
    // Fase 1: Niet blokkeren, alleen warning
  } else {
    logger.warn('Unexpected validation error', { error: String(validationError) });
  }
}
// ========================================================================
// If validation fails, block execution and return a structured error (Fase 2)

// Transform naar API format
      const apiPayload: any = {
        aanvragers: {
          inkomen_aanvrager: args.inkomen_aanvrager,
          geboortedatum_aanvrager: args.geboortedatum_aanvrager,
          heeft_partner: args.heeft_partner,
          inkomen_partner: args.inkomen_partner,
          geboortedatum_partner: args.geboortedatum_partner,
          verplichtingen_pm: args.verplichtingen_pm || 0,
        },
      };

      // Voeg session_id toe indien aanwezig
      if (args.session_id) {
        apiPayload.session_id = args.session_id;
      }

      // Rate limit enforcement
      enforceRateLimit(args.session_id);

      // Use API client with retry/timeout and correlation id
      const apiClient = getApiClient();
      try {
        const apiResponse = await apiClient.post(REPLIT_API_URL_BEREKENEN, apiPayload, { correlationId: args.session_id });
        const data = apiResponse.data;

        return {
          content: [
            {
              type: "text",
              text: formatResponse(data, "bereken_hypotheek_starter"),
            },
          ],
        };
      } catch (err) {
        throw err;
      }

    } catch (error) {
      const sessionId = request.params.arguments && (request.params.arguments as any).session_id;
      // Structured error responses for ValidationError and APIError
      if (error instanceof ValidationError) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify(error.toStructured(sessionId), null, 2)
          }],
          isError: true,
        };
      }

      if (error instanceof APIError) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify(error.toStructured(sessionId), null, 2)
          }],
          isError: true,
        };
      }

      // Unknown error
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            code: ErrorCode.UNKNOWN_ERROR,
            message: error instanceof Error ? error.message : String(error),
            correlation_id: sessionId
          }, null, 2)
        }],
        isError: true,
      };
    }
  }

  // Tool 2: Doorstromers
  if (request.params.name === "bereken_hypotheek_doorstromer") {
    try {
      // Type guard to check if arguments exists
      if (!request.params.arguments) {
        throw new Error("Arguments are required");
      }

  const args = request.params.arguments as unknown as DoorstromerArguments;

  // Normaliseer inputvelden zodat varianten en LLM-output geaccepteerd worden
  const normalizedArgs = normalizeDoorstromerArgs(args);

// ========================================================================
// FASE 2: Validatie en logging voor bereken_hypotheek_doorstromer (blocking)
// ========================================================================
const logger = createLogger(normalizedArgs.session_id);
try {
  validateDoorstromerArguments(normalizedArgs);
  logger.info('Validation passed', { 
    tool: 'bereken_hypotheek_doorstromer',
    woningwaarde: normalizedArgs.waarde_huidige_woning,
    aantal_leningdelen: normalizedArgs.bestaande_hypotheek?.leningdelen?.length
  });
} catch (validationError) {
  if (validationError instanceof ValidationError) {
    logger.error('Validation failed - blocking execution', validationError);
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          error: "Validatiefout",
          message: validationError.message,
          field: (validationError as any).field,
          details: validationError.toStructured(normalizedArgs.session_id),
          help: "Controleer of alle verplichte velden correct zijn ingevuld"
        }, null, 2)
      }],
      isError: true,
    };
  }
  throw validationError;
}
// ========================================================================

// Transform naar API format
      const apiPayload: any = {
        aanvragers: {
          inkomen_aanvrager: args.inkomen_aanvrager,
          geboortedatum_aanvrager: args.geboortedatum_aanvrager,
          heeft_partner: args.heeft_partner,
          inkomen_partner: args.inkomen_partner,
          geboortedatum_partner: args.geboortedatum_partner,
          verplichtingen_pm: args.verplichtingen_pm || 0,
        },
        bestaande_hypotheek: {
          waarde_huidige_woning: normalizedArgs.waarde_huidige_woning,
          leningdelen: normalizedArgs.bestaande_hypotheek.leningdelen,
        },
      };

      // Voeg session_id toe indien aanwezig
      if (normalizedArgs.session_id) {
        apiPayload.session_id = normalizedArgs.session_id;
      }

      // Rate limit enforcement
      enforceRateLimit(normalizedArgs.session_id);

      const apiClient = getApiClient();
      try {
  const apiResponse = await apiClient.post(REPLIT_API_URL_BEREKENEN, apiPayload, { correlationId: normalizedArgs.session_id });
        const data = apiResponse.data;

        return {
          content: [
            {
              type: "text",
              text: formatResponse(data, "bereken_hypotheek_doorstromer"),
            },
          ],
        };
      } catch (err) {
        throw err;
      }
    } catch (error) {
      const sessionId = request.params.arguments && (request.params.arguments as any).session_id;
      if (error instanceof ValidationError) {
        return {
          content: [{ type: 'text', text: JSON.stringify(error.toStructured(sessionId), null, 2) }],
          isError: true,
        };
      }
      if (error instanceof APIError) {
        return {
          content: [{ type: 'text', text: JSON.stringify(error.toStructured(sessionId), null, 2) }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify({ code: ErrorCode.UNKNOWN_ERROR, message: error instanceof Error ? error.message : String(error), correlation_id: sessionId }, null, 2) }],
        isError: true,
      };
    }
  }

  // Tool 3: Uitgebreid
  if (request.params.name === "bereken_hypotheek_uitgebreid") {
    try {
      // Type guard to check if arguments exists
      if (!request.params.arguments) {
        throw new Error("Arguments are required");
      }

      const args = request.params.arguments as unknown as UitgebreidArguments;

      // Normaliseer alleen wanneer dit een doorstromer-case is
      const normalizedArgs = (args as any).is_doorstromer ? normalizeDoorstromerArgs(args) : args;


// ========================================================================
// FASE 2: Validatie en logging voor bereken_hypotheek_uitgebreid (blocking)
// ========================================================================
const logger = createLogger((normalizedArgs as any).session_id);
try {
  // Valideer base arguments
  validateBaseArguments(normalizedArgs as any);
  // Als doorstromer, valideer ook die gegevens
  if ((normalizedArgs as any).is_doorstromer && (normalizedArgs as any).bestaande_hypotheek) {
    validateBestaandeHypotheek((normalizedArgs as any).bestaande_hypotheek);
  }
  logger.info('Validation passed', { 
    tool: 'bereken_hypotheek_uitgebreid',
    is_doorstromer: (normalizedArgs as any).is_doorstromer,
    heeft_custom_params: !!(normalizedArgs as any).nieuwe_hypotheek
  });
} catch (validationError) {
  if (validationError instanceof ValidationError) {
    logger.error('Validation failed - blocking execution', validationError);
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          error: "Validatiefout",
          message: validationError.message,
          field: (validationError as any).field,
          details: validationError.toStructured((normalizedArgs as any).session_id),
          help: "Controleer of alle verplichte velden correct zijn ingevuld"
        }, null, 2)
      }],
      isError: true,
    };
  }
  throw validationError;
}
// ========================================================================

// Debug: log de ontvangen arguments
  console.error("=== UITGEBREID TOOL - Ontvangen arguments ===");
  console.error(JSON.stringify(normalizedArgs, null, 2));
      
      // Transform naar API format
      const apiPayload: any = {
        aanvragers: {
          inkomen_aanvrager: args.inkomen_aanvrager,
          geboortedatum_aanvrager: args.geboortedatum_aanvrager,
          heeft_partner: args.heeft_partner,
          inkomen_partner: args.inkomen_partner,
          geboortedatum_partner: args.geboortedatum_partner,
          verplichtingen_pm: args.verplichtingen_pm || 0,
        },
      };

      // Voeg bestaande hypotheek toe als doorstromer
      if ((normalizedArgs as any).is_doorstromer && (normalizedArgs as any).waarde_huidige_woning && (normalizedArgs as any).bestaande_hypotheek) {
        apiPayload.bestaande_hypotheek = {
          waarde_huidige_woning: (normalizedArgs as any).waarde_huidige_woning,
          leningdelen: (normalizedArgs as any).bestaande_hypotheek.leningdelen,
        };
      }

      // Voeg session_id toe indien aanwezig
      if ((normalizedArgs as any).session_id) {
        apiPayload.session_id = (normalizedArgs as any).session_id;
      }

      // Voeg nieuwe hypotheek parameters toe
      if ((normalizedArgs as any).nieuwe_hypotheek) {
        // Fix ltv als het als string binnenkomt (bijv. "100%")
        let ltvValue: number = 1.0;
        const nh = (normalizedArgs as any).nieuwe_hypotheek;
        if (nh.ltv) {
          if (typeof nh.ltv === 'string') {
            ltvValue = parseFloat((nh.ltv as string).replace('%', '')) / 100;
          } else {
            ltvValue = nh.ltv as number;
          }
        }

        const energielabel = normalizeEnergielabel(nh.energielabel || '');

        apiPayload.nieuwe_lening = {
          looptijd_maanden: nh.looptijd_maanden || 360,
          rentevaste_periode_maanden: nh.rentevaste_periode_maanden || 120,
          rente: nh.rente,
          hypotheekvorm: nh.hypotheekvorm || "annuiteit",
          energielabel: energielabel,
          nhg: nh.nhg || false,
          ltv: ltvValue,
        };
      }

      // Debug: log wat naar API gestuurd wordt
      console.error("=== UITGEBREID TOOL - API Payload ===");
      console.error(JSON.stringify(apiPayload, null, 2));

      // Rate limit enforcement
      enforceRateLimit((normalizedArgs as any).session_id);

      const apiClient = getApiClient();
      try {
        const apiResponse = await apiClient.post(REPLIT_API_URL_BEREKENEN, apiPayload, { correlationId: (normalizedArgs as any).session_id });
        const data = apiResponse.data;

        return {
          content: [
            {
              type: "text",
              text: formatResponse(data, "bereken_hypotheek_uitgebreid"),
            },
          ],
        };
      } catch (err) {
        throw err;
      }
    } catch (error) {
      const sessionId = request.params.arguments && (request.params.arguments as any).session_id;
      if (error instanceof ValidationError) {
        return {
          content: [{ type: 'text', text: JSON.stringify(error.toStructured(sessionId), null, 2) }],
          isError: true,
        };
      }
      if (error instanceof APIError) {
        return {
          content: [{ type: 'text', text: JSON.stringify(error.toStructured(sessionId), null, 2) }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify({ code: ErrorCode.UNKNOWN_ERROR, message: error instanceof Error ? error.message : String(error), correlation_id: sessionId }, null, 2) }],
        isError: true,
      };
    }
  }

  // Tool 4: Actuele rentes
  if (request.params.name === "haal_actuele_rentes_op") {
    try {
      // Enforce per-session rate limit and use API client for timeout/retries
      const sessionId = request.params.arguments && (request.params.arguments as any).session_id;
      enforceRateLimit(sessionId);
      const apiClient = getApiClient();
      try {
        const apiResponse = await apiClient.get(REPLIT_API_URL_RENTES, { correlationId: sessionId });
        const data = apiResponse.data;

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(data, null, 2),
            },
          ],
        };
      } catch (err) {
        throw err;
      }
    } catch (error) {
      const sessionId = request.params.arguments && (request.params.arguments as any).session_id;
      if (error instanceof ValidationError) {
        return {
          content: [{ type: 'text', text: JSON.stringify(error.toStructured(sessionId), null, 2) }],
          isError: true,
        };
      }
      if (error instanceof APIError) {
        return {
          content: [{ type: 'text', text: JSON.stringify(error.toStructured(sessionId), null, 2) }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify({ code: ErrorCode.UNKNOWN_ERROR, message: error instanceof Error ? error.message : String(error), correlation_id: sessionId }, null, 2) }],
        isError: true,
      };
    }
  }

  // Tool 5: Opzet hypotheek - Starter
  if (request.params.name === "opzet_hypotheek_starter") {
    try {
      if (!request.params.arguments) {
        throw new Error("Arguments are required");
      }

      const args = request.params.arguments as unknown as OpzetStarterArguments;

      



// ========================================================================
// FASE 1: Logging voor haal_actuele_rentes_op (geen validatie nodig)
// ========================================================================
const loggerRentes = createLogger(); // Geen session_id beschikbaar
loggerRentes.info('Fetching current rates', { tool: 'haal_actuele_rentes_op' });
// ========================================================================

// ========================================================================
// FASE 1: Validatie en logging voor opzet_hypotheek_starter
// ========================================================================
const logger = createLogger(args.session_id);
try {
  // Valideer base arguments
  validateBaseArguments({
    inkomen_aanvrager: args.inkomen_aanvrager,
    geboortedatum_aanvrager: args.geboortedatum_aanvrager,
    heeft_partner: args.heeft_partner,
    inkomen_partner: args.inkomen_partner,
    geboortedatum_partner: args.geboortedatum_partner,
    verplichtingen_pm: args.verplichtingen_pm
  } as any);
  logger.info('Validation passed', { 
    tool: 'opzet_hypotheek_starter',
    woningwaarde: args.nieuwe_woning?.waarde_woning,
    heeft_verbouwing: !!args.nieuwe_woning?.bedrag_verbouwen
  });
} catch (validationError) {
  if (validationError instanceof ValidationError) {
    logger.error('Validation failed - blocking execution', validationError);
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          error: "Validatiefout",
          message: validationError.message,
          field: (validationError as any).field,
          details: validationError.toStructured(args.session_id),
          help: "Controleer of alle verplichte velden correct zijn ingevuld"
        }, null, 2)
      }],
      isError: true,
    };
  } else {
    logger.warn('Unexpected validation error', { error: String(validationError) });
  }
}
// ========================================================================

// Transform naar API format
      const apiPayload: any = {
        aanvrager: {
          inkomen_aanvrager: args.inkomen_aanvrager,
          geboortedatum_aanvrager: args.geboortedatum_aanvrager,
          heeft_partner: args.heeft_partner,
          inkomen_partner: args.inkomen_partner || 0,
          geboortedatum_partner: args.geboortedatum_partner || null,
          verplichtingen_pm: args.verplichtingen_pm || 0,
          eigen_vermogen: args.eigen_vermogen || 0,
        },
        nieuwe_woning: {
          waarde_woning: args.nieuwe_woning.waarde_woning,
          bedrag_verbouwen: args.nieuwe_woning.bedrag_verbouwen || 0,
          bedrag_verduurzamen: args.nieuwe_woning.bedrag_verduurzamen || 0,
          kosten_percentage: args.nieuwe_woning.kosten_percentage || 0.05,
          energielabel: normalizeEnergielabel(args.nieuwe_woning.energielabel || ''),
        },
      };

      // Voeg session_id toe indien aanwezig
      if (args.session_id) {
        apiPayload.session_id = args.session_id;
      }

      // Rate limit enforcement
      enforceRateLimit(args.session_id);

      const apiClient = getApiClient();
      try {
        const apiResponse = await apiClient.post(REPLIT_API_URL_OPZET, apiPayload, { correlationId: args.session_id });
        const data = apiResponse.data;

        return {
          content: [
            {
              type: "text",
              text: formatResponse(data, "opzet_hypotheek_starter"),
            },
          ],
        };
      } catch (err) {
        throw err;
      }
    } catch (error) {
      const sessionId = request.params.arguments && (request.params.arguments as any).session_id;
      if (error instanceof ValidationError) {
        return {
          content: [{ type: 'text', text: JSON.stringify(error.toStructured(sessionId), null, 2) }],
          isError: true,
        };
      }
      if (error instanceof APIError) {
        return {
          content: [{ type: 'text', text: JSON.stringify(error.toStructured(sessionId), null, 2) }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify({ code: ErrorCode.UNKNOWN_ERROR, message: error instanceof Error ? error.message : String(error), correlation_id: sessionId }, null, 2) }],
        isError: true,
      };
    }
  }

  // Tool 6: Opzet hypotheek - Doorstromer
  if (request.params.name === "opzet_hypotheek_doorstromer") {
    try {
      if (!request.params.arguments) {
        throw new Error("Arguments are required");
      }

      const args = request.params.arguments as unknown as OpzetDoorstromerArguments;

      // Normaliseer input voor opzet doorstromer
      const normalizedArgs = normalizeOpzetDoorstromerArgs(args);


// ========================================================================
// FASE 2: Validatie en logging voor opzet_hypotheek_doorstromer (blocking)
// ========================================================================
const logger = createLogger(normalizedArgs.session_id);
try {
  validateBaseArguments({
    inkomen_aanvrager: normalizedArgs.inkomen_aanvrager,
    geboortedatum_aanvrager: normalizedArgs.geboortedatum_aanvrager,
    heeft_partner: normalizedArgs.heeft_partner,
    inkomen_partner: normalizedArgs.inkomen_partner,
    geboortedatum_partner: normalizedArgs.geboortedatum_partner,
    verplichtingen_pm: normalizedArgs.verplichtingen_pm
  } as any);
  validateBestaandeHypotheek(normalizedArgs.bestaande_hypotheek as any);
  logger.info('Validation passed', { 
    tool: 'opzet_hypotheek_doorstromer',
    woningwaarde_huidig: normalizedArgs.waarde_huidige_woning,
    woningwaarde_nieuw: normalizedArgs.nieuwe_woning?.waarde_woning
  });
} catch (validationError) {
  if (validationError instanceof ValidationError) {
    logger.error('Validation failed - blocking execution', validationError);
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          error: "Validatiefout",
          message: validationError.message,
          field: (validationError as any).field,
          details: validationError.toStructured(normalizedArgs.session_id),
          help: "Controleer of alle verplichte velden correct zijn ingevuld"
        }, null, 2)
      }],
      isError: true,
    };
  }
  throw validationError;
}
// ========================================================================

// Transform naar API format
      const apiPayload: any = {
        aanvrager: {
          inkomen_aanvrager: args.inkomen_aanvrager,
          geboortedatum_aanvrager: args.geboortedatum_aanvrager,
          heeft_partner: args.heeft_partner,
          inkomen_partner: args.inkomen_partner || 0,
          geboortedatum_partner: args.geboortedatum_partner || null,
          verplichtingen_pm: args.verplichtingen_pm || 0,
          eigen_vermogen: args.eigen_vermogen || 0,
        },
        bestaande_hypotheek: {
          waarde_huidige_woning: normalizedArgs.waarde_huidige_woning,
          leningdelen: normalizedArgs.bestaande_hypotheek.leningdelen,
        },
        nieuwe_woning: {
          waarde_woning: normalizedArgs.nieuwe_woning.waarde_woning,
          bedrag_verbouwen: normalizedArgs.nieuwe_woning.bedrag_verbouwen || 0,
          bedrag_verduurzamen: normalizedArgs.nieuwe_woning.bedrag_verduurzamen || 0,
          kosten_percentage: normalizedArgs.nieuwe_woning.kosten_percentage || 0.05,
          energielabel: normalizeEnergielabel(normalizedArgs.nieuwe_woning.energielabel || ''),
        },
      };

      // Voeg session_id toe indien aanwezig
      if (normalizedArgs.session_id) {
        apiPayload.session_id = normalizedArgs.session_id;
      }

      // Rate limit enforcement
      enforceRateLimit(normalizedArgs.session_id);

      const apiClient = getApiClient();
      try {
  const apiResponse = await apiClient.post(REPLIT_API_URL_OPZET, apiPayload, { correlationId: normalizedArgs.session_id });
        const data = apiResponse.data;

        return {
          content: [
            {
              type: "text",
              text: formatResponse(data, "opzet_hypotheek_doorstromer"),
            },
          ],
        };
      } catch (err) {
        throw err;
      }
    } catch (error) {
      const sessionId = request.params.arguments && (request.params.arguments as any).session_id;
      if (error instanceof ValidationError) {
        return {
          content: [{ type: 'text', text: JSON.stringify(error.toStructured(sessionId), null, 2) }],
          isError: true,
        };
      }
      if (error instanceof APIError) {
        return {
          content: [{ type: 'text', text: JSON.stringify(error.toStructured(sessionId), null, 2) }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify({ code: ErrorCode.UNKNOWN_ERROR, message: error instanceof Error ? error.message : String(error), correlation_id: sessionId }, null, 2) }],
        isError: true,
      };
    }
  }

  // Tool 7: Opzet hypotheek - Uitgebreid
  if (request.params.name === "opzet_hypotheek_uitgebreid") {
    try {
      if (!request.params.arguments) {
        throw new Error("Arguments are required");
      }

      const args = request.params.arguments as unknown as OpzetUitgebreidArguments;

      // Normalize doorstromer-related fields when present so validation/payloads use canonical keys
      const normalizedArgs = (args as any).is_doorstromer ? normalizeOpzetDoorstromerArgs(args) : args;

// ========================================================================
// FASE 2: Validatie en logging voor opzet_hypotheek_uitgebreid (blocking)
// ========================================================================
const logger = createLogger((normalizedArgs as any).session_id);
try {
  validateBaseArguments({
    inkomen_aanvrager: (normalizedArgs as any).inkomen_aanvrager,
    geboortedatum_aanvrager: (normalizedArgs as any).geboortedatum_aanvrager,
    heeft_partner: (normalizedArgs as any).heeft_partner,
    inkomen_partner: (normalizedArgs as any).inkomen_partner,
    geboortedatum_partner: (normalizedArgs as any).geboortedatum_partner,
    verplichtingen_pm: (normalizedArgs as any).verplichtingen_pm
  } as any);
  if ((normalizedArgs as any).is_doorstromer && (normalizedArgs as any).bestaande_hypotheek) {
    validateBestaandeHypotheek((normalizedArgs as any).bestaande_hypotheek);
  }
  logger.info('Validation passed', { 
    tool: 'opzet_hypotheek_uitgebreid',
    is_doorstromer: (normalizedArgs as any).is_doorstromer
  });
} catch (validationError) {
  if (validationError instanceof ValidationError) {
    logger.error('Validation failed - blocking execution', validationError);
    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          error: "Validatiefout",
          message: validationError.message,
          field: (validationError as any).field,
          details: validationError.toStructured((normalizedArgs as any).session_id),
          help: "Controleer of alle verplichte velden correct zijn ingevuld"
        }, null, 2)
      }],
      isError: true,
    };
  }
  throw validationError;
}
// ========================================================================

// Transform naar API format
      const apiPayload: any = {
        aanvrager: {
          inkomen_aanvrager: (normalizedArgs as any).inkomen_aanvrager,
          geboortedatum_aanvrager: (normalizedArgs as any).geboortedatum_aanvrager,
          heeft_partner: (normalizedArgs as any).heeft_partner,
          inkomen_partner: (normalizedArgs as any).inkomen_partner || 0,
          geboortedatum_partner: (normalizedArgs as any).geboortedatum_partner || null,
          verplichtingen_pm: (normalizedArgs as any).verplichtingen_pm || 0,
          eigen_vermogen: (normalizedArgs as any).eigen_vermogen || 0,
        },
        nieuwe_woning: {
          waarde_woning: (normalizedArgs as any).nieuwe_woning.waarde_woning,
          bedrag_verbouwen: (normalizedArgs as any).nieuwe_woning.bedrag_verbouwen || 0,
          bedrag_verduurzamen: (normalizedArgs as any).nieuwe_woning.bedrag_verduurzamen || 0,
          kosten_percentage: (normalizedArgs as any).nieuwe_woning.kosten_percentage || 0.05,
          energielabel: normalizeEnergielabel((normalizedArgs as any).nieuwe_woning.energielabel || ''),
        },
      };

      // Voeg bestaande hypotheek toe als doorstromer
      if ((normalizedArgs as any).is_doorstromer && (normalizedArgs as any).waarde_huidige_woning && (normalizedArgs as any).bestaande_hypotheek) {
        apiPayload.bestaande_hypotheek = {
          waarde_huidige_woning: (normalizedArgs as any).waarde_huidige_woning,
          leningdelen: (normalizedArgs as any).bestaande_hypotheek.leningdelen,
        };
      }

      // Voeg session_id toe indien aanwezig
      if ((normalizedArgs as any).session_id) {
        apiPayload.session_id = (normalizedArgs as any).session_id;
      }

      // Voeg nieuwe lening parameters toe
      if ((normalizedArgs as any).nieuwe_lening) {
        apiPayload.nieuwe_lening = {
          looptijd_jaren: (normalizedArgs as any).nieuwe_lening.looptijd_jaren || 30,
          rentevast_periode_jaren: (normalizedArgs as any).nieuwe_lening.rentevast_periode_jaren || 10,
          nhg: (normalizedArgs as any).nieuwe_lening.nhg || false,
        };
        
        // Voeg renteklassen toe indien gespecificeerd
        if ((normalizedArgs as any).nieuwe_lening.renteklassen && (normalizedArgs as any).nieuwe_lening.renteklassen.length > 0) {
          apiPayload.nieuwe_lening.renteklassen = (normalizedArgs as any).nieuwe_lening.renteklassen;
        }
      }

      // Rate limit enforcement
      enforceRateLimit((normalizedArgs as any).session_id);

      const apiClient = getApiClient();
      try {
        const apiResponse = await apiClient.post(REPLIT_API_URL_OPZET, apiPayload, { correlationId: (normalizedArgs as any).session_id });
        const data = apiResponse.data;

        return {
          content: [
            {
              type: "text",
              text: formatResponse(data, "opzet_hypotheek_uitgebreid"),
            },
          ],
        };
      } catch (err) {
        throw err;
      }
    } catch (error) {
      const sessionId = request.params.arguments && (request.params.arguments as any).session_id;
      if (error instanceof ValidationError) {
        return {
          content: [{ type: 'text', text: JSON.stringify(error.toStructured(sessionId), null, 2) }],
          isError: true,
        };
      }
      if (error instanceof APIError) {
        return {
          content: [{ type: 'text', text: JSON.stringify(error.toStructured(sessionId), null, 2) }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: JSON.stringify({ code: ErrorCode.UNKNOWN_ERROR, message: error instanceof Error ? error.message : String(error), correlation_id: sessionId }, null, 2) }],
        isError: true,
      };
    }
  }

  throw new Error(`Onbekende tool: ${request.params.name}`);
  } catch (err) {
    success = false;
    if (err instanceof ValidationError) {
      try { recordValidationError((err as any).code || 'validation_error'); } catch (e) { /* ignore metrics failure */ }
    }
    throw err;
  } finally {
    const duration = Date.now() - startTime;
    try { recordToolCall(toolName, duration, success); } catch (e) { /* ignore metrics failure */ }
  }
});

// Start de server met stdio transport
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Hypotheek MCP Server v3.0 draait (stdio mode) met 7 tools!");
  console.error("Maximale hypotheek: bereken_hypotheek_starter, bereken_hypotheek_doorstromer, bereken_hypotheek_uitgebreid");
  console.error("Opzet hypotheek: opzet_hypotheek_starter, opzet_hypotheek_doorstromer, opzet_hypotheek_uitgebreid");
  console.error("Overig: haal_actuele_rentes_op");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
