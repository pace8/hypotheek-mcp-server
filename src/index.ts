#!/usr/bin/env node
import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// Je Replit API URLs en API Key
const REPLIT_API_URL_BEREKENEN = "https://digital-mortgage-calculator.replit.app/berekenen/maximaal";
const REPLIT_API_URL_RENTES = "https://digital-mortgage-calculator.replit.app/rentes";
const API_KEY = process.env.REPLIT_API_KEY;

if (!API_KEY) {
  console.error("FOUT: REPLIT_API_KEY environment variabele is niet ingesteld!");
  process.exit(1);
}

// Type definitions voor de arguments
interface BaseArguments {
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

const server = new Server(
  {
    name: "hypotheek-berekening-server",
    version: "2.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Helper functie om energielabel te normaliseren
function normalizeEnergielabel(label: string | undefined): string | undefined {
  if (!label) return undefined;
  
  // Map van veelvoorkomende fouten naar correcte waarden
  const labelMap: Record<string, string> = {
    'A++++': 'A++++',
    'A++++ (met garantie)': 'A++++ (met garantie)',
    'A+++': 'A+++',
    'A++': 'A++',
    'A+': 'A+',
    'A': 'A',
    'B': 'B',
    'C': 'C',
    'D': 'D',
    'E': 'E',
    'F': 'F',
    'G': 'G',
  };
  
  return labelMap[label] || label;
}

// Lijst met beschikbare tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      // Tool 1: Starters - Simpele berekening
      {
        name: "bereken_hypotheek_starter",
        description: "Berekent de maximale hypotheek voor STARTERS (eerste woning). Voor mensen zonder bestaande hypotheek die hun eerste huis willen kopen. Geeft 2 resultaten: één op basis van NHG condities en één zonder NHG. Vraag alleen naar: inkomen, leeftijd, en eventuele maandelijkse verplichtingen. Gebruikt standaard hypotheekvoorwaarden.",
        inputSchema: {
          type: "object",
          properties: {
            inkomen_aanvrager: {
              type: "number",
              description: "Bruto jaarinkomen van de hoofdaanvrager in euro's",
            },
            geboortedatum_aanvrager: {
              type: "string",
              description: "Geboortedatum aanvrager in formaat YYYY-MM-DD. TIP: Vraag de gebruiker naar zijn/haar leeftijd en reken dit om naar een geboortedatum waarbij de persoon morgen jarig wordt.",
            },
            heeft_partner: {
              type: "boolean",
              description: "Heeft de aanvrager een partner die mee aanvraagt?",
            },
            inkomen_partner: {
              type: "number",
              description: "OPTIONEEL - Bruto jaarinkomen van de partner in euro's. Alleen invullen indien heeft_partner: true",
            },
            geboortedatum_partner: {
              type: "string",
              description: "OPTIONEEL - Geboortedatum partner in formaat YYYY-MM-DD. Alleen invullen indien heeft_partner: true.",
            },
            verplichtingen_pm: {
              type: "number",
              description: "Maandelijkse verplichtingen in euro's (andere leningen, alimentatie, etc.). Gebruik 0 als er geen verplichtingen zijn.",
              default: 0,
            },
          },
          required: [
            "inkomen_aanvrager",
            "geboortedatum_aanvrager",
            "heeft_partner",
            "verplichtingen_pm",
          ],
        },
      },
      
      // Tool 2: Doorstromers - Met bestaande hypotheek
      {
        name: "bereken_hypotheek_doorstromer",
        description: "Berekent de maximale hypotheek voor DOORSTROMERS (mensen met bestaande koopwoning en hypotheek). Voor mensen die een nieuwe woning willen kopen en hun huidige woning verkopen. Vraag naar: inkomen, leeftijd, verplichtingen, huidige woningwaarde, en bestaande hypotheekgegevens. Er zijn twee invulmogelijkheden voor de bestaande hypotheek: SIMPEL (totale schuld, gemiddelde rente, looptijd in maanden) of GEDETAILLEERD (alle leningdelen apart). BELANGRIJK: Rentes moeten als decimaal (bijv. 0.02 voor 2%, 0.041 voor 4.1%). Looptijden altijd in MAANDEN.",
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
              description: "OPTIONEEL - Bruto jaarinkomen van de partner in euro's. Alleen invullen indien heeft_partner: true",
            },
            geboortedatum_partner: {
              type: "string",
              description: "OPTIONEEL - Geboortedatum partner in formaat YYYY-MM-DD. Alleen invullen indien heeft_partner: true.",
            },
            verplichtingen_pm: {
              type: "number",
              description: "Maandelijkse verplichtingen in euro's. Gebruik 0 als er geen zijn.",
              default: 0,
            },
            waarde_huidige_woning: {
              type: "number",
              description: "Huidige marktwaarde van de woning die verkocht wordt, in euro's",
            },
            bestaande_hypotheek: {
              type: "object",
              description: "Gegevens van de bestaande hypotheek. Twee opties: SIMPEL (1 leningdeel met totalen) of GEDETAILLEERD (alle leningdelen apart). BELANGRIJK: Rentes als decimaal (0.02 = 2%), looptijden in MAANDEN.",
              properties: {
                leningdelen: {
                  type: "array",
                  description: "Bestaande leningdelen. Voor SIMPELE berekening: 1 item met totale restschuld, gemiddelde rente, resterende looptijd in MAANDEN, rentevasteperiode_maanden: 10, hypotheekvorm: 'annuiteit'. Voor GEDETAILLEERDE berekening: elk leningdeel apart.",
                  items: {
                    type: "object",
                    properties: {
                      huidige_schuld: {
                        type: "number",
                        description: "Restschuld van dit leningdeel in euro's",
                      },
                      huidige_rente: {
                        type: "number",
                        description: "Rente als decimaal (bijv. 0.02 voor 2%, 0.041 voor 4.1%)",
                      },
                      resterende_looptijd_in_maanden: {
                        type: "number",
                        description: "Resterende looptijd in MAANDEN (niet jaren!). Bijvoorbeeld: 20 jaar = 240 maanden, 30 jaar = 360 maanden.",
                      },
                      rentevasteperiode_maanden: {
                        type: "number",
                        description: "Resterende rentevaste periode in MAANDEN. Bij simpele berekening: gebruik 10 maanden.",
                      },
                      hypotheekvorm: {
                        type: "string",
                        description: "Type hypotheek: 'annuiteit', 'lineair', of 'aflossingsvrij'",
                        enum: ["annuiteit", "lineair", "aflossingsvrij"],
                      },
                    },
                    required: ["huidige_schuld", "huidige_rente", "resterende_looptijd_in_maanden", "rentevasteperiode_maanden", "hypotheekvorm"],
                  },
                },
              },
              required: ["leningdelen"],
            },
          },
          required: [
            "inkomen_aanvrager",
            "geboortedatum_aanvrager",
            "heeft_partner",
            "verplichtingen_pm",
            "waarde_huidige_woning",
            "bestaande_hypotheek",
          ],
        },
      },
      
      // Tool 3: Uitgebreid - Alle parameters configureerbaar
      {
        name: "bereken_hypotheek_uitgebreid",
        description: "ALLEEN voor berekeningen met aangepaste parameters (specifieke rente, energielabel, looptijd, hypotheekvorm). Voor normale berekeningen gebruik 'bereken_hypotheek_starter' of 'bereken_hypotheek_doorstromer'. \n\nLET OP: Vul de parameters in zoals hieronder beschreven (NIET als nested 'aanvragers' of 'nieuwe_lening' objecten - dat doet de code automatisch).",
        inputSchema: {
          type: "object",
          properties: {
            // Basis gegevens (zelfde als andere tools)
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
            
            // Bestaande situatie (voor doorstromers)
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
            
            // Nieuwe hypotheek parameters (optioneel)
            nieuwe_hypotheek: {
              type: "object",
              description: "Parameters voor de nieuwe hypotheek. VERPLICHT als je energielabel, rente, of andere specifieke parameters wilt instellen. Vul ALLE onderstaande velden in (gebruik standaardwaarden als de gebruiker ze niet specificeert).",
              properties: {
                looptijd_maanden: {
                  type: "number",
                  description: "Looptijd van de hypotheek in MAANDEN. Standaard: 360 (= 30 jaar). Voorbeelden: 20 jaar = 240, 25 jaar = 300, 30 jaar = 360",
                  default: 360,
                },
                rentevaste_periode_maanden: {
                  type: "number",
                  description: "Rentevaste periode in MAANDEN. Standaard: 120 (= 10 jaar). Voorbeelden: 5 jaar = 60, 10 jaar = 120, 20 jaar = 240",
                  default: 120,
                },
                rente: {
                  type: "number",
                  description: "Rentepercentage als DECIMAAL. Voorbeelden: 3.72% = 0.0372, 4.0% = 0.04, 4.1% = 0.041",
                },
                hypotheekvorm: {
                  type: "string",
                  description: "Type hypotheek. Standaard: 'annuiteit'. Opties: 'annuiteit' (meest voorkomend), 'lineair', 'aflossingsvrij'",
                  enum: ["annuiteit", "lineair", "aflossingsvrij"],
                  default: "annuiteit",
                },
                energielabel: {
                  type: "string",
                  description: "Energielabel van de woning. Let op: gebruik de EXACTE string inclusief haakjes! Voorbeelden: 'A++++ (met garantie)', 'A++++', 'A+++', 'C', 'G'",
                  enum: ["A++++ (met garantie)", "A++++", "A+++", "A++", "A+", "A", "B", "C", "D", "E", "F", "G"],
                },
                nhg: {
                  type: "boolean",
                  description: "Nationale Hypotheek Garantie aanvragen? Standaard: false",
                  default: false,
                },
                ltv: {
                  type: "number",
                  description: "Loan-to-Value als DECIMAAL GETAL (niet als percentage string!). 100% = 1.0, 90% = 0.9. Gebruik 1.0 voor 100%.",
                  default: 1.0,
                },
              },
              required: ["looptijd_maanden", "rentevaste_periode_maanden", "hypotheekvorm"],
            },
          },
          required: [
            "inkomen_aanvrager",
            "geboortedatum_aanvrager",
            "heeft_partner",
          ],
        },
      },
      
      // Tool 4: Actuele rentes ophalen
      {
        name: "haal_actuele_rentes_op",
        description: "Haalt de actuele hypotheekrente tarieven op voor verschillende rentevaste periodes. Deze tool geeft inzicht in de huidige marktrentes die gebruikt kunnen worden bij hypotheekberekeningen. Vraag hiernaar als de gebruiker wil weten wat de huidige rentes zijn.",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
    ],
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

  return output;
}

// Handler voor tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  // Tool 1: Starters
  if (request.params.name === "bereken_hypotheek_starter") {
    try {
      // Type guard to check if arguments exists
      if (!request.params.arguments) {
        throw new Error("Arguments are required");
      }

      const args = request.params.arguments as unknown as BaseArguments;

      // Transform naar API format
      const apiPayload = {
        aanvragers: {
          inkomen_aanvrager: args.inkomen_aanvrager,
          geboortedatum_aanvrager: args.geboortedatum_aanvrager,
          heeft_partner: args.heeft_partner,
          inkomen_partner: args.inkomen_partner,
          geboortedatum_partner: args.geboortedatum_partner,
          verplichtingen_pm: args.verplichtingen_pm || 0,
        },
      };

      const response = await fetch(REPLIT_API_URL_BEREKENEN, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(apiPayload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();

      return {
        content: [
          {
            type: "text",
            text: formatResponse(data, "bereken_hypotheek_starter"),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `❌ Error bij het berekenen van hypotheek voor starter: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
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

      // Transform naar API format
      const apiPayload = {
        aanvragers: {
          inkomen_aanvrager: args.inkomen_aanvrager,
          geboortedatum_aanvrager: args.geboortedatum_aanvrager,
          heeft_partner: args.heeft_partner,
          inkomen_partner: args.inkomen_partner,
          geboortedatum_partner: args.geboortedatum_partner,
          verplichtingen_pm: args.verplichtingen_pm || 0,
        },
        bestaande_lening: {
          waarde_huidige_woning: args.waarde_huidige_woning,
          bestaande_leningdelen: args.bestaande_hypotheek.leningdelen,
        },
      };

      const response = await fetch(REPLIT_API_URL_BEREKENEN, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(apiPayload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();

      return {
        content: [
          {
            type: "text",
            text: formatResponse(data, "bereken_hypotheek_doorstromer"),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `❌ Error bij het berekenen van hypotheek voor doorstromer: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
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
      
      // Debug: log de ontvangen arguments
      console.error("=== UITGEBREID TOOL - Ontvangen arguments ===");
      console.error(JSON.stringify(args, null, 2));
      
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

      // Voeg bestaande lening toe als doorstromer
      if (args.is_doorstromer && args.waarde_huidige_woning && args.bestaande_hypotheek) {
        apiPayload.bestaande_lening = {
          waarde_huidige_woning: args.waarde_huidige_woning,
          bestaande_leningdelen: args.bestaande_hypotheek.leningdelen,
        };
      }

      // Voeg nieuwe hypotheek parameters toe
      if (args.nieuwe_hypotheek) {
        // Fix ltv als het als string binnenkomt (bijv. "100%")
        let ltvValue: number = 1.0;
        if (args.nieuwe_hypotheek.ltv) {
          if (typeof args.nieuwe_hypotheek.ltv === 'string') {
            // Converteer "100%" naar 1.0, "90%" naar 0.9, etc.
            ltvValue = parseFloat((args.nieuwe_hypotheek.ltv as string).replace('%', '')) / 100;
          } else {
            ltvValue = args.nieuwe_hypotheek.ltv as number;
          }
        }
        
        // Normaliseer energielabel
        const energielabel = normalizeEnergielabel(args.nieuwe_hypotheek.energielabel);
        
        apiPayload.nieuwe_lening = {
          looptijd_maanden: args.nieuwe_hypotheek.looptijd_maanden || 360,
          rentevaste_periode_maanden: args.nieuwe_hypotheek.rentevaste_periode_maanden || 120,
          rente: args.nieuwe_hypotheek.rente,
          hypotheekvorm: args.nieuwe_hypotheek.hypotheekvorm || "annuiteit",
          energielabel: energielabel,
          nhg: args.nieuwe_hypotheek.nhg || false,
          ltv: ltvValue,
        };
      }

      // Debug: log wat naar API gestuurd wordt
      console.error("=== UITGEBREID TOOL - API Payload ===");
      console.error(JSON.stringify(apiPayload, null, 2));

      const response = await fetch(REPLIT_API_URL_BEREKENEN, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(apiPayload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();

      return {
        content: [
          {
            type: "text",
            text: formatResponse(data, "bereken_hypotheek_uitgebreid"),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `❌ Error bij uitgebreide hypotheekberekening: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  // Tool 4: Actuele rentes
  if (request.params.name === "haal_actuele_rentes_op") {
    try {
      const response = await fetch(REPLIT_API_URL_RENTES, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${API_KEY}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`API error: ${response.status} ${response.statusText} - ${errorText}`);
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
            text: `❌ Error bij het ophalen van actuele rentes: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  }

  throw new Error(`Onbekende tool: ${request.params.name}`);
});

// Start de server met stdio transport
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Hypotheek MCP Server v2.0 draait (stdio mode) met 4 tools!");
  console.error("Tools: bereken_hypotheek_starter, bereken_hypotheek_doorstromer, bereken_hypotheek_uitgebreid, haal_actuele_rentes_op");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});