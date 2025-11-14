# AI Agent Playbook - Hypotheek MCP Server v4.0

**Laatste update:** 2025-11-03  
**Versie:** 5.0.0  
**Doelgroep:** AI Agents (Claude, GPT-4, n8n workflows)

---

## 📚 Inhoudsopgave

1. [Introductie](#introductie)
2. [Quick Start](#quick-start)
3. [Tool Selectie Matrix](#tool-selectie-matrix)
4. [10 Complete Voorbeelden](#10-complete-voorbeelden)
5. [Error Handling](#error-handling)
6. [Best Practices](#best-practices)
7. [Troubleshooting](#troubleshooting)

---

## Introductie

Deze playbook is geschreven voor AI agents die de Hypotheek MCP Server gebruiken. Het bevat:

- ✅ **Concrete voorbeelden** van gebruikersinteracties
- ✅ **Exacte tool calls** met alle parameters
- ✅ **Verwachte outputs** en hoe deze te interpreteren
- ✅ **Error scenarios** en hoe ermee om te gaan
- ✅ **Do's en Don'ts** voor optimale resultaten

### Belangrijke Concepten

**Starters vs Doorstromers:**
- **Starter**: Eerste koopwoning, geen bestaande hypotheek
- **Doorstromer**: Heeft al een woning met hypotheek, wil verhuizen

**Simpel vs Uitgebreid:**
- **Simpel**: Gebruik standaard parameters (voor 95% van de gevallen)
- **Uitgebreid**: Alleen voor specifieke rente/looptijd/energielabel wensen

**Maximaal vs Opzet:**
- **Maximaal**: "Hoeveel kan ik lenen?" (geeft bedrag)
- **Opzet**: "Kan ik deze woning kopen?" (geeft complete financiering)

---

## Quick Start

### Vereiste Informatie Verzamelen

Voor ALLE berekeningen altijd vragen:

1. ✅ **Inkomen** - Bruto jaarinkomen (aanvrager + evt. partner)
2. ✅ **Leeftijd of geboortedatum** - Vraag letterlijk: "Wat is uw leeftijd of geboortedatum?" en reken een opgegeven leeftijd intern om naar een ISO-geboortedatum zonder dat terug te koppelen.
3. ✅ **Partner** - Heeft aanvrager een partner die mee aanvraagt?
4. ✅ **Verplichtingen** - Andere leningen/alimentatie per maand

Voor DOORSTROMERS ook:

5. ✅ **Huidige woningwaarde** - Marktwaarde (niet WOZ!)
6. ✅ **Bestaande hypotheek** - Per leningdeel: schuld, rente, looptijd

Voor OPZET berekeningen ook:

7. ✅ **Nieuwe woningprijs** - Koopsom
8. ✅ **Eigen geld** - Spaargeld/schenking
9. ✅ **Verbouwing** - Kosten voor verbouwing/verduurzaming (optioneel)

#### Leeftijd/geboortedatum beleid
- Gebruik altijd de vraag: **"Wat is uw leeftijd of geboortedatum?"**
- Als de gebruiker een leeftijd geeft: bereken intern de geboortedatum (benadering) en gebruik uitsluitend de genoemde leeftijd in uw antwoord.
- Als de gebruiker een geboortedatum geeft: gebruik deze direct voor MCP-berekeningen en benoem leeftijd én datum alleen wanneer dat logisch is.
- Vraag nooit alsnog naar een geboortedatum in een specifiek formaat als de gebruiker al een leeftijd heeft gegeven.
- Deel de intern afgeleide geboortedatum nooit met de gebruiker en noem geen technische datumformaten tenzij een onmogelijke datum verduidelijkt moet worden.

#### Doorstromer intakekeuze
- Vraag iedere doorstromer expliciet: **"Wilt u een snelle globale berekening (met een samenvatting van uw hypotheek) of een detailberekening waarbij u alle leningdelen invoert?"**
- **Snelle globale berekening:** u noteert één leningdeel met de totale resterende schuld, gemiddelde rente en resterende looptijd (optioneel aangevuld met de huidige maandlast). Vermeld in uw toelichting dat het om een snelle indicatie gaat.
- **Detailberekening:** u voert elk leningdeel afzonderlijk in (hoofdsom/schuld, rente, resterende looptijd, rentevast-periode, hypotheekvorm). Laat de gebruiker gegevens uit het hypotheekoverzicht kopiëren en plakken.
- Respecteer altijd de keuze van de gebruiker en documenteer in uw antwoord welk invoerpad is gebruikt.
- Deze keuzevraag geldt voor alle doorstromer-tools: `bereken_hypotheek_doorstromer`, `bereken_hypotheek_uitgebreid` (met doorstromer parameters), `opzet_hypotheek_doorstromer` en `opzet_hypotheek_uitgebreid` wanneer u daar een doorstromer mee bedient.

#### Doorstromer outputvelden & presentatie
- Doorstromer tools (`bereken_hypotheek_doorstromer` of `bereken_hypotheek_uitgebreid` met doorstromer-invoer) leveren o.a. de velden `max_woningbudget`, `overwaarde_bedrag`, `huidige_hypotheek_schuld`, `extra_leencapaciteit`, `maandlast_nu`, `maandlast_straks` en `verschil_maandlast`. Gebruik deze waarden één-op-één; voer zelf geen financiële berekeningen uit.
- Presenteer de resultaten in één compact overzicht. Houd u aan onderstaande structuur en vervang alleen de bedragen/teksten:

```
┌─────────────────────────────────────────┐
│  🎯 Uw woningbudget                     │
├─────────────────────────────────────────┤
│  U kunt op zoek naar een woning tot:    │
│                                         │
│         € 540.000                       │
│         ─────────                       │
│                                         │
│  💡 Dit bedrag bestaat uit:             │
│  • Overwaarde huidige woning:  € X      │
│  • Huidige hypotheekschuld:    € Y      │
│  • Extra leencapaciteit:       € Z      │
├─────────────────────────────────────────┤
│  📊 Uw nieuwe maandlast                 │
├─────────────────────────────────────────┤
│  Nu:      € 1.872 / maand               │
│  Straks:  € 2.114 / maand               │
│  ───────────────────────                │
│  Verschil: + € 242 / maand              │
└─────────────────────────────────────────┘
```

- Gebruik altijd euro-tekens en duizendtallen (nl-NL). Het verschil is positief (+) of negatief (-) in het blok en wordt nooit opnieuw berekend.

#### Sessies & correlatie
- Geef bij elke toolcall het veld `session_id` mee. Gebruik hiervoor de n8n variabele `sessionId` uit de trigger *When chat message received*.
- Geen discussie met de gebruiker nodig: kopieer de waarde rechtstreeks en plaats deze in de payload.
- Zonder `session_id` missen we rate-limiting, logging en correlatie; daarom is dit *verplicht* bij elke call.

### Kritieke Formatting Regels

⚠️ **BELANGRIJK** - Deze fouten maken 80% van de failures uit:

```
✅ GOED:
- Rente: 0.0372 (decimaal voor 3.72%)
- Looptijd: 240 (maanden, niet jaren!)
- Energielabel: "A+++" (exact, met hoofdletters)
- Hypotheekvorm: "annuiteit" (lowercase, geen accenten)

❌ FOUT:
- Rente: "3.72%" (string percentage)
- Rente: 3.72 (te groot getal - moet 0.0372 zijn)
- Looptijd: 20 (dit wordt als 20 maanden gezien, niet 20 jaar!)
- Energielabel: "a+++" (lowercase werkt niet)
- Hypotheekvorm: "annuïteit" (accent werkt niet)
```

---

## Tool Selectie Matrix

| Situatie | Tool | Wanneer |
|----------|------|---------|
| Eerste huis kopen, hoeveel kan ik lenen? | `bereken_hypotheek_starter` | Geen bestaande hypotheek |
| Verhuizen, hoeveel kan ik lenen? | `bereken_hypotheek_doorstromer` | Standaard doorstromervraag |
| Verhuizen + maatwerk rente/looptijd/energielabel | `bereken_hypotheek_uitgebreid` | Doorstromer met extra parameters (zelfde outputregels) |
| Wil specifieke rente/looptijd/energielabel | `bereken_hypotheek_uitgebreid` | Alleen als expliciet gevraagd |
| Kan ik deze woning kopen? (starter) | `opzet_hypotheek_starter` | Wil complete financiering zien |
| Kan ik deze woning kopen? (doorstromer) | `opzet_hypotheek_doorstromer` | Verhuizen naar specifieke woning |
| Aangepaste parameters voor opzet | `opzet_hypotheek_uitgebreid` | Alleen als expliciet gevraagd |
| Wat zijn de huidige rentes? | `haal_actuele_rentes_op` | Rente-informatie nodig |

---

## 10 Complete Voorbeelden

### Voorbeeld 1: Starter Alleenstaand (Simpelste Geval)

**Gebruiker vraagt:**
> "Ik ben 28 jaar, verdien €42.000 per jaar en wil mijn eerste huis kopen. Hoeveel kan ik lenen?"

**Stap 1: Informatie verzamelen**

Agent vraagt door:
- "Wat is uw leeftijd of geboortedatum?"
- "Heeft u een partner die mee gaat lenen?"
- "Heeft u andere leningen of verplichtingen?"

Antwoord: Nee op beide.

**Stap 2: Geboortedatum berekenen**

```
Huidige datum: 2025-11-03
Leeftijd: 28
Morgen jarig: 2025-11-04
Geboortedatum: 1997-11-04
```

> Gebruik deze afgeleide geboortedatum alleen intern; in de terugkoppeling naar de gebruiker verwijst u naar de genoemde leeftijd van 28 jaar.

**Stap 3: Tool call**

```json
{
  "tool": "bereken_hypotheek_starter",
  "arguments": {
    "inkomen_aanvrager": 42000,
    "geboortedatum_aanvrager": "1997-11-04",
    "heeft_partner": false,
    "verplichtingen_pm": 0
  }
}
```

**Verwachte output:**

Twee scenario's:
1. **Met NHG**: €185.000 - €195.000, maandlast ~€850
2. **Zonder NHG**: €175.000 - €185.000, maandlast ~€800

**Agent response:**

> "Op basis van uw inkomen van €42.000 kunt u maximaal lenen:
> 
> 💰 **Met NHG (Nationale Hypotheek Garantie):** tot €190.000
> - Maandlast: ongeveer €870
> - Voordeel: Lagere rente (ca. 3.5%)
> 
> 💰 **Zonder NHG:** tot €180.000
> - Maandlast: ongeveer €825
> - Hogere rente (ca. 3.8%)
> 
> NHG biedt extra zekerheid en vaak lagere rente. Check altijd de actuele grens bij de berekening."

---

### Voorbeeld 2: Starter Met Partner

**Gebruiker vraagt:**
> "Ik (32 jaar, €55.000) en mijn partner (30 jaar, €48.000) willen samen een huis kopen."

**Stap 1: Tool call**

```json
{
  "tool": "bereken_hypotheek_starter",
  "arguments": {
    "inkomen_aanvrager": 55000,
    "geboortedatum_aanvrager": "1993-11-04",
    "heeft_partner": true,
    "inkomen_partner": 48000,
    "geboortedatum_partner": "1995-11-04",
    "verplichtingen_pm": 0
  }
}
```

**Verwachte output:**

- **Met NHG**: €430.000 - grens van toepassing op dit scenario
- **Zonder NHG**: €380.000 - €400.000

**Agent response:**

> "Samen kunt u maximaal lenen:
> 
> 💰 **Met NHG:** tot het maximale NHG-bedrag volgens de actuele berekening
> - Gecombineerd inkomen: €103.000
> - Maandlast: ongeveer €2.000
> - Rente: ca. 3.4%
> 
> 💰 **Zonder NHG:** tot €390.000
> - Maandlast: ongeveer €1.900
> - Rente: ca. 3.7%
> 
> **Let op:** Met NHG zit u tegen de actuele limiet aan; bespreek hoe kosten koper en buffers dit beïnvloeden."

---

### Voorbeeld 3: Doorstromer (Simpel - 1 leningdeel)

**Gebruiker vraagt:**
> "Ik wil verhuizen. Huidige woning is €350.000 waard, heb nog €180.000 schuld over met 3.2% rente en 20 jaar looptijd. Ik verdien €70.000."

**Stap 1: Informatie verzamelen**

- Leeftijd? → 40 jaar
- Partner? → Nee
- Andere verplichtingen? → Nee
- Vraag: "Wilt u een snelle globale berekening (met een samenvatting van uw hypotheek) of een detailberekening waarbij u alle leningdelen invoert?" → Gebruiker kiest detail en leest de cijfers voor een enkel leningdeel voor.

**Stap 2: Tool call**

```json
{
  "tool": "bereken_hypotheek_doorstromer",
  "arguments": {
    "inkomen_aanvrager": 70000,
    "geboortedatum_aanvrager": "1985-11-04",
    "heeft_partner": false,
    "verplichtingen_pm": 0,
    "waarde_huidige_woning": 350000,
    "bestaande_hypotheek": {
      "leningdelen": [
        {
          "huidige_schuld": 180000,
          "huidige_rente": 0.032,
          "resterende_looptijd_in_maanden": 240,
          "rentevasteperiode_maanden": 120,
          "hypotheekvorm": "annuiteit"
        }
      ]
    }
  }
}
```

**Verwachte output:**

- **Overwaarde**: €170.000
- **Maximale nieuwe hypotheek (met NHG)**: €310.000
- **Maximale nieuwe hypotheek (zonder NHG)**: €290.000
- **Nieuwe maandlast**: ~€1.450

**Agent response (met waarden rechtstreeks uit de MCP):**

```
┌─────────────────────────────────────────┐
│  🎯 Uw woningbudget                     │
├─────────────────────────────────────────┤
│  U kunt op zoek naar een woning tot:    │
│                                         │
│         € 480.000                       │
│         ─────────                       │
│                                         │
│  💡 Dit bedrag bestaat uit:             │
│  • Overwaarde huidige woning:  € 170.000│
│  • Huidige hypotheekschuld:    € 180.000│
│  • Extra leencapaciteit:       € 310.000│
├─────────────────────────────────────────┤
│  📊 Uw nieuwe maandlast                 │
├─────────────────────────────────────────┤
│  Nu:      € 1.450 / maand               │
│  Straks:  € 1.720 / maand               │
│  ───────────────────────                │
│  Verschil: + € 270 / maand              │
└─────────────────────────────────────────┘
```

> *Toelichting aan gebruiker:* "Dit overzicht is puur gebaseerd op de bedragen uit de berekening. Wilt u deze cijfers met een adviseur finetunen of een snellere globale berekening laten maken? Laat het gerust weten."

> *Let op voor agents:* gebruikt u `bereken_hypotheek_uitgebreid` omdat u rente/looptijd/energielabel handmatig opgeeft? Dan blijft deze identieke blokpresentatie verplicht zodra het om een doorstromer gaat.

---

### Voorbeeld 4: Doorstromer (Complex - Meerdere Leningdelen)

**Gebruiker vraagt:**
> "Ik heb 2 hypotheken op mijn huidige woning. Een annuïteit van €150.000 (2.5%, 18 jaar over) en een aflossingsvrij deel van €50.000 (4.0%, 10 jaar over)."

**Tool call:**

```json
{
  "tool": "bereken_hypotheek_doorstromer",
  "arguments": {
    "inkomen_aanvrager": 75000,
    "geboortedatum_aanvrager": "1980-11-04",
    "heeft_partner": false,
    "verplichtingen_pm": 0,
    "waarde_huidige_woning": 380000,
    "bestaande_hypotheek": {
      "leningdelen": [
        {
          "huidige_schuld": 150000,
          "huidige_rente": 0.025,
          "resterende_looptijd_in_maanden": 216,
          "rentevasteperiode_maanden": 60,
          "hypotheekvorm": "annuiteit"
        },
        {
          "huidige_schuld": 50000,
          "huidige_rente": 0.040,
          "resterende_looptijd_in_maanden": 120,
          "rentevasteperiode_maanden": 0,
          "hypotheekvorm": "aflossingsvrij"
        }
      ]
    }
  }
}
```

**Agent response:**

> "Analyse van uw situatie met 2 leningdelen:
> 
> 🏠 **Huidige hypotheek:**
> - Leningdeel 1: €150.000 (annuïteit, 2.5%)
> - Leningdeel 2: €50.000 (aflossingsvrij, 4.0%)
> - **Totale schuld: €200.000**
> 
> 💰 **Overwaarde:** €180.000
> 
> 🎯 **Nieuwe mogelijkheden:**
> - Maximaal €330.000 nieuwe hypotheek
> - Met overwaarde: woning tot €510.000
> 
> **Tip:** Het aflossingsvrije deel heeft een relatief hoge rente (4.0%). Bij de nieuwe hypotheek kunt u overwegen dit mee af te lossen."

---

### Voorbeeld 5: Uitgebreid - Specifieke Parameters

**Gebruiker vraagt:**
> "Ik wil weten hoeveel ik kan lenen met een specifieke rente van 3.85% voor 20 jaar rentevast."

**Tool call:**

```json
{
  "tool": "bereken_hypotheek_uitgebreid",
  "arguments": {
    "inkomen_aanvrager": 60000,
    "geboortedatum_aanvrager": "1990-11-04",
    "heeft_partner": false,
    "nieuwe_hypotheek": {
      "looptijd_maanden": 360,
      "rentevaste_periode_maanden": 240,
      "rente": 0.0385,
      "hypotheekvorm": "annuiteit",
      "nhg": false,
      "ltv": 1.0
    }
  }
}
```

**Agent response:**

> "Met uw specifieke parameters:
> 
> 📊 **Hypotheek opzet:**
> - Rente: 3.85% (20 jaar vast)
> - Looptijd: 30 jaar
> - Type: Annuïteit
> 
> 💰 **Maximaal bedrag:** €265.000
> - Maandlast: ongeveer €1.245
> 
> **Ter vergelijking:** Met standaard rente (3.5%, 10 jaar vast) zou u €280.000 kunnen lenen. De langere rentevaste periode (20 jaar) betekent een iets hogere rente."

---

### Voorbeeld 6: Opzet Hypotheek - Specifieke Woning (Starter)

**Gebruiker vraagt:**
> "Ik heb een woning gevonden van €315.000. Kan ik dit kopen? Ik verdien €55.000, ben 29 jaar, en heb €15.000 spaargeld."

**Tool call:**

```json
{
  "tool": "opzet_hypotheek_starter",
  "arguments": {
    "inkomen_aanvrager": 55000,
    "geboortedatum_aanvrager": "1996-11-04",
    "heeft_partner": false,
    "verplichtingen_pm": 0,
    "eigen_vermogen": 15000,
    "nieuwe_woning": {
      "waarde_woning": 315000,
      "bedrag_verbouwen": 0,
      "bedrag_verduurzamen": 0,
      "kosten_percentage": 0.05,
      "energielabel": "B"
    }
  }
}
```

**Verwachte output:**

```
Benodigd bedrag:
- Woning: €315.000
- Kosten koper (5%): €15.750
- Totaal: €330.750

Financiering:
- Hypotheek: €315.750 (101% financiering)
- Eigen geld: €15.000
```

**Agent response:**

🏠 **OPZET HYPOTHEEK - STARTER**

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 **TOTAAL BENODIGD BEDRAG**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🏡 Koopsom woning: €315.000
💼 Kosten koper: €15.750
─────────────────────────────────────────────
💰 **TOTAAL BENODIGD: €330.750**

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💵 **FINANCIERING**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🏦 Hypotheek: €315.750
💎 Eigen geld: €15.000
─────────────────────────────────────────────
💵 **TOTAAL FINANCIERING: €330.750**

✅ **Balans: Financiering dekt benodigd bedrag** ✓

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 **MAANDLASTEN**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

💰 **Bruto maandlast: €1.450/maand**

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 **PRAKTISCHE TOELICHTING**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️ U financiert 101% (boven de woningwaarde). Dit betekent geen NHG. 
   Overweeg meer eigen geld in te brengen.
💡 Tip: Breng €20.000 eigen geld in om onder 100% te blijven en NHG te krijgen.

---

### Voorbeeld 7: Opzet Hypotheek met Verbouwing

**Gebruiker vraagt:**
> "Woning van €275.000, maar moet €30.000 verbouwen en €15.000 verduurzamen (naar A+++). Heb €25.000 eigen geld. Kan dit?"

**Tool call:**

```json
{
  "tool": "opzet_hypotheek_starter",
  "arguments": {
    "inkomen_aanvrager": 65000,
    "geboortedatum_aanvrager": "1988-11-04",
    "heeft_partner": false,
    "verplichtingen_pm": 0,
    "eigen_vermogen": 25000,
    "nieuwe_woning": {
      "waarde_woning": 275000,
      "bedrag_verbouwen": 30000,
      "bedrag_verduurzamen": 15000,
      "kosten_percentage": 0.05,
      "energielabel": "A+++"
    }
  }
}
```

**Agent response:**

> "✅ **Dit is financierbaar!**
> 
> 💰 **Totaal benodigd:**
> - Woning: €275.000
> - Verbouwing: €30.000
> - Verduurzaming: €15.000
> - Kosten koper: €13.750
> - **Totaal: €333.750**
> 
> 💳 **Financiering:**
> - Hypotheek: €308.750
> - Uw eigen geld: €25.000
> 
> ⚡ **Voordeel energielabel A+++:**
> Door te verduurzamen naar A+++ krijgt u ongeveer €12.000 extra leencapaciteit. Dit compenseert grotendeels de verduurzamingskosten!
> 
> 📊 **Maandlasten:** ongeveer €1.425
> 
> **Tip:** U kunt ook in fases verbouwen als u de kosten wilt spreiden."

---

### Voorbeeld 8: Doorstromer Opzet - Specifieke Nieuwe Woning

**Gebruiker vraagt:**
> "Nieuwe woning is €425.000. Huidige woning €340.000 waard met €160.000 schuld. Kan ik dit?"

**Tool call:**

```json
{
  "tool": "opzet_hypotheek_doorstromer",
  "arguments": {
    "inkomen_aanvrager": 72000,
    "geboortedatum_aanvrager": "1982-11-04",
    "heeft_partner": false,
    "verplichtingen_pm": 0,
    "eigen_vermogen": 0,
    "waarde_huidige_woning": 340000,
    "bestaande_hypotheek": {
      "leningdelen": [
        {
          "huidige_schuld": 160000,
          "huidige_rente": 0.029,
          "resterende_looptijd_in_maanden": 180,
          "rentevasteperiode_maanden": 36,
          "hypotheekvorm": "annuiteit"
        }
      ]
    },
    "nieuwe_woning": {
      "waarde_woning": 425000,
      "bedrag_verbouwen": 0,
      "bedrag_verduurzamen": 0,
      "kosten_percentage": 0.05
    }
  }
}
```

**Agent response:**

🏠 **OPZET HYPOTHEEK - DOORSTROMER**

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 **TOTAAL BENODIGD BEDRAG**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🏡 Koopsom woning: €425.000
💼 Kosten koper: €21.250
─────────────────────────────────────────────
💰 **TOTAAL BENODIGD: €446.250**

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💵 **FINANCIERING**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔄 Bestaande hypotheek (over te sluiten): €160.000
🆕 Nieuwe hypotheek (extra): €266.250
📈 Overwaarde huidige woning: €180.000
─────────────────────────────────────────────
💵 **TOTAAL FINANCIERING: €446.250**

✅ **Balans: Financiering dekt benodigd bedrag** ✓

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 **MAANDLASTEN**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔄 Bestaande hypotheek: €780/maand
🆕 Nieuwe hypotheek (extra): €1.235/maand
─────────────────────────────────────────────
💰 **TOTAAL MAANDLAST: €2.015/maand**

📈 **Stijging maandlast: +€455/maand**

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 **PRAKTISCHE TOELICHTING**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✓ U heeft een substantiële overwaarde van €180.000. Dit geeft u ruimte voor de nieuwe woning of als buffer.
⚠️ Nieuwe maandlast is substantieel (€2.015). Zorg dat dit binnen uw budget past.

---

### Voorbeeld 8B: Output Formatting Best Practices

**Belangrijk:** De verbeterde output in v4.1+ geeft automatisch een gestructureerd overzicht. Zorg dat je dit aan de gebruiker toont en niet zelf gaat samenvatten.

**Wat de MCP server nu automatisch doet:**
- ✅ Totalen berekenen (benodigd bedrag + financiering)
- ✅ Balans check (klopt de som?)
- ✅ Maandlasten breakdown (bestaand vs nieuw)
- ✅ Context-aware tips en waarschuwingen

**DO's:**
✅ Toon de volledige output van de tool  
✅ Voeg eventueel een korte samenvatting toe aan het BEGIN  
✅ Benadruk belangrijke cijfers (bijv. totale maandlast)  
✅ Vraag door op basis van de praktische tips in de output

**DON'Ts:**
❌ Probeer NIET de output zelf te herschrijven  
❌ Laat GEEN delen weg (bijv. de maandlasten breakdown)  
❌ Voeg GEEN eigen berekeningen toe die afwijken van de tool  
❌ Negeer de praktische toelichtingen niet

**Voorbeeld goede response:**

> Op basis van uw wensen heb ik een complete opzet gemaakt. Hier is het overzicht:
>
> [VOLLEDIGE TOOL OUTPUT]
>
> **Mijn aanbeveling:** De berekening laat zien dat u een overwaarde heeft van €240.000. 
> Ik raad aan om hiervan €40.000 te reserveren als buffer, zodat u niet alle overwaarde 
> direct in de nieuwe woning stopt. Wat vindt u daarvan?

---

### Voorbeeld 9: Actuele Rentes Opvragen

**Gebruiker vraagt:**
> "Wat zijn de huidige hypotheekrente tarieven?"

**Tool call:**

```json
{
  "tool": "haal_actuele_rentes_op",
  "arguments": {}
}
```

**Verwachte output:**

```json
{
  "NHG": {
    "5_jaar": 3.15,
    "10_jaar": 3.45,
    "20_jaar": 3.89,
    "30_jaar": 4.12
  },
  "Niet_NHG": {
    "5_jaar": 3.42,
    "10_jaar": 3.75,
    "20_jaar": 4.18,
    "30_jaar": 4.45
  },
  "datum": "2025-11-03"
}
```

**Agent response:**

> "📊 **Actuele hypotheekrente tarieven** (03-11-2025)
> 
> **Met NHG:**
> - 5 jaar vast: 3.15%
> - 10 jaar vast: 3.45%
> - 20 jaar vast: 3.89%
> - 30 jaar vast: 4.12%
> 
> **Zonder NHG:**
> - 5 jaar vast: 3.42%
> - 10 jaar vast: 3.75%
> - 20 jaar vast: 4.18%
> - 30 jaar vast: 4.45%
> 
> **Toelichting:**
> - NHG rente is 0.25-0.35% lager
> - Langere rentevaste periode = hogere rente
> - Meest gekozen: 10 jaar vast (balans tussen zekerheid en rente)"

---

### Voorbeeld 10: Error Recovery - Validatie Fout

**Gebruiker geeft foutieve input:**
> "Ik ben 16 jaar en verdien €50.000"

**Tool call probeert:**

```json
{
  "tool": "bereken_hypotheek_starter",
  "arguments": {
    "inkomen_aanvrager": 50000,
    "geboortedatum_aanvrager": "2009-11-04",
    "heeft_partner": false,
    "verplichtingen_pm": 0
  }
}
```

**Error response:**

```json
{
  "error": "Validatiefout",
  "code": "INVALID_DATE_FORMAT",
  "message": "geboortedatum_aanvrager is geen geldige datum",
  "field": "geboortedatum_aanvrager",
  "details": {
    "value": "2010-02-30"
  }
}
```

**Agent recovery:**

> "❌ Er is een probleem met de ingevoerde geboortedatum.
> 
> De datum 2010-02-30 bestaat niet. Wat is uw leeftijd of geboortedatum, zodat ik de berekening kan afronden? Als u alleen uw leeftijd weet, reken ik die intern om."

---

## Error Handling

### Veelvoorkomende Errors en Oplossingen

#### 1. INCOME_OUT_OF_RANGE

**Error:**
```json
{
  "code": "INCOME_OUT_OF_RANGE",
  "message": "Inkomen moet tussen €0 en €1.000.000 liggen"
}
```

**Oorzaak:**
- Negatief inkomen
- Inkomen >€1M (boven systeemgrens)

**Oplossing:**
```
✅ Verifieer bedrag met gebruiker
✅ Check of het bruto jaarinkomen is (niet maand/netto)
✅ Voor inkomen >€1M: "Boven €1M zijn andere regels van toepassing, 
   raadpleeg een hypotheekadviseur"
```

---

#### 2. INVALID_DATE_FORMAT

**Error:**
```json
{
  "code": "INVALID_DATE_FORMAT",
  "message": "Gebruik YYYY-MM-DD formaat"
}
```

**Oorzaak:**
- Datum in verkeerd formaat (DD-MM-YYYY, DD/MM/YYYY, etc.)

**Oplossing:**
```
✅ Geef aan dat de ontvangen datum ongeldig is en stel opnieuw de vraag: "Wat is uw leeftijd of geboortedatum?"
✅ Accepteer een leeftijd als antwoord en reken die intern om naar een ISO-geboortedatum zonder dit terug te koppelen.
✅ Vraag alleen extra verduidelijking als de gebruiker een onmogelijk datumjaar noemt (bijv. toekomstig); noem geen technische formaten.
```

---

#### 4. RENTEVAST_EXCEEDS_LOOPTIJD

**Error:**
```json
{
  "code": "RENTEVAST_EXCEEDS_LOOPTIJD",
  "message": "Rentevaste periode kan niet langer zijn dan looptijd"
}
```

**Oorzaak:**
- Bij doorstromer: rentevast > resterende looptijd

**Oplossing:**
```
✅ Check invoer: "Hoeveel jaar rentevast heeft u NOG?"
✅ Niet de originele rentevast periode, maar wat er nog over is
✅ Voorbeeld: 10 jaar vast afgesloten, 3 jaar geleden → NOG 7 jaar (84 maanden)
```

---

#### 5. API_TIMEOUT

**Error:**
```json
{
  "code": "API_TIMEOUT",
  "message": "API request timed out",
  "retry_after_ms": 5000
}
```

**Oorzaak:**
- Backend reageert niet binnen 30s
- Netwerk problemen

**Oplossing:**
```
✅ Retry na 5 seconden
✅ Max 3 retries
✅ Communiceer naar gebruiker: "Even geduld, systeem is traag..."
```

---

#### 6. API_RATE_LIMIT

**Error:**
```json
{
  "code": "API_RATE_LIMIT",
  "message": "Rate limit exceeded. Max 100 requests per minute",
  "retry_after_ms": 35000
}
```

**Oorzaak:**
- Te veel requests in korte tijd (>100 per minuut)

**Oplossing:**
```
✅ Wacht retry_after_ms milliseconden
✅ Communiceer: "Momenteel veel drukte, even geduld..."
✅ Niet automatisch retrying - kan snowball effect veroorzaken
```

---

## Best Practices

### Do's ✅

1. **Altijd valideren voor tool call**
   ```typescript
   // Check age
   if (age < 18 || age > 75) {
     return "Leeftijd moet tussen 18-75 jaar zijn";
   }
   
   // Check income
   if (income < 0 || income > 1_000_000) {
     return "Inkomen moet tussen €0-€1M zijn";
   }
   ```

2. **Rente ALTIJD als decimaal**
   ```typescript
   ✅ 0.0372  // 3.72%
   ❌ 3.72    // Wordt gezien als 372%!
   ❌ "3.72%" // String werkt niet
   ```

3. **Looptijd ALTIJD in maanden**
   ```typescript
   ✅ 240     // 20 jaar
   ❌ 20      // Wordt gezien als 20 maanden!
   
   // Conversie hulp:
   jaren × 12 = maanden
   ```

4. **Contextbehoud bij multi-turn**
   ```typescript
   // Gebruik session_id voor correlation
   {
     "session_id": "uuid-from-n8n-trigger",
     ...
   }
   ```

5. **Duidelijke user feedback**
   ```typescript
   // ✅ GOED
   "Met uw inkomen van €50.000 kunt u tot €220.000 lenen"
   
   // ❌ SLECHT
   "Maximale hypotheek: 220000"
   ```
6. **Vraag leeftijd of geboortedatum op de juiste manier**
   ```typescript
   ✅ "Wat is uw leeftijd of geboortedatum?"
   ✅ "Dank u, met 45 jaar kan ik direct rekenen."
   ❌ "Mag ik uw geboortedatum in YYYY-MM-DD? U bent 45 jaar dus vermoedelijk 1979-xx-xx."
   ```
7. **Gebruik MCP-resultaten letterlijk bij doorstromers (in beide tools)**
   ```typescript
   ✅ Toon (in zowel `bereken_hypotheek_doorstromer` als `bereken_hypotheek_uitgebreid`) max_woningbudget, overwaarde_bedrag, maandlast_nu, maandlast_straks zoals de API ze teruggeeft
   ❌ Zelf max hypotheek = overwaarde + extra_leencapaciteit herberekenen (MCP doet dit al)
   ✅ Alleen formatteren (euroteken, duizendtallen) is toegestaan
   ```
8. **Altijd `session_id` meesturen**
   ```typescript
   ✅ payload.session_id = {{ $json.sessionId }}
   ❌ "session_id": null // agent vergat de waarde door te geven
   ✅ Zonder verdere vragen naar de gebruiker kopiëren vanuit de n8n trigger
   ```

### Don'ts ❌

1. **Geen vage vragen**
   ```typescript
   ❌ "Wat is uw situatie?"
   ✅ "Wat is uw bruto jaarinkomen?"
   ```

2. **Niet gokken bij ontbrekende data**
   ```typescript
   ❌ // Assume partner inkomen = 0
   ✅ // Ask: "Hoeveel verdient uw partner?"
   ```

3. **Geen complexe tool bij simple case**
   ```typescript
   ❌ bereken_hypotheek_uitgebreid // Voor simpele starter
   ✅ bereken_hypotheek_starter    // Simpeler is beter
   ```

4. **Niet direct retry bij rate limit**
   ```typescript
   ❌ // Immediate retry loop
   ✅ // Wait retry_after_ms, inform user
   ```

5. **Geen PII in logs**
   ```typescript
   ❌ logger.info("Inkomen: 50000, geboortedatum: 1990-05-15")
   ✅ logger.info("Berekening gestart", { session_id: "..." })
   ```
6. **Niet vragen naar beide deurstromer invoerpaden tegelijk**
   ```typescript
   ❌ "Geef nu alle leningdelen en ook even een samenvatting"
   ✅ "Wilt u een snelle globale berekening of een detailberekening met alle leningdelen?"
   ```

---

## Troubleshooting

### Scenario 1: "Berekening geeft onverwacht laag bedrag"

**Check:**
1. ✅ Is inkomen bruto JAAR inkomen? (niet maand/netto)
2. ✅ Zijn verplichtingen per MAAND? (niet jaar)
3. ✅ Bij doorstromer: klopt de huidige schuld?

**Voorbeeld probleem:**
```json
// ❌ FOUT - maandinkomen ipv jaarinkomen
{
  "inkomen_aanvrager": 4200, // Dit is per maand!
  ...
}

// ✅ GOED
{
  "inkomen_aanvrager": 50400, // 4200 × 12 = jaarinkomen
  ...
}
```

---

### Scenario 2: "API timeout errors"

**Check:**
1. ✅ Is request niet te complex? (>10 leningdelen)
2. ✅ Is backend bereikbaar?
3. ✅ Implementeer retry logic

**Code voorbeeld:**
```typescript
let retries = 0;
while (retries < 3) {
  try {
    return await toolCall();
  } catch (error) {
    if (error.code === 'API_TIMEOUT' && retries < 2) {
      retries++;
      await sleep(5000); // 5 sec
      continue;
    }
    throw error;
  }
}
```

---

### Scenario 3: "Validatie errors na update"

**Check:**
1. ✅ Is de server versie 4.0+?
2. ✅ Zijn enums exact gespeld? (case-sensitive!)
3. ✅ Zijn units correct? (maanden niet jaren)

**Common fixes:**
```typescript
// Energielabel
❌ "a+++"
✅ "A+++"

// Hypotheekvorm
❌ "annuïteit"  // accent!
✅ "annuiteit"

// Rente
❌ 3.5  // te hoog
✅ 0.035
```

---

## Appendix A: Parameter Cheatsheet

| Parameter | Type | Format | Voorbeeld | Validatie |
|-----------|------|--------|-----------|-----------|
| `inkomen_aanvrager` | number | Bruto jaar | `50000` | 0 - 1M |
| `geboortedatum_aanvrager` | string | YYYY-MM-DD | `"1990-05-15"` | Age 18-75 |
| `heeft_partner` | boolean | - | `true` | - |
| `inkomen_partner` | number | Bruto jaar | `40000` | 0 - 1M |
| `verplichtingen_pm` | number | Per maand | `250` | 0 - 50K |
| `waarde_huidige_woning` | number | Euro's | `350000` | 50K - 5M |
| `huidige_schuld` | number | Euro's | `180000` | 0 - 5M |
| `huidige_rente` | number | Decimaal | `0.032` | 0.0 - 0.20 |
| `resterende_looptijd_in_maanden` | number | Maanden | `240` | 1 - 360 |
| `rentevasteperiode_maanden` | number | Maanden | `120` | 0 - 360 |
| `hypotheekvorm` | string | Enum | `"annuiteit"` | 3 types |
| `energielabel` | string | Enum | `"A+++"` | A++++ - G |

---

## Appendix B: Response Interpretation

### Maximale Hypotheek Response

```json
{
  "resultaat": [{
    "maximaal_bedrag": 220000,           // ← Dit is het antwoord
    "bruto_maandlasten_nieuwe_lening": 1015,
    "resultaat_omschrijving": "Met NHG",
    "gebruikte_hypotheekgegevens": {
      "nhg_toegepast": true,
      "energielabel": "B",
      "opzet_nieuwe_hypotheek": [{
        "rente": 0.0345,
        "looptijd_maanden": 360,
        "hypotheekvorm": "annuiteit"
      }]
    }
  }]
}
```

**Interpretatie voor gebruiker:**
> "U kunt maximaal €220.000 lenen met een maandlast van €1.015"

### Opzet Hypotheek Response

```json
{
  "resultaat": {
    "Benodigd_bedrag": {
      "Woning_koopsom": 300000,
      "Kosten": 15000,
      // Totaal: 315000
    },
    "Financiering": {
      "Hypotheek": 300000,
      "Eigen_geld": 15000
    },
    "bruto_maandlasten_nieuwe_lening": 1385
  }
}
```

**Interpretatie voor gebruiker:**
> "Deze woning van €300.000 is haalbaar. U financiert €300.000 en gebruikt €15.000 eigen geld. Maandlast: €1.385"

---

## Support & Updates

**Vragen of issues?**
- Check eerst deze playbook
- Kijk naar error codes in response
- Test met voorbeelden uit deze guide

**Updates:**
Deze playbook wordt bijgewerkt bij elke major release. Huidige versie: 5.0.0 (2025-11-04).

---

**© 2025 - Hypotheek MCP Server v4.0**
