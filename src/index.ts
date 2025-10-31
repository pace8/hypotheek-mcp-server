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
const REPLIT_API_URL_OPZET = "https://digital-mortgage-calculator.replit.app/berekenen/opzet-hypotheek";
const REPLIT_API_URL_RENTES = "https://digital-mortgage-calculator.replit.app/rentes";
const API_KEY = process.env.REPLIT_API_KEY;

if (!API_KEY) {
  console.error("FOUT: REPLIT_API_KEY environment variabele is niet ingesteld!");
  process.exit(1);
}

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

const server = new Server(
  {
    name: "hypotheek-berekening-server",
    version: "3.0.0",
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
            session_id: {
              type: "string",
              description: "OPTIONEEL - Sessie ID voor het traceren van de conversatie. Haal deze waarde uit de n8n chat trigger: 'When chat message received' -> sessionId variabele.",
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
            session_id: {
              type: "string",
              description: "OPTIONEEL - Sessie ID voor het traceren van de conversatie. Haal deze waarde uit de n8n chat trigger: 'When chat message received' -> sessionId variabele.",
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
            session_id: {
              type: "string",
              description: "OPTIONEEL - Sessie ID voor het traceren van de conversatie. Haal deze waarde uit de n8n chat trigger: 'When chat message received' -> sessionId variabele.",
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
      
      // Tool 5: Opzet hypotheek - Starters
      {
        name: "opzet_hypotheek_starter",
        description: "Berekent de opzet van een hypotheek voor STARTERS (eerste koopwoning). Voor mensen zonder bestaande hypotheek die hun eerste huis willen kopen. Berekent het benodigde bedrag, financieringsmogelijkheden en maandlasten op basis van: inkomen, leeftijd, eigen vermogen, woningprijs, en eventuele verbouwings-/verduurzamingskosten. Vraag ook naar energielabel van de nieuwe woning.",
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
            eigen_vermogen: {
              type: "number",
              description: "Eigen geld beschikbaar in euro's (spaargeld, gift, etc.). Gebruik 0 als er geen eigen vermogen is.",
              default: 0,
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
                  description: "OPTIONEEL - Geschatte kosten voor verbouwing/meerwerk in euro's. Gebruik 0 als er geen verbouwing is.",
                  default: 0,
                },
                bedrag_verduurzamen: {
                  type: "number",
                  description: "OPTIONEEL - Geschatte kosten voor verduurzaming in euro's. Gebruik 0 als er geen verduurzaming is.",
                  default: 0,
                },
                kosten_percentage: {
                  type: "number",
                  description: "OPTIONEEL - Koperkosten als decimaal (bijv. 0.05 voor 5%). Standaard: 0.05 (= 5%)",
                  default: 0.05,
                },
                energielabel: {
                  type: "string",
                  description: "OPTIONEEL - Energielabel van de nieuwe woning. Gebruik exacte notatie!",
                  enum: ["A++++ (met garantie)", "A++++", "A+++", "A++", "A+", "A", "B", "C", "D", "E", "F", "G"],
                },
              },
              required: ["waarde_woning"],
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
      
      // Tool 6: Opzet hypotheek - Doorstromers
      {
        name: "opzet_hypotheek_doorstromer",
        description: "Berekent de opzet van een hypotheek voor DOORSTROMERS (mensen met bestaande koopwoning en hypotheek). Voor mensen die een nieuwe woning willen kopen en hun huidige woning verkopen. Berekent het benodigde bedrag, overwaarde, nieuwe financiering en maandlasten. Vraag naar: inkomen, leeftijd, eigen vermogen, huidige woningwaarde, bestaande hypotheekgegevens, nieuwe woningprijs, en eventuele verbouwings-/verduurzamingskosten. BELANGRIJK: Rentes als decimaal (0.02 = 2%), looptijden in MAANDEN.",
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
            eigen_vermogen: {
              type: "number",
              description: "Eigen geld beschikbaar in euro's (spaargeld, gift, etc.). Gebruik 0 als er geen eigen vermogen is.",
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
                  description: "OPTIONEEL - Geschatte kosten voor verbouwing/meerwerk in euro's. Gebruik 0 als er geen verbouwing is.",
                  default: 0,
                },
                bedrag_verduurzamen: {
                  type: "number",
                  description: "OPTIONEEL - Geschatte kosten voor verduurzaming in euro's. Gebruik 0 als er geen verduurzaming is.",
                  default: 0,
                },
                kosten_percentage: {
                  type: "number",
                  description: "OPTIONEEL - Koperkosten als decimaal (bijv. 0.05 voor 5%). Standaard: 0.05 (= 5%)",
                  default: 0.05,
                },
                energielabel: {
                  type: "string",
                  description: "OPTIONEEL - Energielabel van de nieuwe woning. Gebruik exacte notatie!",
                  enum: ["A++++ (met garantie)", "A++++", "A+++", "A++", "A+", "A", "B", "C", "D", "E", "F", "G"],
                },
              },
              required: ["waarde_woning"],
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
            "waarde_huidige_woning",
            "bestaande_hypotheek",
            "nieuwe_woning",
          ],
        },
      },
      
      // Tool 7: Opzet hypotheek - Uitgebreid
      {
        name: "opzet_hypotheek_uitgebreid",
        description: "GEAVANCEERDE opzet hypotheek berekening met VOLLEDIGE controle over alle parameters. Geschikt voor zowel starters als doorstromers. Gebruik deze tool ALLEEN als de gebruiker specifiek vraagt om aangepaste parameters zoals: specifieke renteklassen, looptijd in jaren, rentevast periode in jaren, NHG ja/nee. Voor standaard berekeningen gebruik 'opzet_hypotheek_starter' of 'opzet_hypotheek_doorstromer'.",
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
    output += `🏠 **OPZET HYPOTHEEK - ${toolType}**\n\n`;
    
    if (data.resultaat) {
      const resultaat = data.resultaat;
      
      output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      output += `📊 **BENODIGD BEDRAG**\n`;
      output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
      
      if (resultaat.Benodigd_bedrag) {
        output += `🏡 **Woning koopsom:** €${resultaat.Benodigd_bedrag.Woning_koopsom?.toLocaleString('nl-NL') || 'N/A'}\n`;
        if (resultaat.Benodigd_bedrag.Verbouwingskosten_meerwerk > 0) {
          output += `🔨 **Verbouwing/meerwerk:** €${resultaat.Benodigd_bedrag.Verbouwingskosten_meerwerk?.toLocaleString('nl-NL') || 'N/A'}\n`;
        }
        if (resultaat.Benodigd_bedrag.Verduurzamingskosten > 0) {
          output += `♻️ **Verduurzaming:** €${resultaat.Benodigd_bedrag.Verduurzamingskosten?.toLocaleString('nl-NL') || 'N/A'}\n`;
        }
        output += `💼 **Koperkosten:** €${resultaat.Benodigd_bedrag.Kosten?.toLocaleString('nl-NL') || 'N/A'}\n`;
        
        const totaalBenodigd = (resultaat.Benodigd_bedrag.Woning_koopsom || 0) + 
                               (resultaat.Benodigd_bedrag.Verbouwingskosten_meerwerk || 0) +
                               (resultaat.Benodigd_bedrag.Verduurzamingskosten || 0) +
                               (resultaat.Benodigd_bedrag.Kosten || 0);
        output += `\n💰 **TOTAAL BENODIGD:** €${totaalBenodigd.toLocaleString('nl-NL')}\n\n`;
      }
      
      output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      output += `💵 **FINANCIERING**\n`;
      output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
      
      if (resultaat.Financiering) {
        output += `🏦 **Hypotheek:** €${resultaat.Financiering.Hypotheek?.toLocaleString('nl-NL') || 'N/A'}\n`;
        if (resultaat.Financiering.Overwaarde !== undefined && resultaat.Financiering.Overwaarde > 0) {
          output += `📈 **Overwaarde:** €${resultaat.Financiering.Overwaarde?.toLocaleString('nl-NL') || 'N/A'}\n`;
        }
        output += `💎 **Eigen geld:** €${resultaat.Financiering.Eigen_geld?.toLocaleString('nl-NL') || 'N/A'}\n\n`;
      }
      
      output += `📊 **Bruto maandlasten nieuwe lening:** €${resultaat.bruto_maandlasten_nieuwe_lening?.toLocaleString('nl-NL', {minimumFractionDigits: 2, maximumFractionDigits: 2}) || 'N/A'}\n\n`;
      
      if (resultaat.gebruikte_hypotheekgegevens) {
        output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        output += `🔍 **HYPOTHEEKGEGEVENS**\n`;
        output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
        
        output += `⚡ **Energielabel:** ${resultaat.gebruikte_hypotheekgegevens.energielabel || 'N/A'}\n`;
        if (resultaat.gebruikte_hypotheekgegevens.energielabel_toeslag > 0) {
          output += `💡 **Energielabel toeslag:** €${resultaat.gebruikte_hypotheekgegevens.energielabel_toeslag?.toLocaleString('nl-NL') || 'N/A'}\n`;
        }
        output += `🛡️ **NHG toegepast:** ${resultaat.gebruikte_hypotheekgegevens.nhg_toegepast ? 'Ja' : 'Nee'}\n\n`;
        
        if (resultaat.gebruikte_hypotheekgegevens.opzet_nieuwe_hypotheek && 
            Array.isArray(resultaat.gebruikte_hypotheekgegevens.opzet_nieuwe_hypotheek)) {
          output += `**📋 Opzet nieuwe hypotheek:**\n\n`;
          
          resultaat.gebruikte_hypotheekgegevens.opzet_nieuwe_hypotheek.forEach((deel: any, index: number) => {
            const deelType = deel.type === 'bestaand_leningdeel' ? '🔄 Bestaand leningdeel' : '🆕 Nieuwe lening';
            output += `${deelType} ${index + 1}:\n`;
            output += `  • Bedrag: €${deel.hypotheekbedrag?.toLocaleString('nl-NL') || 'N/A'}\n`;
            output += `  • Rente: ${deel.rente ? (deel.rente * 100).toFixed(2) + '%' : 'N/A'}\n`;
            output += `  • Hypotheekvorm: ${deel.hypotheekvorm || 'N/A'}\n`;
            
            if (deel.type === 'bestaand_leningdeel') {
              output += `  • Resterende looptijd: ${deel.resterende_looptijd_maanden ? (deel.resterende_looptijd_maanden / 12).toFixed(1) + ' jaar' : 'N/A'}\n`;
              output += `  • Rentevast periode: ${deel.rentevastperiode_maanden ? (deel.rentevastperiode_maanden / 12).toFixed(1) + ' jaar' : 'N/A'}\n`;
            } else {
              output += `  • Looptijd: ${deel.looptijd_maanden ? (deel.looptijd_maanden / 12).toFixed(0) + ' jaar' : 'N/A'}\n`;
              output += `  • Rentevast periode: ${deel.rentevastperiode_maanden ? (deel.rentevastperiode_maanden / 12).toFixed(0) + ' jaar' : 'N/A'}\n`;
            }
            output += `\n`;
          });
        }
      }
    }
    
    if (data.extra_informatie && data.extra_informatie.disclaimers) {
      output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
      output += `⚠️ **DISCLAIMERS**\n`;
      output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
      data.extra_informatie.disclaimers.forEach((disclaimer: string) => {
        output += `• ${disclaimer}\n`;
      });
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
      const apiPayload: any = {
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

      // Voeg session_id toe indien aanwezig
      if (args.session_id) {
        apiPayload.session_id = args.session_id;
      }

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

      // Voeg session_id toe indien aanwezig
      if (args.session_id) {
        apiPayload.session_id = args.session_id;
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

  // Tool 5: Opzet hypotheek - Starter
  if (request.params.name === "opzet_hypotheek_starter") {
    try {
      if (!request.params.arguments) {
        throw new Error("Arguments are required");
      }

      const args = request.params.arguments as unknown as OpzetStarterArguments;

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
          energielabel: normalizeEnergielabel(args.nieuwe_woning.energielabel),
        },
      };

      // Voeg session_id toe indien aanwezig
      if (args.session_id) {
        apiPayload.session_id = args.session_id;
      }

      const response = await fetch(REPLIT_API_URL_OPZET, {
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
            text: formatResponse(data, "opzet_hypotheek_starter"),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `❌ Error bij het berekenen van opzet hypotheek voor starter: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
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
        bestaande_lening: {
          waarde_huidige_woning: args.waarde_huidige_woning,
          bestaande_leningdelen: args.bestaande_hypotheek.leningdelen,
        },
        nieuwe_woning: {
          waarde_woning: args.nieuwe_woning.waarde_woning,
          bedrag_verbouwen: args.nieuwe_woning.bedrag_verbouwen || 0,
          bedrag_verduurzamen: args.nieuwe_woning.bedrag_verduurzamen || 0,
          kosten_percentage: args.nieuwe_woning.kosten_percentage || 0.05,
          energielabel: normalizeEnergielabel(args.nieuwe_woning.energielabel),
        },
      };

      // Voeg session_id toe indien aanwezig
      if (args.session_id) {
        apiPayload.session_id = args.session_id;
      }

      const response = await fetch(REPLIT_API_URL_OPZET, {
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
            text: formatResponse(data, "opzet_hypotheek_doorstromer"),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `❌ Error bij het berekenen van opzet hypotheek voor doorstromer: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
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
          energielabel: normalizeEnergielabel(args.nieuwe_woning.energielabel),
        },
      };

      // Voeg bestaande lening toe als doorstromer
      if (args.is_doorstromer && args.waarde_huidige_woning && args.bestaande_hypotheek) {
        apiPayload.bestaande_lening = {
          waarde_huidige_woning: args.waarde_huidige_woning,
          bestaande_leningdelen: args.bestaande_hypotheek.leningdelen,
        };
      }

      // Voeg session_id toe indien aanwezig
      if (args.session_id) {
        apiPayload.session_id = args.session_id;
      }

      // Voeg nieuwe lening parameters toe
      if (args.nieuwe_lening) {
        apiPayload.nieuwe_lening = {
          looptijd_jaren: args.nieuwe_lening.looptijd_jaren || 30,
          rentevast_periode_jaren: args.nieuwe_lening.rentevast_periode_jaren || 10,
          nhg: args.nieuwe_lening.nhg || false,
        };
        
        // Voeg renteklassen toe indien gespecificeerd
        if (args.nieuwe_lening.renteklassen && args.nieuwe_lening.renteklassen.length > 0) {
          apiPayload.nieuwe_lening.renteklassen = args.nieuwe_lening.renteklassen;
        }
      }

      const response = await fetch(REPLIT_API_URL_OPZET, {
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
            text: formatResponse(data, "opzet_hypotheek_uitgebreid"),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `❌ Error bij uitgebreide opzet hypotheek berekening: ${error instanceof Error ? error.message : String(error)}`,
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
  console.error("Hypotheek MCP Server v3.0 draait (stdio mode) met 7 tools!");
  console.error("Maximale hypotheek: bereken_hypotheek_starter, bereken_hypotheek_doorstromer, bereken_hypotheek_uitgebreid");
  console.error("Opzet hypotheek: opzet_hypotheek_starter, opzet_hypotheek_doorstromer, opzet_hypotheek_uitgebreid");
  console.error("Overig: haal_actuele_rentes_op");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});