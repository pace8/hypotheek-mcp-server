import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import {
  McpError,
  ErrorCode as McpErrorCode,
  ResourceSchema,
  TextResourceContentsSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { ErrorCode } from '../types/index.js';

const MARKDOWN_MIME = 'text/markdown; charset=utf-8; lang=nl-NL';
const require = createRequire(import.meta.url);
const { version: packageVersion } = require('../../package.json') as { version: string };

type Resource = z.infer<typeof ResourceSchema>;
type TextResourceContents = z.infer<typeof TextResourceContentsSchema>;

const projectRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));

export interface ErrorGuideEntry {
  title: string;
  typicalCause: string;
  resolutionSteps: string[];
  badExample: string;
  goodExample: string;
}

// Leeftijd/geboortedatum beleid: vraag gebruikers altijd "Wat is uw leeftijd of geboortedatum?", reken een leeftijd intern om naar ISO-formaat en deel die afgeleide datum nooit terug.
export const ERROR_GUIDE: Record<ErrorCode, ErrorGuideEntry> = {
  [ErrorCode.INVALID_INPUT]: {
    title: 'Algemene invoerfout',
    typicalCause: 'Ontbrekende verplichte velden of combinaties die niet door validatie komen.',
    resolutionSteps: [
      'Herlees de foutmelding en identificeer welk veld of combinatie ontbreekt.',
      'Vraag de gebruiker om alle verplichte velden opnieuw te bevestigen.',
      'Controleer of er geen onbekende of extra velden worden meegestuurd.'
    ],
    badExample: '{ "heeft_partner": true }',
    goodExample: '{ "heeft_partner": false, "geboortedatum": "1990-05-15", "bruto_inkomen": 42000 }'
  },
  [ErrorCode.INVALID_DATE_FORMAT]: {
    title: 'Onjuist datumformaat',
    typicalCause: 'Datum is aangeleverd in DD-MM-YYYY of natuurlijke taal in plaats van ISO-formaat.',
    resolutionSteps: [
      'Leg uit dat de ontvangen datum ongeldig is en stel opnieuw de vraag: "Wat is uw leeftijd of geboortedatum?"',
      'Accepteer een leeftijd als antwoord en reken die intern om naar een ISO-geboortedatum zonder dit te benoemen richting de gebruiker.',
      'Vraag alleen verduidelijking wanneer een onmogelijk geboortejaar is opgegeven en noem daarbij geen technische datumformaten.'
    ],
    badExample: '"15-05-1990"',
    goodExample: '"1990-05-15"'
  },
  [ErrorCode.AGE_OUT_OF_RANGE]: {
    title: 'Leeftijd buiten bandbreedte',
    typicalCause: 'Leeftijd lager dan 18 jaar of ouder dan 75 jaar, of een geboortedatum in de toekomst.',
    resolutionSteps: [
      'Leg uit dat hypotheekberekeningen alleen mogelijk zijn tussen 18 en 75 jaar.',
      'Vraag de gebruiker opnieuw: "Wat is uw leeftijd of geboortedatum?" en controleer of de waarde logisch is.',
      'Bij fouten door een incorrecte datum (bijv. toekomstig jaar): vraag om bevestiging of correctie zonder zelf een geboortedatum te raden.'
    ],
    badExample: '"Ik ben 16 jaar, reken maar met 2009-11-04."',
    goodExample: '"Ik ben 28 jaar" of "Mijn geboortedatum is 1997-11-04"'
  },
  [ErrorCode.INCOME_OUT_OF_RANGE]: {
    title: 'Inkomen buiten bandbreedte',
    typicalCause: 'Bruto jaarinkomen is negatief, onrealistisch hoog of ingevoerd in honderden i.p.v. euro’s.',
    resolutionSteps: [
      'Vraag het bruto jaarinkomen opnieuw en benadruk dat het bedrag in euro’s per jaar moet zijn.',
      'Noem de onderste (0) en bovenste (1.000.000) grenzen duidelijk.',
      'Indien er een partner is: check of beide inkomens gescheiden zijn opgegeven.'
    ],
    badExample: 'inkomen: -500',
    goodExample: 'inkomen: 42000'
  },
  [ErrorCode.RENTEVAST_EXCEEDS_LOOPTIJD]: {
    title: 'Rentevaste periode langer dan looptijd',
    typicalCause: 'Rentevast-periode in maanden is groter dan de resterende looptijd in maanden.',
    resolutionSteps: [
      'Leg uit dat de rentevasteperiode altijd korter of gelijk moet zijn aan de looptijd.',
      'Vraag naar de resterende looptijd en gebruik die als bovengrens.',
      'Normaliseer invoer naar maanden (bijv. 10 jaar = 120 maanden).'
    ],
    badExample: 'looptijd: 120, rentevast: 180',
    goodExample: 'looptijd: 240, rentevast: 120'
  },
  [ErrorCode.INVALID_HYPOTHEEKVORM]: {
    title: 'Onbekende hypotheekvorm',
    typicalCause: 'Hypotheekvorm bevat accenten of varianten die niet ondersteund zijn.',
    resolutionSteps: [
      'Noem de drie toegestane waarden en hun schrijfwijze: annuiteit, lineair, aflossingsvrij.',
      'Verwijder accenten of kapitalisatie voor je het veld invult.',
      'Bevestig met de gebruiker welke vorm bedoeld is voordat je normaliseert.'
    ],
    badExample: '"Annuïteit"',
    goodExample: '"annuiteit"'
  },
  [ErrorCode.INVALID_ENERGIELABEL]: {
    title: 'Energielabel onbekend',
    typicalCause: 'Label is in lowercase, mist plus-tekens of bevat tekst tussen haakjes die niet ondersteund is.',
    resolutionSteps: [
      'Som de toegestane waarden op en benadruk hoofdletters.',
      'Voeg ontbrekende plus-tekens toe of verwijder extra tekst behalve bij "A++++ (met garantie)".',
      'Vraag desnoods naar de letter én of er plus-tekens bij horen.'
    ],
    badExample: '"a+++"',
    goodExample: '"A+++"'
  },
  [ErrorCode.PARTNER_DATA_INCOMPLETE]: {
    title: 'Partnergegevens onvolledig',
    typicalCause: 'heeft_partner staat op true maar inkomen of geboortedatum van partner ontbreekt.',
    resolutionSteps: [
      'Vraag expliciet naar het bruto partnerinkomen in euro per jaar.',
      'Stel dezelfde vraag voor de partner: "Wat is de leeftijd of geboortedatum van uw partner?" en reken een leeftijd intern om.',
      'Indien geen partner meedoet: zet heeft_partner op false en verwijder partner velden.'
    ],
    badExample: 'heeft_partner: true, inkomen_partner: ontbreekt',
    goodExample: 'heeft_partner: true, inkomen_partner: 38000, geboortedatum_partner: "1994-09-12"'
  },
  [ErrorCode.TOO_MANY_LENINGDELEN]: {
    title: 'Te veel leningdelen aangeleverd',
    typicalCause: 'Meer dan 10 leningdelen in bestaande hypotheek of duplicaten.',
    resolutionSteps: [
      'Beperk het aantal leningdelen tot maximaal 10.',
      'Combineer delen die identieke rente en looptijd hebben tot één aggregaat.',
      'Vraag welke delen essentieel zijn voor de berekening en verwijder rest.'
    ],
    badExample: 'leningdelen: 14 items',
    goodExample: 'leningdelen: 3 items (samengevoegd per type)'
  },
  [ErrorCode.WONING_VALUE_OUT_OF_RANGE]: {
    title: 'Woningwaarde buiten bandbreedte',
    typicalCause: 'Woningwaarde lager dan €50.000 of hoger dan €5.000.000 of opgegeven in duizenden.',
    resolutionSteps: [
      'Vraag de exacte woningwaarde in euro’s (zonder punten of komma’s voor duizendtallen).',
      'Herhaal de onderste en bovenste grens en vraag of er een taxatie beschikbaar is.',
      'Normaliseer bedragen die vermoedelijk in duizenden zijn opgegeven door ×1000 te doen.'
    ],
    badExample: 'woningwaarde: 280 (bedoeld €280.000)',
    goodExample: 'woningwaarde: 280000'
  },
  [ErrorCode.API_TIMEOUT]: {
    title: 'Backend-timeout',
    typicalCause: 'Replit API reageerde niet binnen de ingestelde timeout.',
    resolutionSteps: [
      'Informeer de gebruiker dat de backend traag reageert.',
      'Wacht minimaal 30 seconden voor een retry.',
      'Herstart indien probleem aanhoudt en controleer statuspagina.'
    ],
    badExample: 'Direct opnieuw dezelfde call spammen',
    goodExample: 'Een retry met exponential backoff en duidelijke melding aan gebruiker'
  },
  [ErrorCode.API_RATE_LIMIT]: {
    title: 'Rate limit bereikt',
    typicalCause: 'Meer dan 100 requests per sessie per minuut.',
    resolutionSteps: [
      'Communiceer de wachttijd (60 seconden) naar de gebruiker.',
      'Gebruik hetzelfde session_id en plan calls zodat de limiet niet opnieuw geraakt wordt.',
      'Cache resultaten indien dezelfde vraag direct opnieuw wordt gesteld.'
    ],
    badExample: 'Onmiddellijk opnieuw proberen zonder vertraging',
    goodExample: 'Gebruiker informeren en na 60 seconden opnieuw proberen'
  },
  [ErrorCode.API_ERROR]: {
    title: 'Algemene backendfout',
    typicalCause: 'De externe hypotheek-API gaf een 5xx respons of onverwachte payload.',
    resolutionSteps: [
      'Log correlation_id en statuscode zonder gevoelige gegevens.',
      'Probeer het verzoek na een korte wachttijd opnieuw (maximaal 3 pogingen).',
      'Escalatie: controleer backend-status of neem contact op met het platformteam.'
    ],
    badExample: 'Herhaaldelijk direct opnieuw proberen zonder logging',
    goodExample: '"Backend gaf 502 terug. Ik probeer het over 15 seconden opnieuw (poging 2/3)."'
  },
  [ErrorCode.UNKNOWN_ERROR]: {
    title: 'Onbekende fout',
    typicalCause: 'Onverwachte situatie (bijv. nieuwe API-respons, parsingfout).',
    resolutionSteps: [
      'Log de correlation_id en relevante metadata (zonder PII).',
      'Geef een vriendelijke melding dat het team op de hoogte wordt gebracht.',
      'Vraag de gebruiker om eventueel ontbrekende context te delen.'
    ],
    badExample: '“Geen idee wat er mis ging”',
    goodExample: '“Er ging iets mis buiten onze verwachting. Ik heb het incident gelogd (ID: ...).”'
  },
  [ErrorCode.CONFIGURATION_ERROR]: {
    title: 'Configuratieprobleem',
    typicalCause: 'Ontbrekende environment variables, verkeerde API-sleutel of verouderde versie.',
    resolutionSteps: [
      'Controleer of alle vereiste environment variables zijn ingevuld (zie README).',
      'Vergelijk de draaiende versie met de laatste release en voer zo nodig een update uit.',
      'Herstart de service na het corrigeren van configuratiewaarden.'
    ],
    badExample: 'Productie draait zonder REQUIRED_API_KEY',
    goodExample: 'Alle configuratievariabelen ingevuld en service herstart met succesmelding'
  }
};

const QUICK_REF_ERROR_CODES: ErrorCode[] = [
  ErrorCode.INVALID_DATE_FORMAT,
  ErrorCode.AGE_OUT_OF_RANGE,
  ErrorCode.INVALID_ENERGIELABEL,
  ErrorCode.INVALID_HYPOTHEEKVORM,
  ErrorCode.RENTEVAST_EXCEEDS_LOOPTIJD
];

const TOP_FIVE_MISTAKES: { title: string; fix: string }[] = [
  {
    title: 'Rente opgegeven als percentage of string',
    fix: 'Vraag de rente opnieuw als decimaal (bijv. 0.0372 voor 3,72%) en herhaal het voorbeeld.'
  },
  {
    title: 'Looptijd in jaren in plaats van maanden',
    fix: 'Vermenigvuldig jaren met 12 en bevestig de conversie met de gebruiker.'
  },
  {
    title: 'Energielabel niet exact of lowercase',
    fix: 'Gebruik hoofdletters en de exacte notatie uit de lijst (bijv. "A++++").'
  },
  {
    title: 'Partner aangemeld zonder partnerdata',
    fix: 'Vraag naar het partnerinkomen en stel: "Wat is de leeftijd of geboortedatum van uw partner?" zodat je de interne datum kunt invullen, of zet heeft_partner terug naar false.'
  },
  {
    title: 'Leningdelen bevatten onbekende sleutel of verkeerde mapping',
    fix: 'Gebruik canonical velden: huidige_schuld, huidige_rente, resterende_looptijd_in_maanden, rentevasteperiode_maanden, hypotheekvorm.'
  }
];

const FORMAT_RULES: Array<{ parameter: string; format: string; good: string; bad: string; rationale: string }> = [
  {
    parameter: 'Rente',
    format: 'Decimaal (bijv. 0.0372)',
    good: '0.025',
    bad: '"2,5%"',
    rationale: 'Backend verwacht een float; percentages veroorzaken 100× hogere waarden.'
  },
  {
    parameter: 'Looptijd',
    format: 'Maanden (integer)',
    good: '240',
    bad: '20',
    rationale: '20 wordt gelezen als 20 maanden. Converteer 20 jaar → 240 maanden.'
  },
  {
    parameter: 'Geboortedatum',
    format: 'Interne ISO (YYYY-MM-DD); vraag de gebruiker altijd: "Wat is uw leeftijd of geboortedatum?"',
    good: '1990-05-15',
    bad: '15-05-1990',
    rationale: 'ISO-formaat voorkomt ambiguïteit en matchingproblemen in validatie.'
  },
  {
    parameter: 'Hypotheekvorm',
    format: 'Exacte string (annuiteit | lineair | aflossingsvrij)',
    good: 'annuiteit',
    bad: 'Annuïteit',
    rationale: 'Accenten en hoofdletters worden geweigerd door normalisatie en validatie.'
  },
  {
    parameter: 'Energielabel',
    format: 'Exact uit lijst',
    good: 'A+++',
    bad: 'a+++',
    rationale: 'Beperk tot vooraf gedefinieerde waarden zodat back-end de toeslag goed toepast.'
  }
];

const STARTER_CASES = [
  {
    title: 'Starter alleenstaand',
    context: 'Bruto inkomen €42.000, 28 jaar, geen verplichtingen.',
    highlight: 'Gebruik bereken_hypotheek_starter voor NHG vs non-NHG scenario’s.'
  },
  {
    title: 'Starter met partner',
    context: 'Combinatie-inkomen €103.000, NHG tegen limiet aan.',
    highlight: 'Check NHG-geschiktheid en bespreek kosten koper buffer.'
  },
  {
    title: 'Starter met verduurzamingsbudget',
    context: 'Spaargeld + verduurzamingskosten, energielabel impact bespreken.',
    highlight: 'Vraag naar verbouwingsbudget en energielabel om toeslagen mee te nemen.'
  }
];

const DOORSTROMER_CASES = [
  {
    title: 'Doorstromer met één leningdeel',
    context: 'Restschuld €180.000, woningwaarde €350.000.',
    highlight: 'Benadruk overwaarde en nieuwe maximale hypotheek.'
  },
  {
    title: 'Doorstromer met meerdere delen',
    context: 'Annuïteit + aflossingsvrij, verschillende rentepercentages.',
    highlight: 'Gebruik normalizer om alle leningdelen naar canonical velden te zetten.'
  },
  {
    title: 'Doorstromer met partner en verbouwing',
    context: 'Gezamenlijk inkomen, bestaande woning en renovatiebudget.',
    highlight: 'Combineer overwaarde, nieuwe woningkosten en partnerdata voor opzet.'
  }
];

interface ResourceDefinition {
  metadata: Resource;
  version: string;
  buildText: () => string;
}

const resourceDefinitions: ResourceDefinition[] = [
  {
    metadata: {
      name: 'guide-playbook',
      title: 'AI Agent Playbook',
      description: 'Volledige playbook met 10 voorbeelden, best practices en troubleshooting.',
      uri: 'hypotheek://v4/guide/playbook',
      mimeType: MARKDOWN_MIME
    },
    version: packageVersion,
    buildText: () => readFileRelative('docs/AI_AGENT_PLAYBOOK.md')
  },
  {
    metadata: {
      name: 'guide-quick-ref',
      title: 'Quick Reference',
      description: 'Tool selectie, formatregels, fouten en errorcodes in één pagina.',
      uri: 'hypotheek://v4/guide/quick-ref',
      mimeType: MARKDOWN_MIME
    },
    version: '1.0.0',
    buildText: buildQuickReference
  },
  {
    metadata: {
      name: 'guide-opzet-intake',
      title: 'Opzet Hypotheek Intake Guide',
      description: 'Checklist voor intakevelden, defaults en doorstromer-specifieke gegevens.',
      uri: 'hypotheek://v4/guide/opzet-intake',
      mimeType: MARKDOWN_MIME
    },
    version: '1.0.0',
    buildText: buildOpzetIntakeGuide
  },
  {
    metadata: {
      name: 'guide-output-formatting',
      title: 'Output Formatting Guide',
      description: 'Best practices voor het presenteren van hypotheek berekeningen aan eindgebruikers.',
      uri: 'hypotheek://v4/guide/output-formatting',
      mimeType: MARKDOWN_MIME
    },
    version: '1.0.0',
    buildText: buildOutputFormattingGuide
  },
  {
    metadata: {
      name: 'examples-starter',
      title: 'Startercases',
      description: 'Top 3 starter scenario’s met intake-tip en toolkeuze.',
      uri: 'hypotheek://v4/examples/starter',
      mimeType: MARKDOWN_MIME
    },
    version: '1.0.0',
    buildText: buildStarterExamples
  },
  {
    metadata: {
      name: 'examples-doorstromer',
      title: 'Doorstromercases',
      description: 'Top 3 doorstromer scenario’s met aandachtspunten.',
      uri: 'hypotheek://v4/examples/doorstromer',
      mimeType: MARKDOWN_MIME
    },
    version: '1.0.0',
    buildText: buildDoorstromerExamples
  },
  {
    metadata: {
      name: 'ops-error-recovery',
      title: 'Error Recovery Plan',
      description: 'Resolutie-stappen per errorcode met voorbeelden.',
      uri: 'hypotheek://v4/ops/error-recovery',
      mimeType: MARKDOWN_MIME
    },
    version: '1.0.0',
    buildText: buildErrorRecoveryGuide
  },
  {
    metadata: {
      name: 'rules-format',
      title: 'Formatregels',
      description: 'Formele lijst van verplichte formats met rationale.',
      uri: 'hypotheek://v4/rules/format',
      mimeType: MARKDOWN_MIME
    },
    version: '1.0.0',
    buildText: buildFormatRules
  }
].sort((a, b) => a.metadata.uri.localeCompare(b.metadata.uri));

function readFileRelative(relativePath: string): string {
  const absolutePath = resolve(projectRoot, relativePath);
  return readFileSync(absolutePath, 'utf-8');
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function buildOpzetIntakeGuide(): string {
  return readFileRelative('docs/OPZET_INTAKE.md');
}

function buildOutputFormattingGuide(): string {
  return readFileRelative('docs/OUTPUT_FORMATTING.md');
}


function buildQuickReference(): string {
  const toolMatrix = `| Situatie | Tool | Reden |
|----------|------|-------|
| Starter zonder bestaande hypotheek | \`bereken_hypotheek_starter\` | Simpelste route, levert NHG en non-NHG scenario\'s |
| Doorstromer met bestaande woning | \`bereken_hypotheek_doorstromer\` | Overwaarde + leningdelen analyseren |
| Specifieke rente/looptijd gevraagd | \`bereken_hypotheek_uitgebreid\` | Volledige controle over parameters |
| Starter wil woningtoets | \`opzet_hypotheek_starter\` | Laat financieringsmix en maandlast zien |
| Doorstromer wil woningtoets | \`opzet_hypotheek_doorstromer\` | Combineert overwaarde, nieuwe woning en leningdelen |
| Geavanceerde woningtoets | \`opzet_hypotheek_uitgebreid\` | Voor renteklassen of custom looptijd |
| Alleen rentestanden nodig | \`haal_actuele_rentes_op\` | Toont actuele top-5 rentes |`;

  const formatTableRows = FORMAT_RULES.map(rule => `| ${rule.parameter} | ${rule.format} | ${rule.good} | ${rule.bad} |`).join('\n');
  const formatTable = `| Parameter | Format | ✅ Goed | ❌ Fout |
|-----------|--------|--------|--------|
${formatTableRows}`;

  const mistakes = TOP_FIVE_MISTAKES.map((item, index) => `${index + 1}. **${item.title}:** ${item.fix}`).join('\n');

  const errorLines = QUICK_REF_ERROR_CODES.map(code => {
    const entry = ERROR_GUIDE[code];
    return `- **${code}** — ${entry.title}: ${entry.typicalCause}`;
  }).join('\n');

  const doorstromerGuidance = `
## Doorstromer intake & presentatie

- Vraag iedere doorstromer: "Wilt u een snelle globale berekening (met een samenvatting van uw hypotheek) of een detailberekening waarbij u alle leningdelen invoert?"
- Snelle globale berekening → maak één leningdeel met totale schuld, gemiddelde rente en resterende looptijd (optioneel huidige maandlast).
- Detailberekening → vul alle leningdelen afzonderlijk in met hoofdsom, rente, resterende looptijd, rentevast-periode en hypotheekvorm.
- Outputvelden voor doorstromer-tools (\`bereken_hypotheek_doorstromer\` of \`bereken_hypotheek_uitgebreid\` met doorstromer-invoer): max_woningbudget, overwaarde_bedrag, huidige_hypotheek_schuld, extra_leencapaciteit, maandlast_nu, maandlast_straks, verschil_maandlast.
- Gebruik deze waarden één-op-één; geen eigen herberekeningen behalve formatting.
- Presenteer resultaten als één blok met "Uw woningbudget" + bullets en een tweede blok "Uw nieuwe maandlast" met maandlast nu/straks/verschil.
- Pas dezelfde keuzevraag en invulstrategie toe voor \`opzet_hypotheek_doorstromer\` en \`opzet_hypotheek_uitgebreid\` wanneer u daar een doorstromer mee helpt.
`;

  const outputGuidance = `

## Output Best Practices

### Opzet Hypotheek
- ✅ Toon VOLLEDIGE tool output (heeft al balans checks + breakdown)
- ✅ Voeg korte intro/context toe (max 2 zinnen)
- ❌ Herschrijf of vat niet samen
- ❌ Laat geen secties weg

### Maximale Hypotheek
- ✅ Toon beide scenario's (NHG + non-NHG)
- ✅ Benadruk verschil tussen scenario's
- ✅ Verwijs naar energielabel impact indien relevant
`;

  return `# Hypotheek MCP Quick Reference

## Tool selectie matrix

${toolMatrix}

## Kritieke format regels

${formatTable}

## Top 5 veelgemaakte fouten

${mistakes}

## Error code quick reference

${errorLines}${doorstromerGuidance}${outputGuidance}
`;
}

function buildStarterExamples(): string {
  const items = STARTER_CASES.map(caseItem => `### ${caseItem.title}
- **Context:** ${caseItem.context}
- **Aanpak:** Gebruik \`bereken_hypotheek_starter\`.
- **Let op:** ${caseItem.highlight}
`).join('\n');

  return `# Startercases

Gebruik deze referenties om intakegesprekken te versnellen.

${items}`;
}

function buildDoorstromerExamples(): string {
  const intakeReminder = `> Vraag iedere doorstromer: "Wilt u een snelle globale berekening (met een samenvatting van uw hypotheek) of een detailberekening waarbij u alle leningdelen invoert?" Vul vervolgens óf één samenvattend leningdeel óf alle leningdelen afzonderlijk in.

> Ongeacht of u \`bereken_hypotheek_doorstromer\` of \`bereken_hypotheek_uitgebreid\` gebruikt: presenteer het resultaat als één blok met "Uw woningbudget" + bullets en "Uw nieuwe maandlast" zoals omschreven in de Quick Start. Gebruik uitsluitend MCP-velden (max_woningbudget, overwaarde_bedrag, huidige_hypotheek_schuld, extra_leencapaciteit, maandlast_nu, maandlast_straks, verschil_maandlast).`;

  const items = DOORSTROMER_CASES.map(caseItem => `### ${caseItem.title}
- **Context:** ${caseItem.context}
- **Aanpak:** Gebruik \`bereken_hypotheek_doorstromer\` of \`opzet_hypotheek_doorstromer\` afhankelijk van de vraag.
- **Let op:** ${caseItem.highlight}
`).join('\n');

  return `# Doorstromercases

Belangrijk: vraag altijd naar huidige woningwaarde én duidelijke invoerkeuze (snelle samenvatting of detail per leningdeel).

${intakeReminder}

${items}`;
}

function buildErrorRecoveryGuide(): string {
  const sections = Object.entries(ERROR_GUIDE).map(([code, entry]) => {
    const steps = entry.resolutionSteps.map(step => `1. ${step}`).join('\n');
    return `## ${code} — ${entry.title}

**Typische oorzaak:** ${entry.typicalCause}

**Stappen om op te lossen:**
${steps}

**Fout voorbeeld:** ${entry.badExample}

**Correct voorbeeld:** ${entry.goodExample}
`;
  }).join('\n');

  return `# Error Recovery Plan

Gebruik dit document om validatie en API-fouten snel te herstellen zonder PII te loggen.

${sections}`;
}

function buildFormatRules(): string {
  const rows = FORMAT_RULES.map(rule => `- **${rule.parameter}** → ${rule.format}
  - ✅ ${rule.good}
  - ❌ ${rule.bad}
  - _Waarom:_ ${rule.rationale}`).join('\n');

  return `# Formele Formatregels

Hanteer deze regels om afwijzingen te voorkomen.

${rows}`;
}

function toResourceContents(definition: ResourceDefinition): TextResourceContents {
  const text = definition.buildText();
  return {
    uri: definition.metadata.uri,
    mimeType: definition.metadata.mimeType,
    text,
    _meta: {
      etag: hashContent(text),
      version: definition.version
    }
  };
}

export function listResources(): Resource[] {
  return resourceDefinitions.map(def => def.metadata);
}

export function readResource(uri: string): TextResourceContents {
  const definition = resourceDefinitions.find(item => item.metadata.uri === uri);
  if (!definition) {
    throw new McpError(McpErrorCode.InvalidParams, `Onbekende resource: ${uri}`, {
      httpStatus: 404,
      code: 'NOT_FOUND'
    });
  }

  return toResourceContents(definition);
}
