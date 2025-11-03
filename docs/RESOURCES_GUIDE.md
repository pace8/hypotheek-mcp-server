# MCP Resources & Prompts Guide

Deze gids beschrijft welke resources en prompts de Hypotheek MCP server aanbiedt, wanneer je welke gebruikt en welke argumenten je kunt meesturen.

## Overzicht Resources

| Naam | URI | Beschrijving | Wanneer gebruiken |
|------|-----|--------------|-------------------|
| guide-playbook | hypotheek://v4/guide/playbook | Volledige AI Agent Playbook met intake- en recoveryvoorbeelden. | Gebruik als je alle best practices wilt nalezen of voorbeelden nodig hebt. |
| guide-quick-ref | hypotheek://v4/guide/quick-ref | Eén pagina met toolkeuze, formatregels en topfouten. | Handig tijdens intake om snel het juiste tool en format te kiezen. |
| examples-starter | hypotheek://v4/examples/starter | Top 3 startercases met context en intake-tips. | Vraag om inspiratie of controleer of je alle startervragen stelt. |
| examples-doorstromer | hypotheek://v4/examples/doorstromer | Top 3 doorstromercases inclusief aandachtspunten. | Helpt bij het uitvragen van bestaande hypotheken en overwaarde. |
| ops-error-recovery | hypotheek://v4/ops/error-recovery | Herstelplan per ErrorCode met voorbeeldinput. | Direct raadplegen na validatie- of API-fouten. |
| rules-format | hypotheek://v4/rules/format | Strikte formatregels + rationale per veld. | Check snel welk formaat je moet afdwingen (rente, looptijd, etc.). |

### Resource highlights

- **Formatregels**: bevat ✅/❌ voorbeelden die je letterlijk kunt herhalen richting de gebruiker.
- **Error Recovery Plan**: geeft per ErrorCode drie oplossingsstappen plus correcte voorbeeldinput.
- **Starter- en Doorstromercases**: helpen om intakevragen te structureren en verwachtte toolcalls te selecteren.

## Prompts

| Prompt | Doel | Argumenten |
|--------|------|------------|
| intake-kickoff | Start een intakegesprek in drie fasen (situatie → doelen → bevestiging). | `klantnaam?`, `klanttype?` (starter/doorstromer/onduidelijk), `voorkeur_toon?` (neutraal/energiek/formeel), `aanvullende_context?` |
| offer-review | Analyseer een toolresultaat, wijs op afwijkingen en geef vervolgstappen. | `scenario_type?` (starter/doorstromer/mix), `controlepunten?` (array), `verwachte_maandlast?`, `reden_herberekening?` |
| recovery-plan | Genereer stap-voor-stap herstelplan op basis van ErrorCode. | `error_code` (verplicht), `poging_nummer?`, `laatste_actie?`, `aanvullende_context?` |

### Prompt tips

- Voor prompts kun je argumenten als strings doorgeven; numerieke waarden worden automatisch geconverteerd (bijv. `"verwachte_maandlast": "1345.50"`).
- `recovery-plan` is tolerant voor herhaalde pogingen: verhoog `poging_nummer` zodat de instructie strenger wordt.
- `offer-review` linkt automatisch naar het Error Recovery Plan zodat je snel follow-up acties kunt formuleren.

## Workflow suggesties

1. **Intake:** gebruik eerst `prompts/get` met `intake-kickoff` om de LLM te primen; lees daarna `guide-quick-ref` om veldformaten te bevestigen.
2. **Analyse:** na een toolcall kun je `offer-review` gebruiken om structurele feedback te genereren en de gebruiker mee te nemen in de uitkomst.
3. **Herstel:** bij een fout lees eerst `ops-error-recovery`, roep daarna de `recovery-plan` prompt aan met de exacte `error_code` voor een concreet stappenplan.

Met deze resources en prompts blijft de agent consistent in toon, format en foutafhandeling. Raadpleeg dit document regelmatig om nieuwe scenario’s snel te kunnen afhandelen.
