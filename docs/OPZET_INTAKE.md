# Opzet Hypotheek Intake Guide

## Basisvelden (altijd vragen)
- `inkomen_aanvrager`: bruto jaarinkomen hoofdaanvrager (EUR)
- `geboortedatum_aanvrager`: interne ISO-datum. Vraag altijd: "Wat is uw leeftijd of geboortedatum?" en reken een opgegeven leeftijd zelf om.
- `heeft_partner`: true/false
- `inkomen_partner` & `geboortedatum_partner`: alleen invullen bij een meedoende partner (zelfde leeftijd/geboortedatum-vraag; afgeleide datum blijft intern)
- `verplichtingen_pm`: maandelijkse verplichtingen (default 0)
- **Doorstromer keuzevraag (voor zowel `bereken_hypotheek_doorstromer`, `bereken_hypotheek_uitgebreid` met doorstromer-invoer als alle opzet-doorstromer tools):** vraag altijd: _"Wilt u een snelle globale berekening (met een samenvatting van uw hypotheek) of een detailberekening waarbij u alle leningdelen invoert?"_. Vul bij de globale route één samenvattend leningdeel, en bij de detailroute alle losse leningdelen.

## Optioneel maar vaak nuttig
- `eigen_vermogen`: beschikbaar spaargeld/gift (default 0)
- `session_id`: **altijd** vullen met de n8n-variabele `sessionId` uit de stap *When chat message received* voor logging en rate limiting

## Nieuwe woning
- `nieuwe_woning.waarde_woning` (verplicht)
- `bedrag_verbouwen`, `bedrag_verduurzamen`: defaults 0
- `kosten_percentage`: default 0.05 (5%)
- `energielabel`: exacte string uit de lijst (optioneel)

## Doorstromer-specifiek
- `waarde_huidige_woning`: marktwaarde huidige woning
- `bestaande_hypotheek.leningdelen[]` met:
  - `huidige_schuld`, `huidige_rente` (decimaal), `resterende_looptijd_in_maanden`, `rentevasteperiode_maanden`, `hypotheekvorm`

## Maatwerk (tool `opzet_hypotheek_uitgebreid`)
- `is_doorstromer`: true/false voor routing
- `nieuwe_lening.looptijd_jaren`, `rentevast_periode_jaren`, `nhg` (defaults 30 / 10 / false)
- `nieuwe_lening.renteklassen[]`: optioneel voor custom rentetabellen
- `nieuwe_hypotheek`: vrije container voor aanvullende velden of aanbiederspecifieke info

## Aanpak in het gesprek
1. Verzamel basisintake + scenario (starter vs doorstromer).
2. Raadpleeg deze guide om ontbrekende velden in te vullen of defaults te bevestigen.
3. Gebruik de juiste tool:
   - `opzet_hypotheek_starter` voor starters
   - `opzet_hypotheek_doorstromer` voor klanten met verkoop van huidige woning
   - `opzet_hypotheek_uitgebreid` voor maatwerkparameters
4. Bevestig naar de klant welke aannames en defaults zijn gebruikt.
