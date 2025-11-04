# Configuratiehandleiding

| Variabele | Verplicht | Default | Omschrijving |
|-----------|-----------|---------|--------------|
| `REPLIT_API_KEY` | ✅ | – | API sleutel voor de hypotheekberekeningsservice. |
| `REPLIT_API_URL_BASE` | ❌ | `https://digital-mortgage-calculator.replit.app` | Basis-URL van de externe API. |
| `LOG_LEVEL` | ❌ | `info` | Logniveau (`debug`, `info`, `warn`, `error`). |
| `NODE_ENV` | ❌ | `development` | Applicatieomgeving. |
| `API_TIMEOUT_MS` | ❌ | `30000` | Timeout voor outbound API-calls (ms). |
| `ENABLE_RETRY` | ❌ | `true` | Schakel automatische retries in/uit. |
| `MAX_RETRIES` | ❌ | `3` | Maximaal aantal retry pogingen. |
| `RATE_LIMIT_PER_SESSION` | ❌ | `100` | Verzoeken per minuut per sessie. |

## Voorbeeld `.env`

```env
REPLIT_API_KEY=your-api-key
LOG_LEVEL=info
API_TIMEOUT_MS=30000
ENABLE_RETRY=true
MAX_RETRIES=3
RATE_LIMIT_PER_SESSION=100
```

In testomgevingen mag `REPLIT_API_KEY` ontbreken; de server gebruikt dan automatisch `test-replit-api-key`.
