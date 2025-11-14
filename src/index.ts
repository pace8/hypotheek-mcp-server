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
import { createLogger } from './utils/logger.js';
import { getConfig } from './config/index.js';
import { 
  validateBaseArguments, 
  validateDoorstromerArguments,
  validateBestaandeHypotheek
} from './validation/schemas.js';
import { ValidationError, normalizeEnergielabel, APIError, ErrorCode } from './types/index.js';
import { getApiClient } from './api/client.js';
import { enforceRateLimit } from './middleware/rate-limiter.js';
import { 
  normalizeDoorstromerArgs,
  normalizeOpzetDoorstromerArgs,
  normalizeOpzetAanvragerShape,
} from './adapters/field-normalizer.js';
import { recordToolCall, recordValidationError } from './metrics/exporter.js';
import { listResources, readResource } from './resources/index.js';
import { getPrompt, listPrompts } from './prompts/index.js';

const config = getConfig();

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
interface OpzetAanvrager {
  inkomen_aanvrager: number;
  geboortedatum_aanvrager: string;
  heeft_partner: boolean;
  inkomen_partner?: number;
  geboortedatum_partner?: string;
  verplichtingen_pm?: number;
  eigen_vermogen?: number;
}

interface OpzetBaseArguments {
  session_id?: string; // OPTIONEEL - Sessie ID van de gebruiker uit n8n chat trigger: "When chat message received"
  aanvrager: OpzetAanvrager;
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

const DOORSTROMER_OUTPUT_GUIDANCE = `
**Outputvelden (altijd rechtstreeks gebruiken in de terugkoppeling):**
- max_woningbudget → woningbudget inclusief overwaarde en extra leencapaciteit
- overwaarde_bedrag → vrijvallende winst uit de huidige woning
- huidige_hypotheek_schuld → resterende schuld die moet worden afgelost
- extra_leencapaciteit → nieuwe hypotheekruimte bovenop de overwaarde
- maandlast_nu, maandlast_straks en verschil_maandlast → huidige, toekomstige en delta maandlast

**Presentatie richting gebruiker (één compact blok):**
- Toon het woningbudget centraal onder de titel "Uw woningbudget" en licht toe waaruit dit bedrag bestaat in bullets (overwaarde, huidige hypotheek, extra leencapaciteit).
- Voeg een tweede blok toe "Uw nieuwe maandlast" met maandlast nu, maandlast straks en het verschil (positief/negatief) op eigen regel.
- Gebruik alleen MCP-waarden; geen eigen herberekeningen behalve eenvoudige weergave/afronding.

**Invoerkeuze bestaande hypotheek (verplicht expliciet vragen):**
1. Snelle globale berekening → gebruiker geeft een samenvatting (totale schuld, gemiddelde rente/looptijd, eventuele huidige maandlast). Vul één leningdeel met deze totaalwaarden in.
2. Detailberekening → gebruiker levert alle leningdelen (hoofdsom, rente, resterende looptijd, hypotheekvorm). Kopieer ze één-op-één in de leningdelen array.

Vraag altijd: "Wilt u een snelle globale berekening (met een samenvatting van uw hypotheek) of een detailberekening waarbij u alle leningdelen invoert?" en volg de gekozen route.`;

// Leeftijd/geboortedatum beleid:
// - Vraag eindgebruikers altijd: "Wat is uw leeftijd of geboortedatum?"
// - Converteer een opgegeven leeftijd intern naar een geboortedatum in ISO-formaat voor MCP-calls
// - Rapporteer bij een gegeven leeftijd uitsluitend die leeftijd terug aan de gebruiker (nooit de afgeleide geboortedatum)
const baseIntakeProperties = {
  inkomen_aanvrager: {
    type: "number",
    description: "Bruto jaarinkomen hoofdaanvrager in euro's.",
  },
  geboortedatum_aanvrager: {
    type: "string",
    description: "Interne geboortedatum hoofdaanvrager (ISO). Vraag de gebruiker altijd: \"Wat is uw leeftijd of geboortedatum?\" en deel bij een leeftijd alleen die leeftijd terug.",
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
    description: "Optionele interne geboortedatum partner (ISO). Vraag ook hier: \"Wat is uw leeftijd of geboortedatum?\" en houd de afgeleide datum intern.",
  },
  verplichtingen_pm: {
    type: "number",
    description: "Optionele maandelijkse verplichtingen in euro's.",
    default: 0,
  },
};

const baseIntakeRequired = ["inkomen_aanvrager", "geboortedatum_aanvrager", "heeft_partner"];

const aanvragerSchema = {
  type: "object",
  description: 'Gegevens van de (hoofd)aanvrager. Vraag altijd: "Wat is uw leeftijd of geboortedatum?" en gebruik opgegeven leeftijden alleen intern.',
  properties: {
    ...baseIntakeProperties,
    eigen_vermogen: {
      type: "number",
      description: "Beschikbaar eigen geld in euro's (optioneel).",
      default: 0,
    },
  },
  required: [...baseIntakeRequired],
};

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

// Doorstromer invoerbeleid:
// - Laat gebruikers kiezen tussen een snelle globale samenvatting of detailinvoer per leningdeel.
// - Snelle invoer: één "leningdeel" dat totale schuld, gemiddelde rente en resterende looptijd samenvat.
// - Detailinvoer: meerdere leningdelen rechtstreeks overgenomen uit het hypotheekoverzicht.
const bestaandeHypotheekSchema = {
  type: "object",
  description: `Bestaande leningdelen voor doorstromer (detailuitleg: ${OPZET_GUIDE_URI}). VRAAG ALTIJD: "Wilt u een snelle globale berekening (met een samenvatting van uw hypotheek) of een detailberekening waarbij u alle leningdelen invoert?"`,
  properties: {
    leningdelen: {
      type: "array",
      description: "Minimaal één leningdeel. Gebruik één samenvattend leningdeel voor een snelle globale berekening of voeg alle afzonderlijke leningdelen toe voor een nauwkeurige detailberekening.",
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

type ToolResponse = {
  content: Array<{
    type: "text";
    text: string;
  }>;
};

type ToolErrorResponse = ToolResponse & { isError: true };
type ToolHandler = (request: any) => Promise<ToolResponse>;

function successResponse(text: string): ToolResponse {
  return {
    content: [
      {
        type: "text",
        text,
      },
    ],
  };
}

function errorResponse(error: unknown, sessionId?: string): ToolErrorResponse {
  if (error instanceof ValidationError) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(error.toStructured(sessionId), null, 2),
        },
      ],
      isError: true,
    };
  }

  if (error instanceof APIError) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(error.toStructured(sessionId), null, 2),
        },
      ],
      isError: true,
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            code: ErrorCode.UNKNOWN_ERROR,
            message,
            correlation_id: sessionId,
          },
          null,
          2
        ),
      },
    ],
    isError: true,
  };
}

function normalizeSessionIdField(obj: Record<string, unknown>) {
  if (!obj) return;
  if (!obj.session_id && typeof obj.sessionId === 'string' && obj.sessionId.trim().length > 0) {
    obj.session_id = obj.sessionId;
  }
}

function requireArguments<T>(request: any): T {
  if (!request.params?.arguments) {
    throw new ValidationError(
      ErrorCode.INVALID_INPUT,
      'Arguments zijn verplicht',
      'arguments'
    );
  }
  const args = request.params.arguments as Record<string, unknown>;
  normalizeSessionIdField(args);
  return args as unknown as T;
}

function extractSessionId(args: unknown): string | undefined {
  if (!args || typeof args !== 'object') {
    return undefined;
  }
  const record = args as Record<string, unknown>;
  if ('session_id' in record && typeof record.session_id === 'string') {
    return record.session_id;
  }
  if ('sessionId' in record && typeof record.sessionId === 'string') {
    return record.sessionId;
  }
  return undefined;
}

function mapAanvragers(args: {
  inkomen_aanvrager: number;
  geboortedatum_aanvrager: string;
  heeft_partner: boolean;
  inkomen_partner?: number;
  geboortedatum_partner?: string;
  verplichtingen_pm?: number;
}) {
  return {
    inkomen_aanvrager: args.inkomen_aanvrager,
    geboortedatum_aanvrager: args.geboortedatum_aanvrager,
    heeft_partner: args.heeft_partner,
    inkomen_partner: args.inkomen_partner ?? 0,
    geboortedatum_partner: args.geboortedatum_partner ?? null,
    verplichtingen_pm: args.verplichtingen_pm ?? 0,
  };
}

function validateOpzetAanvrager(aanvrager: OpzetAanvrager) {
  validateBaseArguments({
    inkomen_aanvrager: aanvrager.inkomen_aanvrager,
    geboortedatum_aanvrager: aanvrager.geboortedatum_aanvrager,
    heeft_partner: aanvrager.heeft_partner,
    inkomen_partner: aanvrager.inkomen_partner,
    geboortedatum_partner: aanvrager.geboortedatum_partner,
    verplichtingen_pm: aanvrager.verplichtingen_pm,
  } as BaseArguments);
}

function requireOpzetAanvrager(container: { aanvrager?: OpzetAanvrager }): OpzetAanvrager {
  if (!container.aanvrager || typeof container.aanvrager !== 'object') {
    throw new ValidationError(
      ErrorCode.INVALID_INPUT,
      'aanvrager ontbreekt of is onvolledig',
      'aanvrager'
    );
  }
  return container.aanvrager;
}

function mapOpzetAanvrager(aanvrager: OpzetAanvrager) {
  return {
    inkomen_aanvrager: aanvrager.inkomen_aanvrager,
    geboortedatum_aanvrager: aanvrager.geboortedatum_aanvrager,
    heeft_partner: aanvrager.heeft_partner,
    inkomen_partner: aanvrager.inkomen_partner ?? 0,
    geboortedatum_partner: aanvrager.geboortedatum_partner ?? null,
    verplichtingen_pm: aanvrager.verplichtingen_pm ?? 0,
    eigen_vermogen: aanvrager.eigen_vermogen ?? 0,
  };
}

function buildNieuweLeningPayload(raw: any): any | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }

  const payload: Record<string, unknown> = {};

  const looptijdMaanden =
    raw.looptijd_maanden ??
    (typeof raw.looptijd_jaren === 'number' ? raw.looptijd_jaren * 12 : undefined);
  if (looptijdMaanden) {
    payload.looptijd_maanden = looptijdMaanden;
  }

  const rentevastMaanden =
    raw.rentevaste_periode_maanden ??
    (typeof raw.rentevast_periode_jaren === 'number' ? raw.rentevast_periode_jaren * 12 : undefined);
  if (rentevastMaanden) {
    payload.rentevaste_periode_maanden = rentevastMaanden;
  }

  if (raw.rente !== undefined) {
    payload.rente = raw.rente;
  }

  if (raw.hypotheekvorm) {
    payload.hypotheekvorm = raw.hypotheekvorm;
  } else if (raw.type) {
    payload.hypotheekvorm = raw.type;
  }

  if (raw.energielabel) {
    payload.energielabel = normalizeEnergielabel(raw.energielabel);
  }

  if (raw.nhg !== undefined) {
    payload.nhg = raw.nhg;
  }

  if (raw.ltv !== undefined) {
    let ltvValue: number | undefined;
    if (typeof raw.ltv === 'string') {
      const parsed = parseFloat(raw.ltv.replace('%', ''));
      ltvValue = Number.isFinite(parsed) ? parsed / 100 : undefined;
    } else if (typeof raw.ltv === 'number') {
      ltvValue = raw.ltv;
    }
    if (ltvValue !== undefined) {
      payload.ltv = ltvValue;
    }
  }

  if (Array.isArray(raw.renteklassen) && raw.renteklassen.length > 0) {
    payload.renteklassen = raw.renteklassen;
  }

  return Object.keys(payload).length > 0 ? payload : undefined;
}

async function handleBerekenStarter(request: any): Promise<ToolResponse> {
  const args = requireArguments<BaseArguments>(request);
  const logger = createLogger(args.session_id);

  validateBaseArguments(args);
  enforceRateLimit(args.session_id);

  const payload: any = {
    aanvragers: mapAanvragers(args),
  };

  if (args.session_id) {
    payload.session_id = args.session_id;
  }

  const apiClient = getApiClient();
  const { data } = await apiClient.post(
    REPLIT_API_URL_BEREKENEN,
    payload,
    { correlationId: args.session_id }
  );

  logger.info('Toolcall succesvol', { tool: 'bereken_hypotheek_starter' });
  return successResponse(formatResponse(data, "bereken_hypotheek_starter"));
}

async function handleBerekenDoorstromer(request: any): Promise<ToolResponse> {
  const rawArgs = requireArguments<DoorstromerArguments>(request);
  const normalizedArgs = normalizeDoorstromerArgs(rawArgs) as DoorstromerArguments;
  const logger = createLogger(normalizedArgs.session_id);

  validateDoorstromerArguments(normalizedArgs);
  enforceRateLimit(normalizedArgs.session_id);

  const payload: any = {
    aanvragers: mapAanvragers(normalizedArgs),
    bestaande_hypotheek: {
      waarde_huidige_woning: normalizedArgs.waarde_huidige_woning,
      leningdelen: normalizedArgs.bestaande_hypotheek.leningdelen,
    },
  };

  if (normalizedArgs.session_id) {
    payload.session_id = normalizedArgs.session_id;
  }

  const apiClient = getApiClient();
  const { data } = await apiClient.post(
    REPLIT_API_URL_BEREKENEN,
    payload,
    { correlationId: normalizedArgs.session_id }
  );

  logger.info('Toolcall succesvol', { tool: 'bereken_hypotheek_doorstromer' });
  return successResponse(formatResponse(data, "bereken_hypotheek_doorstromer"));
}

async function handleBerekenUitgebreid(request: any): Promise<ToolResponse> {
  const rawArgs = requireArguments<UitgebreidArguments>(request);
  const normalizedArgs = rawArgs.is_doorstromer
    ? (normalizeDoorstromerArgs(rawArgs) as UitgebreidArguments)
    : rawArgs;
  const logger = createLogger(normalizedArgs.session_id);

  validateBaseArguments(normalizedArgs as BaseArguments);
  if (normalizedArgs.is_doorstromer && normalizedArgs.bestaande_hypotheek) {
    validateBestaandeHypotheek(normalizedArgs.bestaande_hypotheek);
  }

  enforceRateLimit(normalizedArgs.session_id);

  const payload: any = {
    aanvragers: mapAanvragers(normalizedArgs),
  };

  if (normalizedArgs.is_doorstromer && normalizedArgs.waarde_huidige_woning && normalizedArgs.bestaande_hypotheek) {
    payload.bestaande_hypotheek = {
      waarde_huidige_woning: normalizedArgs.waarde_huidige_woning,
      leningdelen: normalizedArgs.bestaande_hypotheek.leningdelen,
    };
  }

  const maatwerk = (normalizedArgs as any).nieuwe_hypotheek ?? (normalizedArgs as any).nieuwe_lening;
  const nieuweLening = buildNieuweLeningPayload(maatwerk);
  if (nieuweLening) {
    payload.nieuwe_lening = nieuweLening;
  }

  if (normalizedArgs.session_id) {
    payload.session_id = normalizedArgs.session_id;
  }

  const apiClient = getApiClient();
  const { data } = await apiClient.post(
    REPLIT_API_URL_BEREKENEN,
    payload,
    { correlationId: normalizedArgs.session_id }
  );

  logger.info('Toolcall succesvol', { tool: 'bereken_hypotheek_uitgebreid' });
  return successResponse(formatResponse(data, "bereken_hypotheek_uitgebreid"));
}

async function handleActueleRentes(request: any): Promise<ToolResponse> {
  const sessionId = extractSessionId(request.params?.arguments);
  if (sessionId) {
    enforceRateLimit(sessionId);
  }

  const apiClient = getApiClient();
  const { data } = await apiClient.get(REPLIT_API_URL_RENTES, { correlationId: sessionId });
  return successResponse(JSON.stringify(data, null, 2));
}

async function handleOpzetStarter(request: any): Promise<ToolResponse> {
  const rawArgs = requireArguments<OpzetStarterArguments>(request);
  const normalizedArgs = normalizeOpzetAanvragerShape(rawArgs) as OpzetStarterArguments;
  const logger = createLogger(normalizedArgs.session_id);

  const aanvrager = requireOpzetAanvrager(normalizedArgs);
  validateOpzetAanvrager(aanvrager);
  enforceRateLimit(normalizedArgs.session_id);

  const payload: any = {
    aanvrager: mapOpzetAanvrager(aanvrager),
    nieuwe_woning: {
      waarde_woning: normalizedArgs.nieuwe_woning.waarde_woning,
      bedrag_verbouwen: normalizedArgs.nieuwe_woning.bedrag_verbouwen ?? 0,
      bedrag_verduurzamen: normalizedArgs.nieuwe_woning.bedrag_verduurzamen ?? 0,
      kosten_percentage: normalizedArgs.nieuwe_woning.kosten_percentage ?? 0.05,
      energielabel: normalizeEnergielabel(normalizedArgs.nieuwe_woning.energielabel || ''),
    },
  };

  if (normalizedArgs.session_id) {
    payload.session_id = normalizedArgs.session_id;
  }

  const apiClient = getApiClient();
  const { data } = await apiClient.post(
    REPLIT_API_URL_OPZET,
    payload,
    { correlationId: normalizedArgs.session_id }
  );

  logger.info('Toolcall succesvol', { tool: 'opzet_hypotheek_starter' });
  return successResponse(formatResponse(data, "opzet_hypotheek_starter"));
}

async function handleOpzetDoorstromer(request: any): Promise<ToolResponse> {
  const rawArgs = requireArguments<OpzetDoorstromerArguments>(request);
  const normalizedArgs = normalizeOpzetDoorstromerArgs(rawArgs) as OpzetDoorstromerArguments;
  const logger = createLogger(normalizedArgs.session_id);

  const aanvrager = requireOpzetAanvrager(normalizedArgs);
  validateOpzetAanvrager(aanvrager);
  validateBestaandeHypotheek(normalizedArgs.bestaande_hypotheek);
  enforceRateLimit(normalizedArgs.session_id);

  const payload: any = {
    aanvrager: mapOpzetAanvrager(aanvrager),
    bestaande_hypotheek: {
      waarde_huidige_woning: normalizedArgs.waarde_huidige_woning,
      leningdelen: normalizedArgs.bestaande_hypotheek.leningdelen,
    },
    nieuwe_woning: {
      waarde_woning: normalizedArgs.nieuwe_woning.waarde_woning,
      bedrag_verbouwen: normalizedArgs.nieuwe_woning.bedrag_verbouwen ?? 0,
      bedrag_verduurzamen: normalizedArgs.nieuwe_woning.bedrag_verduurzamen ?? 0,
      kosten_percentage: normalizedArgs.nieuwe_woning.kosten_percentage ?? 0.05,
      energielabel: normalizeEnergielabel(normalizedArgs.nieuwe_woning.energielabel || ''),
    },
  };

  if (normalizedArgs.session_id) {
    payload.session_id = normalizedArgs.session_id;
  }

  const apiClient = getApiClient();
  const { data } = await apiClient.post(
    REPLIT_API_URL_OPZET,
    payload,
    { correlationId: normalizedArgs.session_id }
  );

  logger.info('Toolcall succesvol', { tool: 'opzet_hypotheek_doorstromer' });
  return successResponse(formatResponse(data, "opzet_hypotheek_doorstromer"));
}

async function handleOpzetUitgebreid(request: any): Promise<ToolResponse> {
  const rawArgs = requireArguments<OpzetUitgebreidArguments>(request);
  const normalizedArgs = rawArgs.is_doorstromer
    ? (normalizeOpzetDoorstromerArgs(rawArgs) as OpzetUitgebreidArguments)
    : (normalizeOpzetAanvragerShape(rawArgs) as OpzetUitgebreidArguments);
  const logger = createLogger(normalizedArgs.session_id);

  const aanvrager = requireOpzetAanvrager(normalizedArgs);
  validateOpzetAanvrager(aanvrager);
  if (normalizedArgs.is_doorstromer && normalizedArgs.bestaande_hypotheek) {
    validateBestaandeHypotheek(normalizedArgs.bestaande_hypotheek);
  }
  enforceRateLimit(normalizedArgs.session_id);

  const payload: any = {
    aanvrager: mapOpzetAanvrager(aanvrager),
    nieuwe_woning: {
      waarde_woning: normalizedArgs.nieuwe_woning.waarde_woning,
      bedrag_verbouwen: normalizedArgs.nieuwe_woning.bedrag_verbouwen ?? 0,
      bedrag_verduurzamen: normalizedArgs.nieuwe_woning.bedrag_verduurzamen ?? 0,
      kosten_percentage: normalizedArgs.nieuwe_woning.kosten_percentage ?? 0.05,
      energielabel: normalizeEnergielabel(normalizedArgs.nieuwe_woning.energielabel || ''),
    },
  };

  if (normalizedArgs.is_doorstromer && normalizedArgs.waarde_huidige_woning && normalizedArgs.bestaande_hypotheek) {
    payload.bestaande_hypotheek = {
      waarde_huidige_woning: normalizedArgs.waarde_huidige_woning,
      leningdelen: normalizedArgs.bestaande_hypotheek.leningdelen,
    };
  }

  const maatwerk = (normalizedArgs as any).nieuwe_hypotheek ?? (normalizedArgs as any).nieuwe_lening;
  const nieuweLening = buildNieuweLeningPayload(maatwerk);
  if (nieuweLening) {
    payload.nieuwe_lening = nieuweLening;
  }

  if (normalizedArgs.session_id) {
    payload.session_id = normalizedArgs.session_id;
  }

  const apiClient = getApiClient();
  const { data } = await apiClient.post(
    REPLIT_API_URL_OPZET,
    payload,
    { correlationId: normalizedArgs.session_id }
  );

  logger.info('Toolcall succesvol', { tool: 'opzet_hypotheek_uitgebreid' });
  return successResponse(formatResponse(data, "opzet_hypotheek_uitgebreid"));
}

const TOOL_HANDLERS: Record<string, ToolHandler> = {
  bereken_hypotheek_starter: handleBerekenStarter,
  bereken_hypotheek_doorstromer: handleBerekenDoorstromer,
  bereken_hypotheek_uitgebreid: handleBerekenUitgebreid,
  haal_actuele_rentes_op: handleActueleRentes,
  opzet_hypotheek_starter: handleOpzetStarter,
  opzet_hypotheek_doorstromer: handleOpzetDoorstromer,
  opzet_hypotheek_uitgebreid: handleOpzetUitgebreid,
};

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
        description: `Berekent de maximale hypotheek voor doorstromers (standaard variant). Alle regels uit het doorstromerbeleid gelden ook voor de uitgebreide tool:
${DOORSTROMER_OUTPUT_GUIDANCE}`,
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
        description: `Gebruik dit voor maatwerk (rente, looptijd, energielabel). Output: maatwerk leenbedrag met maandlast en NHG-inschatting. Zodra u dit tool voor een doorstromer inzet (is_doorstromer=true of bestaande_hypotheek ingevuld), gelden dezelfde regels als bij de standaard doorstromer-tool:
${DOORSTROMER_OUTPUT_GUIDANCE}`,
        inputSchema: {
          type: "object",
          description: `Alle velden zijn optioneel bovenop de basisintake; zie ${OPZET_GUIDE_URI} voor velduitleg en defaults.`,
          properties: {
            ...baseIntakeProperties,
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
            aanvrager: aanvragerSchema,
            nieuwe_woning: {
              ...nieuweWoningSchema,
            },
            session_id: {
              type: "string",
              description: "Optioneel sessie-ID vanuit n8n (voor logging).",
            },
          },
          required: [
            "aanvrager",
            "nieuwe_woning",
          ],
        },
      },
      // Tool 6: Opzet hypotheek - Doorstromers
      {
        name: "opzet_hypotheek_doorstromer",
        description: `Berekent de hypotheekopzet voor doorstromers met bestaande woning. Output: benodigd bedrag, financiering per component en maandlasten (bestaand versus nieuw).

**Invoerbeleid bestaande hypotheek (verplicht expliciet vragen):**
- Stel altijd de vraag: "Wilt u een snelle globale berekening (met een samenvatting van uw hypotheek) of een detailberekening waarbij u alle leningdelen invoert?"
- Bij snelle globale berekening: laat de gebruiker één samenvattende set waarden geven (totale schuld, gemiddelde rente, resterende looptijd, optioneel huidige maandlast) en vul hiermee één leningdeel.
- Bij detailberekening: laat de gebruiker alle leningdelen kopiëren/plakken (hoofdsom, rente, looptijd, rentevast, hypotheekvorm) en vul de leningdelen-array één-op-één.`,
        inputSchema: {
          type: "object",
          description: `Gebruik basisintake, huidige woning en bestaande leningdelen; zie ${OPZET_GUIDE_URI} voor detailvelden en defaults.`,
          properties: {
            aanvrager: aanvragerSchema,
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
            "aanvrager",
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
  
  Gebruik deze tool alleen wanneer afwijkende parameters nodig zijn; anders de specifieke starter/doorstromer varianten gebruiken.

**Doorstromer invoerbeleid:**
- Vraag óók hier: "Wilt u een snelle globale berekening (met een samenvatting van uw hypotheek) of een detailberekening waarbij u alle leningdelen invoert?"
- Snelle route → één samenvattend leningdeel (totale schuld, gemiddelde rente/looptijd, optionele maandlast).
- Detailroute → volledige lijst leningdelen met de exacte waarden per deel. Kopieer deze rechtstreeks in de leningdelen array.`,
        inputSchema: {
          type: "object",
          properties: {
            aanvrager: aanvragerSchema,
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
            "aanvrager",
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

const DOORSTROMER_BLOCK_WIDTH = 41;

function normalizeResultList(resultaatField: any): any[] {
  if (!resultaatField) {
    return [];
  }
  if (Array.isArray(resultaatField)) {
    return resultaatField;
  }
  return [resultaatField];
}

function sanitizeNumber(value: any): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const cleaned = value
      .replace(/[€\s]/g, "")
      .replace(/\./g, "")
      .replace(",", ".");
    const parsed = Number(cleaned);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

function formatEuro(
  value: number | null,
  options: Intl.NumberFormatOptions = { minimumFractionDigits: 0, maximumFractionDigits: 0 }
): string {
  if (value === null) {
    return "n.v.t.";
  }
  return `€ ${value.toLocaleString("nl-NL", options)}`;
}

function renderDoorstromerBudgetBlock(resultaat: any): string | null {
  if (!resultaat || typeof resultaat !== "object") {
    return null;
  }

  const budget = sanitizeNumber(
    resultaat.max_woningbudget ??
      resultaat.max_woning_budget ??
      resultaat.maximaal_woningbudget ??
      resultaat.woningbudget ??
      resultaat.maximaal_bedrag
  );
  if (budget === null) {
    return null;
  }

  const overwaarde = sanitizeNumber(
    resultaat.overwaarde_bedrag ??
      resultaat.overwaarde ??
      resultaat.maximaal_woningbudget_onderdelen?.overwaarde_huidige_woning ??
      resultaat.Financiering?.Overwaarde ??
      resultaat.bestaande_situatie?.overwaarde
  );
  const huidigeSchuld = sanitizeNumber(
    resultaat.huidige_hypotheek_schuld ??
      resultaat.maximaal_woningbudget_onderdelen?.Bestaande_hypotheek_mee_te_nemen ??
      resultaat.bestaande_situatie?.totale_restschuld ??
      resultaat.Financiering?.Bestaande_hypotheek?.Totaal_schuld
  );
  const extraLeencapaciteit = sanitizeNumber(
    resultaat.extra_leencapaciteit ??
      resultaat.extra_leencapaciteit_bedrag ??
      resultaat.maximaal_woningbudget_onderdelen?.max_extra_lening
  );
  const maandlastNu = sanitizeNumber(
    resultaat.maandlast_nu ??
      resultaat.bestaande_situatie?.huidige_maandlast ??
      resultaat.Maandlasten?.Bestaande_hypotheek ??
      resultaat.Maandlasten?.Bestaande_hypotheek_maandlast
  );
  const maandlastStraks = sanitizeNumber(
    resultaat.maandlast_straks ??
      resultaat.Maandlasten?.Totaal ??
      resultaat.Maandlasten?.Totaal_maandlast ??
      resultaat.bruto_maandlasten_nieuwe_lening
  );
  const maandlastVerschil = sanitizeNumber(
    resultaat.verschil_maandlast ??
      resultaat.Maandlasten?.Verschil ??
      resultaat.Maandlasten?.Verschil_maandlast
  );

  const horizontal = (edge: "top" | "mid" | "bottom") =>
    `${edge === "top" ? "┌" : edge === "bottom" ? "└" : "├"}${"─".repeat(
      DOORSTROMER_BLOCK_WIDTH
    )}${edge === "top" ? "┐" : edge === "bottom" ? "┘" : "┤"}`;
  const emptyLine = () => `│${" ".repeat(DOORSTROMER_BLOCK_WIDTH)}│`;
  const line = (text: string) => {
    const trimmed = text.length > DOORSTROMER_BLOCK_WIDTH ? text.slice(0, DOORSTROMER_BLOCK_WIDTH) : text;
    return `│${trimmed.padEnd(DOORSTROMER_BLOCK_WIDTH, " ")}│`;
  };
  const monthly = (value: number | null) =>
    value === null ? "n.v.t." : `${formatEuro(value, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} / maand`;
  const diffText =
    maandlastVerschil === null
      ? "n.v.t."
      : `${maandlastVerschil > 0 ? "+" : maandlastVerschil < 0 ? "-" : ""}${formatEuro(
          Math.abs(maandlastVerschil),
          { minimumFractionDigits: 0, maximumFractionDigits: 0 }
        )} / maand`;
  const budgetLine = formatEuro(budget, { minimumFractionDigits: 0, maximumFractionDigits: 0 }).padStart(20, " ");

  return [
    horizontal("top"),
    line("  🎯 Uw woningbudget"),
    horizontal("mid"),
    line("  U kunt op zoek naar een woning tot:"),
    emptyLine(),
    line(`         ${budgetLine}`),
    line("         ─────────"),
    emptyLine(),
    line("  💡 Dit bedrag bestaat uit:"),
    line(`  • Overwaarde huidige woning:  ${formatEuro(overwaarde)}`),
    line(`  • Huidige hypotheekschuld:    ${formatEuro(huidigeSchuld)}`),
    line(`  • Extra leencapaciteit:       ${formatEuro(extraLeencapaciteit)}`),
    horizontal("mid"),
    line("  📊 Uw nieuwe maandlast"),
    horizontal("mid"),
    line(`  Nu:      ${monthly(maandlastNu)}`),
    line(`  Straks:  ${monthly(maandlastStraks)}`),
    line("  ------------------------------"),
    line(`  Verschil: ${diffText}`),
    horizontal("bottom"),
  ].join("\n");
}

function renderOpzetSummary(resultaat: any, isDoorstromer: boolean): string {
  const benodigd = resultaat?.Benodigd_bedrag ?? {};
  const financiering = resultaat?.Financiering ?? {};
  const maandlasten = resultaat?.Maandlasten ?? {};

  const format0 = (value: number | null) =>
    formatEuro(value, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const monthlyText = (value: number | null) =>
    value === null
      ? 'n.v.t.'
      : `${formatEuro(value, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} / maand`;

  const koopprijs = sanitizeNumber(benodigd.Woning_koopsom);
  const verbouwing = sanitizeNumber(benodigd.Verbouwingskosten_meerwerk);
  const verduurzaming = sanitizeNumber(benodigd.Verduurzamingskosten);
  const kosten = sanitizeNumber(benodigd.Kosten);
  const totaalBenodigd = sanitizeNumber(
    benodigd.Totaal_benodigd ??
      ((koopprijs || 0) + (verbouwing || 0) + (verduurzaming || 0) + (kosten || 0))
  );

  const finBestaand = sanitizeNumber(
    financiering.Bestaande_hypotheek_mee_te_nemen ??
      financiering.Bestaande_hypotheek?.Totaal_schuld
  );
  const finNieuwe = sanitizeNumber(financiering.Nieuwe_hypotheek ?? financiering.Hypotheek);
  const finOverwaarde = sanitizeNumber(financiering.Overwaarde);
  const finEigen = sanitizeNumber(financiering.Eigen_geld);
  const finTotaal = sanitizeNumber(financiering.Totaal_financiering);

  const maandNu = sanitizeNumber(
    maandlasten.Bestaande_hypotheek ?? maandlasten.Bestaande_hypotheek_maandlast
  );
  const maandStraks = sanitizeNumber(
    maandlasten.Totaal ??
      maandlasten.Totaal_maandlast ??
      maandlasten.Nieuwe_hypotheek_maandlast ??
      resultaat.bruto_maandlasten_nieuwe_lening
  );
  const maandVerschil = sanitizeNumber(
    maandlasten.Verschil ??
      maandlasten.Verschil_maandlast ??
      (maandStraks !== null && maandNu !== null ? maandStraks - maandNu : null)
  );

  const diffText =
    maandVerschil === null
      ? 'n.v.t.'
      : `${maandVerschil > 0 ? '+' : maandVerschil < 0 ? '-' : ''}${formatEuro(Math.abs(maandVerschil), {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        })} / maand`;

  const lines: string[] = [];
  lines.push(`💰 Vraagprijs woning: ${format0(koopprijs)}`);
  lines.push('═══════════════════════════════════');
  lines.push('');
  lines.push('BENODIGD BEDRAG:');
  lines.push(`├─ Koopprijs: ${format0(koopprijs)}`);
  if (kosten !== null && kosten !== 0) {
    lines.push(`├─ Kosten: ${format0(kosten)}`);
  }
  if (verbouwing !== null && verbouwing !== 0) {
    lines.push(`├─ Verbouwing: ${format0(verbouwing)}`);
  }
  if (verduurzaming !== null && verduurzaming !== 0) {
    lines.push(`├─ Verduurzaming: ${format0(verduurzaming)}`);
  }
  lines.push(`└─ TOTAAL NODIG: ${format0(totaalBenodigd)}`);

  lines.push('');
  lines.push('FINANCIERING:');
  if (isDoorstromer && finBestaand !== null) {
    lines.push(`├─ Bestaande hypotheek: ${format0(finBestaand)}`);
  }
  if (finNieuwe !== null) {
    lines.push(`├─ Nieuwe hypotheek: ${format0(finNieuwe)}`);
  }
  if (finOverwaarde !== null) {
    lines.push(`├─ Overwaarde: ${format0(finOverwaarde)}`);
  }
  if (finEigen !== null) {
    lines.push(`├─ Eigen geld: ${format0(finEigen)}`);
  }
  lines.push(`└─ Totaal: ${format0(finTotaal)}`);

  lines.push('');
  lines.push('📊 Uw nieuwe maandlast');
  lines.push(`Nu:      ${monthlyText(maandNu)}`);
  lines.push(`Straks:  ${monthlyText(maandStraks)}`);
  lines.push('──────────────────────────────');
  lines.push(`Verschil: ${diffText}`);

  return lines.join('\n');
}

// Functie om response mooi te formatteren
function formatResponse(data: any, toolName: string): string {
  let output = "";
  const resultaten = normalizeResultList(data?.resultaat);

  if (toolName === "bereken_hypotheek_starter") {
    output += "🏠 **HYPOTHEEKBEREKENING VOOR STARTER**\n\n";
    
    if (resultaten.length > 0) {
      resultaten.forEach((resultaat: any, index: number) => {
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
    
    if (resultaten.length > 0) {
      resultaten.forEach((resultaat: any, index: number) => {
        const scenario = resultaat.resultaat_omschrijving || `Scenario ${index + 1}`;
        const hypotheekData = resultaat.gebruikte_hypotheekgegevens?.opzet_nieuwe_hypotheek?.[0];

        output += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        output += `📊 **${scenario}**\n`;
        output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

        const doorstromerBlock = renderDoorstromerBudgetBlock(resultaat);
        if (doorstromerBlock) {
          output += `${doorstromerBlock}\n\n`;
          const aanvullende: string[] = [];
          if (hypotheekData) {
            aanvullende.push(`🏦 Hypotheekvorm: ${hypotheekData.hypotheekvorm || 'N/A'}`);
            if (hypotheekData.looptijd_maanden) {
              aanvullende.push(`⏱️ Looptijd: ${(hypotheekData.looptijd_maanden / 12).toFixed(0)} jaar`);
            }
            if (hypotheekData.rentevastperiode_maanden) {
              aanvullende.push(`🔒 Rentevaste periode: ${(hypotheekData.rentevastperiode_maanden / 12).toFixed(0)} jaar`);
            }
            if (hypotheekData.rente) {
              aanvullende.push(`📊 Rentepercentage: ${(hypotheekData.rente * 100).toFixed(2)}%`);
            }
          }
          if (aanvullende.length > 0) {
            output += `**Aanvullende details:**\n${aanvullende.map((item) => `• ${item}`).join('\n')}\n\n`;
          }
        } else {
          output += `💰 **Maximale nieuwe hypotheek:** €${resultaat.maximaal_bedrag?.toLocaleString('nl-NL') || 'N/A'}\n`;
          output += `📈 **Nieuwe maandlast:** €${resultaat.bruto_maandlasten_nieuwe_lening?.toLocaleString('nl-NL', {minimumFractionDigits: 2, maximumFractionDigits: 2}) || 'N/A'}\n`;
          output += `💵 **Overwaarde:** €${resultaat.overwaarde?.toLocaleString('nl-NL') || 'N/A'}\n`;

          if (hypotheekData) {
            output += `🏦 **Hypotheekvorm:** ${hypotheekData.hypotheekvorm || 'N/A'}\n`;
            output += `⏱️ **Looptijd:** ${hypotheekData.looptijd_maanden ? (hypotheekData.looptijd_maanden / 12).toFixed(0) + ' jaar' : 'N/A'}\n`;
            output += `🔒 **Rentevaste periode:** ${hypotheekData.rentevastperiode_maanden ? (hypotheekData.rentevastperiode_maanden / 12).toFixed(0) + ' jaar' : 'N/A'}\n`;
            output += `📊 **Rentepercentage:** ${hypotheekData.rente ? (hypotheekData.rente * 100).toFixed(2) + '%' : 'N/A'}\n`;
          }
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

    if (data.extra_informatie?.disclaimers?.length) {
      output += `ℹ️ **Disclaimers:**\n${data.extra_informatie.disclaimers.map((line: string) => `• ${line}`).join('\n')}\n\n`;
    }
    if (data.extra_informatie?.energielabels) {
      output += `💡 ${data.extra_informatie.energielabels}\n\n`;
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
    
    if (resultaten.length > 0) {
      resultaten.forEach((resultaat: any, index: number) => {
        const scenario = resultaat.resultaat_omschrijving || `Scenario ${index + 1}`;
        const hypotheekData = resultaat.gebruikte_hypotheekgegevens?.opzet_nieuwe_hypotheek?.[0];
        const doorstromerBlock = renderDoorstromerBudgetBlock(resultaat);
        
        output += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
        output += `📊 **${scenario}**\n`;
        output += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

        if (doorstromerBlock) {
          output += `${doorstromerBlock}\n\n`;
        }

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
    if (data.extra_informatie?.disclaimers?.length) {
      output += `ℹ️ **Disclaimers:**\n${data.extra_informatie.disclaimers.map((line: string) => `• ${line}`).join('\n')}\n\n`;
    }
    if (data.extra_informatie?.energielabels) {
      output += `💡 ${data.extra_informatie.energielabels}\n\n`;
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

    if (resultaten.length > 0) {
      resultaten.forEach((resultaat: any, index: number) => {
        if (resultaten.length > 1) {
          const scenario = resultaat.resultaat_omschrijving || `Scenario ${index + 1}`;
          output += `📊 **${scenario}**\n`;
        }
        output += `${renderOpzetSummary(resultaat, isDoorstromer)}\n\n`;
      });
    } else if (data.resultaat) {
      output += `${renderOpzetSummary(data.resultaat, isDoorstromer)}\n\n`;
    } else {
      output += 'Geen resultaat ontvangen van de API.\n\n';
    }

    if (data.extra_informatie?.disclaimers?.length) {
      output += `⚠️ **DISCLAIMERS**\n`;
      output += `${data.extra_informatie.disclaimers.map((line: string) => `• ${line}`).join('\n')}\n\n`;
    }
    if (data.extra_informatie?.energielabels) {
      output += `💡 ${data.extra_informatie.energielabels}\n\n`;
    }
  }


  return output;
}

// Handler voor tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const startTime = Date.now();
  const toolName = request.params?.name ?? 'unknown_tool';
  const handler = TOOL_HANDLERS[toolName];
  const sessionId = extractSessionId(request.params?.arguments);

  if (!handler) {
    const error = new ValidationError(ErrorCode.INVALID_INPUT, `Onbekende tool: ${toolName}`, 'tool');
    recordToolCall(toolName, Date.now() - startTime, false);
    try { recordValidationError(error.code); } catch { /* ignore metrics failure */ }
    return errorResponse(error, sessionId);
  }

  try {
    const response = await handler(request);
    recordToolCall(toolName, Date.now() - startTime, true);
    return response;
  } catch (error) {
    recordToolCall(toolName, Date.now() - startTime, false);
    if (error instanceof ValidationError) {
      try { recordValidationError(error.code); } catch { /* ignore metrics failure */ }
    }
    return errorResponse(error, sessionId);
  }
});

// Start de server met stdio transport
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Hypotheek MCP Server v${config.serverVersion} klaar voor gebruik (stdio).`);
  console.error(`Beschikbare tools: ${Object.keys(TOOL_HANDLERS).join(', ')}`);
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
