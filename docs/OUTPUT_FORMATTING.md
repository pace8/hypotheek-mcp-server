# Output Formatting Guide

## Doel
Deze guide helpt AI agents om de output van hypotheek berekeningen op de juiste manier te presenteren aan eindgebruikers.

## Belangrijkste Principe
**De MCP tools geven al perfect geformatteerde output. Toon deze VOLLEDIG.**

## Voor Opzet Hypotheek Tools

### ✅ GOED: Volledige Output Tonen

```
Gebruiker: "Kan ik die woning van €400.000 kopen?"

Agent: "Ik heb een complete opzet gemaakt op basis van uw situatie. Hier is het overzicht:

🏠 **OPZET HYPOTHEEK - DOORSTROMER**

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 **TOTAAL BENODIGD BEDRAG**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[... volledige tool output ...]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 **PRAKTISCHE TOELICHTING**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✓ U heeft een substantiële overwaarde van €240.000
[...]

**Mijn aanbeveling:** Op basis van deze cijfers is de woning haalbaar. 
Wel raad ik aan om €20.000 van uw overwaarde als buffer aan te houden. 
Wat vindt u van dit plan?"
```

### ❌ FOUT: Output Samenvatten

```
Agent: "Ja, u kunt deze woning kopen. U heeft €240.000 overwaarde 
en de maandlast wordt €2.000."
```

**Waarom fout:**
- Mist cruciale details (breakdown, balans check)
- Geen context over bestaande vs nieuwe hypotheek
- Praktische tips worden niet getoond

## Voor Maximale Hypotheek Tools

### ✅ GOED: Compleet Overzicht

```
Agent: "Op basis van uw inkomen en situatie kunt u:

🏠 **HYPOTHEEKBEREKENING VOOR STARTER**

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 **Met NHG**
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[... volledige tool output ...]

Let op: Het verschil tussen met en zonder NHG is €10.000. 
NHG geeft u ook extra zekerheid. Wilt u meer weten over de voorwaarden?"
```

## Vervolgvragen

Na het tonen van de output, gebruik de informatie erin voor vervolgvragen:

**Voorbeelden:**
- "Ik zie dat uw maandlast met €500 stijgt. Past dit binnen uw maandbudget?"
- "De praktische toelichting suggereert verduurzaming. Heeft u daar interesse in?"
- "Er is een balans check: alles klopt. Wilt u de volgende stap zetten?"

## Sectie-Referenties

Verwijs naar specifieke secties bij vervolgvragen:

```
"Zoals u in de sectie 'Maandlasten' ziet, komt uw nieuwe maandlast op €2.000. 
Dit is een stijging van €500 ten opzichte van uw huidige situatie..."
```

## Samenvattingen

Als de gebruiker vraagt om een samenvatting:

```
Agent: "Samengevat:
- Totaal benodigd: €460.000
- U financiert dit met: bestaande hypotheek (€150K), nieuwe hypotheek (€50K), 
  overwaarde (€240K) en eigen geld (€20K)
- Nieuwe maandlast: €2.000 (+€1.000 stijging)
- Advies: Reserveer buffer van €20.000

Voor de volledige details, zie hierboven het complete overzicht."
```
