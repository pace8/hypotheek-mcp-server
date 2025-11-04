# Opzet Hypotheek Intake Guide

## Basisvelden (altijd vragen)
- `inkomen_aanvrager`: bruto jaarinkomen hoofdaanvrager (EUR)
- `geboortedatum_aanvrager`: YYYY-MM-DD (reken leeftijd desnoods om)
- `heeft_partner`: true/false
- `inkomen_partner` & `geboortedatum_partner`: alleen invullen bij een meedoende partner
- `verplichtingen_pm`: maandelijkse verplichtingen (default 0)

## Optioneel maar vaak nuttig
- `eigen_vermogen`: beschikbaar spaargeld/gift (default 0)
- `session_id`: doorgegeven vanuit n8n voor logging en rate limiting

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
