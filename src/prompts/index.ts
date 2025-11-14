import { McpError, ErrorCode as McpErrorCode, PromptMessageSchema, PromptSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { ErrorCode } from '../types/index.js';
import { listResources } from '../resources/index.js';

type PromptMetadata = z.infer<typeof PromptSchema>;
type PromptMessage = z.infer<typeof PromptMessageSchema>;

interface PromptDefinition<Args extends object> {
  metadata: PromptMetadata;
  description: string;
  argsSchema: z.ZodType<Args>;
  defaults?: Partial<Args>;
  build: (args: Args) => PromptMessage[];
}

const intakePromptArgsSchema = z.object({
  klantnaam: z.string().min(2, 'klantnaam te kort').optional(),
  klanttype: z.enum(['starter', 'doorstromer', 'onduidelijk']).optional(),
  voorkeur_toon: z.enum(['neutraal', 'energiek', 'formeel']).optional(),
  aanvullende_context: z.string().max(600).optional(),
});

const reviewPromptArgsSchema = z.object({
  scenario_type: z.enum(['starter', 'doorstromer', 'mix']).optional(),
  controlepunten: z.array(z.string().min(2)).max(5).optional(),
  verwachte_maandlast: z.coerce.number().positive().optional(),
  reden_herberekening: z.string().max(400).optional(),
});

const recoveryPromptArgsSchema = z.object({
  error_code: z.nativeEnum(ErrorCode),
  poging_nummer: z.coerce.number().int().min(1).max(5).optional(),
  laatste_actie: z.string().max(400).optional(),
  aanvullende_context: z.string().max(600).optional(),
});

const outputFormattingPromptArgsSchema = z.object({
  tool_type: z.enum(['opzet', 'maximaal']),
  user_question: z.string().max(200).optional(),
});

type IntakePromptArgs = z.infer<typeof intakePromptArgsSchema>;
type ReviewPromptArgs = z.infer<typeof reviewPromptArgsSchema>;
type RecoveryPromptArgs = z.infer<typeof recoveryPromptArgsSchema>;
type OutputFormattingPromptArgs = z.infer<typeof outputFormattingPromptArgsSchema>;

const intakePromptDefinition: PromptDefinition<IntakePromptArgs> = {
    metadata: {
      name: 'intake-kickoff',
      title: 'Intake Kick-off',
      description: 'Start het hypotheekgesprek met duidelijke stappen, guardrails en format-voorbeelden.',
      arguments: [
        {
          name: 'klantnaam',
          description: 'Naam van de klant voor een persoonlijkere aanhef.',
        },
        {
          name: 'klanttype',
          description: 'Type klant: starter, doorstromer of onduidelijk (default).',
        },
        {
          name: 'voorkeur_toon',
          description: 'Kies neutraal, energiek of formeel om de tone-of-voice aan te passen.',
        },
        {
          name: 'aanvullende_context',
          description: 'Extra informatie uit eerdere gesprekken om mee te nemen in de intake.',
        },
      ],
    },
    description: 'Herinnert de agent aan de drie intakefasen, vraagt ontbrekende data uit en verwijst naar quick reference formats.',
    argsSchema: intakePromptArgsSchema,
    defaults: {
      klanttype: 'onduidelijk',
      voorkeur_toon: 'neutraal',
    },
    build: (args: IntakePromptArgs) => {
      const klantnaam = args.klantnaam;
      const klanttype = (args.klanttype ?? 'onduidelijk') as 'starter' | 'doorstromer' | 'onduidelijk';
      const voorkeur_toon = (args.voorkeur_toon ?? 'neutraal') as 'neutraal' | 'energiek' | 'formeel';
      const aanvullende_context = args.aanvullende_context;
      const aanspreking = klantnaam ? `${klantnaam}` : 'de klant';
      const typeDirective = klanttype === 'onduidelijk'
        ? 'Achterhaal of het om een starter of doorstromer gaat en kies daarna het juiste toolpad.'
        : `Bevestig dat ${aanspreking} een ${klanttype} is en stem vervolgvragen daarop af.`;
      const toneHint = voorkeur_toon === 'energiek'
        ? 'Gebruik een energieke, enthousiasmerende stijl terwijl je feitelijk blijft.'
        : voorkeur_toon === 'formeel'
          ? 'Formuleer antwoorden formeel en bondig.'
          : 'Gebruik een neutrale, vriendelijke toon.';
      const contextAddendum = aanvullende_context ? `

Context uit eerdere interacties:
- ${aanvullende_context}` : '';

      const introText = `Je bent een hypotheekspecialist. Doel: voer een intake in drie fasen (situatie → doelen → bevestiging).

${typeDirective}
${toneHint}${contextAddendum}

Checklijst:
1. Vraag ontbrekende kernvelden uit (inkomen, stel: "Wat is uw leeftijd of geboortedatum?", woningwaarde, verplichtingen, energielabel).
2. Gebruik de Opzet Intake guide voor detaildefinities en defaults, zeker bij doorstromers.
3. Herhaal kritieke formatregels (rente als decimaal, looptijden in maanden).
4. Beantwoord de vraag van ${aanspreking} en stel een logisch vervolgstap voor.
5. Kopieer altijd het \`session_id\` veld uit de n8n trigger (variabele \`sessionId\`) zodat logging en rate limiting werken.
6. Beslis op basis van de vraag of er een concrete woning is:
   - Geen woning → gebruik \`bereken_hypotheek_*\`
   - Wel woning → gebruik \`opzet_hypotheek_*\`
   - Kies daarna starter of doorstromer, en alleen de \`*_uitgebreid\` variant als de gebruiker expliciet scenario’s wil tweaken.

Leeftijd/geboortedatum-regel:
- Als ${aanspreking} een leeftijd noemt, reken die stilletjes om naar een geboortedatum in ISO-formaat voor toolcalls.
- Benoem in je reactie alleen de leeftijd die ${aanspreking} noemde en noem nooit de afgeleide geboortedatum tenzij ${aanspreking} die zelf gaf.

Verwijs expliciet naar de Quick Reference en de Opzet Intake guide wanneer de gebruiker veel cijfers moet invullen.`;

      const doorstromerGuidance = `

Doorstromer-instructie:
- Wanneer de gebruiker een bestaande woning en hypotheek heeft: vraag expliciet "Wilt u een snelle globale berekening (met een samenvatting van uw hypotheek) of een detailberekening waarbij u alle leningdelen invoert?".
- Snelle globale berekening → noteer één leningdeel met totaal schuld, gemiddelde rente en resterende looptijd (optioneel huidige maandlast).
- Detailberekening → laat de gebruiker alle leningdelen kopiëren, inclusief hypotheekvorm, rente en resterende looptijd.
- Presenteer de uitkomst later als één blok met "Uw woningbudget" + bullets en "Uw nieuwe maandlast" en gebruik uitsluitend MCP-velden (max_woningbudget, overwaarde_bedrag, huidige_hypotheek_schuld, extra_leencapaciteit, maandlast_nu, maandlast_straks, verschil_maandlast). Dit geldt zowel voor \`bereken_hypotheek_doorstromer\` als voor \`bereken_hypotheek_uitgebreid\` als je daarmee een doorstromer bedient.`;

      const intakeInstructions = `${introText}${doorstromerGuidance}`;

      return [
        {
          role: 'assistant',
          content: {
            type: 'text',
            text: intakeInstructions,
          },
        },
        createResourceLinkMessage('hypotheek://v4/guide/opzet-intake'),
        createResourceLinkMessage('hypotheek://v4/guide/quick-ref'),
        createResourceLinkMessage('hypotheek://v4/rules/format'),
      ];
    },
  };

const reviewPromptDefinition: PromptDefinition<ReviewPromptArgs> = {
    metadata: {
      name: 'offer-review',
      title: 'Aanbod Review',
      description: 'Controleer resultaten van een berekening en geef actiegerichte feedback.',
      arguments: [
        {
          name: 'scenario_type',
          description: 'Gebruik starter, doorstromer of mix om de juiste nuance te kiezen.',
        },
        {
          name: 'controlepunten',
          description: 'Optionele lijst van velden die dubbel gecontroleerd moeten worden.',
        },
        {
          name: 'verwachte_maandlast',
          description: 'Referentiewaarde om het resultaat tegen te toetsen.',
        },
        {
          name: 'reden_herberekening',
          description: 'Beschrijf waarom een nieuwe berekening nodig is zodat je gericht advies kunt geven.',
        },
      ],
    },
    description: 'Richtlijn om API-resultaten te duiden, verschillen uit te leggen en volgende stappen te adviseren.',
    argsSchema: reviewPromptArgsSchema,
    defaults: {
      scenario_type: 'starter',
    },
    build: (args: ReviewPromptArgs) => {
      const scenario_type = (args.scenario_type ?? 'starter') as 'starter' | 'doorstromer' | 'mix';
      const controlepunten = args.controlepunten;
      const verwachte_maandlast = args.verwachte_maandlast;
      const reden_herberekening = args.reden_herberekening;
      const focusLines = Array.isArray(controlepunten) && controlepunten.length > 0
        ? `Controleer extra op:
${controlepunten.map((item: string) => `- ${item}`).join('\n')}`
        : 'Gebruik standaardcontrole: maximale hypotheek, maandlasten, energielabel en NHG.';
      const maandlastRule = verwachte_maandlast
        ? `Vergelijk de gerapporteerde maandlast met de verwachting (€${verwachte_maandlast.toFixed(2)}). Licht verschillen toe.`
        : 'Controleer of de maandlast logisch aansluit op de rente en looptijd.';
      const rerunMotivation = reden_herberekening
        ? `Beschrijf waarom er een herberekening nodig was: ${reden_herberekening}.`
        : 'Noem alleen een herberekening als er afwijkingen of nieuwe input zijn.';

      const text = `Je beoordeelt een hypotheekresultaat voor een ${scenario_type} scenario.

Werkwijze:
1. Vat scenario en belangrijkste uitkomsten samen (max hypotheek, maandlast, eventuele overwaarde).
2. Benoem afwijkingen ten opzichte van verwachtingen of eerdere scenario’s.
3. Geef advies voor vervolgstappen (bijv. verduidelijking, nieuwe toolcall, klantactie).

**BELANGRIJK voor Opzet Hypotheek output:**
- De tool geeft al een volledig gestructureerd overzicht met balans checks
- Toon deze output VOLLEDIG aan de gebruiker
- Voeg alleen een korte samenvatting toe aan het BEGIN indien gewenst
- Benadruk de praktische toelichtingen uit de output
- Gebruik de balans check om te verifiëren dat alles klopt

${maandlastRule}
${focusLines}
${rerunMotivation}`;

      return [
        {
          role: 'assistant',
          content: {
            type: 'text',
            text,
          },
        },
        createResourceLinkMessage('hypotheek://v4/guide/playbook'),
        createResourceLinkMessage('hypotheek://v4/ops/error-recovery'),
      ];
    },
  };

const outputFormattingPromptDefinition: PromptDefinition<OutputFormattingPromptArgs> = {
    metadata: {
      name: 'output-formatting',
      title: 'Output Formatting Guidance',
      description: 'Hulp bij het correct presenteren van tool output aan eindgebruikers.',
      arguments: [
        {
          name: 'tool_type',
          description: 'Type berekening: opzet of maximaal',
          required: true,
        },
        {
          name: 'user_question',
          description: 'Optioneel: de originele vraag van de gebruiker',
        },
      ],
    },
    description: 'Geeft richtlijnen voor het presenteren van tool output.',
    argsSchema: outputFormattingPromptArgsSchema,
    build: (args: OutputFormattingPromptArgs) => {
      const tool_type = args.tool_type;
      const user_question = args.user_question;
      
      const text = `Je presenteert de output van een ${tool_type} hypotheek berekening.

**Cruciale regels:**
1. ✅ Toon de VOLLEDIGE tool output - deze is al perfect geformatteerd
2. ✅ Voeg alleen een korte intro toe als context (1-2 zinnen max)
3. ✅ Verwijs naar specifieke secties in de output bij vervolgvragen
4. ❌ Herschrijf de output NIET in je eigen woorden
5. ❌ Laat GEEN onderdelen weg (zoals maandlasten breakdown)

**Template:**
[Korte intro gebaseerd op vraag van gebruiker]

[VOLLEDIGE TOOL OUTPUT HIER]

[Optioneel: één concrete vervolgvraag of actie]

${user_question ? `**Context:** De gebruiker vroeg: \"${user_question}\"` : ''}`;

      return [
        {
          role: 'assistant',
          content: {
            type: 'text',
            text,
          },
        },
      ];
    },
  };

const recoveryPromptDefinition: PromptDefinition<RecoveryPromptArgs> = {
    metadata: {
      name: 'recovery-plan',
      title: 'Foutherstel Plan',
      description: 'Genereer een stapsgewijs herstelplan op basis van een bekende errorcode.',
      arguments: [
        {
          name: 'error_code',
          description: 'Verplichte ErrorCode uit de MCP-server.',
          required: true,
        },
        {
          name: 'poging_nummer',
          description: 'Hoeveelste herstelpoging dit is, zodat je extra voorzichtig kan zijn.',
        },
        {
          name: 'laatste_actie',
          description: 'Beschrijf de laatste stap of toolcall voorafgaand aan de fout.',
        },
        {
          name: 'aanvullende_context',
          description: 'Vrij veld voor logfragmenten of relevante metadata (zonder PII).',
        },
      ],
    },
    description: 'Maakt een concreet herstelplan met verwijzing naar error recovery resource en formatregels.',
    argsSchema: recoveryPromptArgsSchema,
    defaults: {
      poging_nummer: 1,
    },
    build: (args: RecoveryPromptArgs) => {
      const error_code = args.error_code;
      const poging_nummer = args.poging_nummer ?? 1;
      const laatste_actie = args.laatste_actie;
      const aanvullende_context = args.aanvullende_context;
      const contextText = aanvullende_context ? `
Aanvullende context:
- ${aanvullende_context}` : '';
      const actionText = laatste_actie ? `Laatste uitgevoerde actie: ${laatste_actie}.` : 'Benoem wat de laatste succesvolle stap was.';

      const text = `Je maakt herstelplan poging ${poging_nummer} voor foutcode ${error_code}.

Stappen:
1. Leg in maximaal twee regels uit wat de fout betekent en waarom die waarschijnlijk is opgetreden.
2. Bied een concreet herstelplan: dataherstel → nieuwe toolcall → bevestigen.
3. Geef voorbeeldinput in correct formaat en vermeld correlatie-ID alleen indien beschikbaar.

${actionText}${contextText}`;

      return [
        {
          role: 'assistant',
          content: {
            type: 'text',
            text,
          },
        },
        createResourceLinkMessage('hypotheek://v4/ops/error-recovery'),
        createResourceLinkMessage('hypotheek://v4/rules/format'),
      ];
    },
  };

const promptDefinitions: PromptDefinition<any>[] = [
  intakePromptDefinition,
  reviewPromptDefinition,
  outputFormattingPromptDefinition,
  recoveryPromptDefinition,
];

const promptsByName = new Map(promptDefinitions.map((definition) => [definition.metadata.name, definition]));

function createResourceLinkMessage(uri: string): PromptMessage {
  const resource = listResources().find((item) => item.uri === uri);
  if (!resource) {
    throw new McpError(McpErrorCode.InternalError, `Resource ${uri} niet gevonden voor prompt.`);
  }

  return PromptMessageSchema.parse({
    role: 'assistant' as const,
    content: {
      type: 'resource_link' as const,
      uri: resource.uri,
      name: resource.name,
      title: resource.title,
      description: resource.description,
      mimeType: resource.mimeType,
    },
  });
}

export function listPrompts(): PromptMetadata[] {
  return promptDefinitions.map((definition) => definition.metadata);
}

export function getPrompt(name: string, args: Record<string, unknown> | undefined) {
  const definition = promptsByName.get(name);
  if (!definition) {
    throw new McpError(McpErrorCode.InvalidParams, `Onbekende prompt: ${name}`, {
      httpStatus: 404,
      code: 'PROMPT_NOT_FOUND',
    });
  }

  const mergedInput = {
    ...(definition.defaults ?? {}),
    ...(args ?? {}),
  } as Record<string, unknown>;
  const parsedArgs = definition.argsSchema.parse(mergedInput) as Parameters<typeof definition.build>[0];
  const withDefaults = {
    ...(definition.defaults ?? {}),
    ...parsedArgs,
  } as Parameters<typeof definition.build>[0];
  const messages = definition.build(withDefaults);

  return {
    description: definition.description,
    messages,
  };
}
