# DOCUMENTAZIONE COMPLETA DEL PROGETTO: SOLANA MEME COIN MONITOR & TRADING BOT 24/7

---

## 1. PANORAMICA DEL SISTEMA

Il **Solana Meme Coin Monitor & Trading Bot 24/7** è una piattaforma di monitoraggio ed esecuzione automatizzata ad alte prestazioni progettata per il mercato delle Meme Coin sulla blockchain Solana.

Il sistema combina un motore di ricerca di token in momentum a bassa latenza, filtri di sicurezza fail-safe contro le truffe (RugCheck), gestione rigorosa del rischio finanziario, esecuzione di swap tramite Jupiter API v6, ed una suite completa di comandi ed interfacce interattive su Discord sia per il Trading Reale che per il Trading in Simulazione (Trial Mode).

---

## 2. STRUTTURA DETTAGLIATA DEI MODULI E DEI FILE

### `src/index.js` - Punto di Ingresso Principale
- Inizializza la configurazione del sistema (`validateConfig`).
- Avvia il **Proxy Manager** per il caricamento ed il controllo reattività dei nodi proxy.
- Istanzia il **DEX Monitor** per il tracciamento continuo delle coppie di scambio Solana.
- Connette la pipeline asincrona disaccoppiata tramite **EventBus**:
  - Ogni nuovo candidato rilevato dal DEX viene inviato a `checkTokenSafety`.
  - Se il controllo di sicurezza supera i criteri, attiva l'esecuzione reale (`tradeExecutor.executeTrade`) e l'auto-trade in simulazione per gli utenti in Trial Mode (`paperTradingEngine.executePaperBuy`).
- Collega ed avvia il **Discord Client** per la gestione del server e delle interazioni utente.

### `src/config.js` - Gestione Variabili di Ambiente e Parametri
- Carica ed assicura le variabili dal file `.env`.
- Definisce i parametri operativi chiave:
  - `RPC_ENDPOINT`: Endpoint Solana RPC (Mainnet).
  - `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_OWNER_ID`.
  - `SOLANA_PRIVATE_KEY`: Chiave primaria per operazioni del server.
  - `DRY_RUN`: Flag booleano per abilitare/disabilitare le transazioni reali on-chain.
  - `MAX_SOL_PER_TRADE` e `MAX_SOL_PER_DAY`: Limiti globali di rischio.
  - `MIN_LIQUIDITY_USD`, `DEX_MIN_VOLUME_24H_USD`, `MIN_RUGCHECK_SCORE`, `SLIPPAGE_BPS`.
  - `WALLET_ENCRYPTION_SECRET`: Chiave segreta a 32 byte per la cifratura dei wallet.

### `src/events.js` - Bus di Eventi Asincrono Disaccoppiato
- Istanzia un `EventEmitter` centrale (`eventBus`).
- Permette il passaggio di eventi in tempo reale tra i vari moduli senza accoppiamento diretto:
  - `candidate`: Rilevamento token dal DEX.
  - `rugcheck`: Esito della verifica di sicurezza.
  - `trade`: Risultato dell'ordine simulato o reale.
  - `trial-sell`: Chiusura automatica di posizioni in simulazione.

### `src/proxyManager.js` - Gestione Nodi Proxy e Rotazione Network
- Effettua lo scraping e la validazione automatica di liste proxy HTTP/HTTPS gratuite in background.
- Mantiene una lista di nodi verificati ed attivi (`workingProxies`).
- Implementa la rotazione Round-Robin per le richieste HTTP outgoing per evitare limitazioni di frequenza (HTTP 429) dalle API pubbliche di DexScreener e RugCheck.

### `src/dexMonitor.js` - Monitoraggio 24/7 dei Mercati Solana DEX
- Interroga periodicamente i feed di mercato DexScreener a intervalli di 15 secondi.
- Filtra i token sulla blockchain Solana che soddisfano i criteri minimi:
  - Liquidità in pool >= `$5.000` (configurabile).
  - Volume nelle 24 ore >= `$10.000` (configurabile).
- Mantiene la memoria dei token già analizzati per prevenire analisi ridondanti.
- Invia i candidati idonei sul bus di eventi.

### `src/rugCheck.js` - Motivo Fail-Safe di Sicurezza Anti-Rugpull
- Interroga l'API di analisi contratti RugCheck (`https://api.rugcheck.xyz/v1/tokens/{mint}/report`).
- Verifica i rischi strutturali del contratto Solana:
  - Presenza di autorità di Minting non azzerate.
  - Possibilità di Freeze dell'account token.
  - Liquidità sbloccata o concentrata in singole balene.
- Risultato Fail-Safe: Se l'API di RugCheck è non raggiungibile o restituisce errori HTTP, il token viene bocciato automaticamente per sicurezza.

### `src/riskManager.js` - Controllo del Rischio e Limiti Finanziari
- Traccia la spesa accumulata in SOL sia a livello di sistema che per singolo utente.
- Blocca gli ordini che superano:
  - Il limite massimo per singolo trade (es. 0.05 SOL).
  - Il budget massimo giornaliero (es. 0.20 SOL).
- Gestisce il **Kill Switch d'emergenza** attivabile dall'amministratore per bloccare istantaneamente tutte le operazioni di acquisto.

### `src/tradeExecutor.js` - Esecuzione Ordini Live & Simulazioni On-Chain
- Gestisce l'interazione con l'aggregatore **Jupiter Swap API v6** (`https://quote-api.jup.ag/v6`).
- **Verifica Pre-Flight Saldo SOL**: Prima di inviare una transazione reale, controlla il bilancio on-chain del wallet. Se il saldo è insufficiente (< importo + fee di rete), emette un avviso pulito senza causare fallimenti RPC di simulazione.
- Se `DRY_RUN` è attivo, simula la quotazione e la ricezione token senza firmare la transazione.
- Se `DRY_RUN` è disattivato e il wallet è alimentato, firma invia la transazione reale ed emette l'hash transazione su Solscan.

### `src/userDatabase.js` - Gestione Database Utenti e Cifratura Wallet (AES-256-GCM)
- Gestisce la persistenza del database utenti su `data/users.json`.
- Cifra la chiave privata Solana di ogni utente utilizzando l'algoritmo **AES-256-GCM** con vettore di inizializzazione (IV) unico e Auth Tag.
- Assicura che le chiavi private non vengano mai scritte in chiaro nel file di testo o mostrate nelle chat.

### `src/switchereService.js` - Calcolo Trasparente e Link di Acquisto SOL
- Calcola la conversione Fiat (EUR) a Solana (SOL) sulla base dei prezzi live di CoinGecko.
- Scompone in modo trasparente la struttura delle commissioni:
  - Processing Fee Switchere: 3.9%.
  - Gateway Carta: ~1.1%.
- Genera il link ufficiale di acquisto diretto su Switchere (`https://switchere.com/?fiat=EUR&crypto=SOL&amount=...&destination=...`) con limite minimo configurato a 5 EUR.

### `src/paperTrading.js` - Motore di Simulazione (Trial Mode)
- Mantiene il database dei portafogli simulati in `data/paper_portfolios.json`.
- Ogni utente ha 1.00 Trial SOL virtuali iniziali per testare il sistema a rischio zero.
- **Esecuzione Automatica**: Inserisce acquisti in simulazione quando un token passa il controllo RugCheck.
- **Background Take-Profit / Stop-Loss Monitor**: Controlla ogni 15 secondi l'andamento dei prezzi su DexScreener. Se la posizione guadagna il +25%, chiude il trade in Take Profit; se scende del -15%, esegue lo Stop Loss.
- **Timer di Inattività (Inglese)**:
  - Notifica a 12 ore: Avvisa l'utente che il trial è attivo da 12h con i pulsanti Continue / Close.
  - Chiusura a 24 ore: Se l'utente non risponde entro 24 ore totali dall'avvio, liquida le posizioni e disattiva la sessione.

### `src/discordClient.js` - Interfaccia Discord, Canali ed Eventi
- Gestisce l'interazione completa con la libreria `discord.js`.
- **Registrazione Slash Commands Unica**: Svuota i comandi globali ed effettua la registrazione unica a livello di server (Guild Commands) per eliminare i comandi doppi nell'elenco di Discord.
- **Struttura Server Non Distruttiva**: Crea ed assicura la categoria `CURRENCIES` ed i canali `#general` ed `#important` senza mai cancellare canali, categorie o messaggi preesistenti dell'utente.
- **Canali Valuta Live (1 Solo Messaggio)**: Per ciascun token (es. `#happy-cat`), cancella i messaggi precedenti ad ogni tick di mercato, garantendo 1 solo messaggio sempre aggiornato con prezzo USD, liquidità, volume 5m e link al grafico.
- **Canale `#important`**: Invia avvisi ad alta convinzione per token eccezionali eliminando i duplicati precedenti relativi allo stesso contratto (`mint`).
- **Comandi Slash Implementati**:
  - `/buy [importo_eur]`: Apri il pannello o genera il link per un importo a scelta (minimo 5€).
  - `/trial [start|status|results|reset]`: Gestisci la simulazione, visualizza la tabella risultati/profitti o resetta il bilancio.
  - `/menu`: Pannello di controllo con bottoni interattivi.
  - `/wallet [register|info|remove]`: Gestione cifrata del wallet personale.
  - `/budget [trade_limit|daily_limit]`: Modifica i limiti di spesa.
  - `/status`, `/config`, `/proxies`, `/candidates`, `/killswitch`.

---

## 3. PASSO PER PASSO: FLUSSO DI FUNZIONAMENTO DEL SISTEMA

```
 +------------------+        +-------------------+        +-------------------+
 |  DexMonitor 24/7 | -----> | checkTokenSafety  | -----> |   RiskManager     |
 | (DexScreener API)|        |    (RugCheck)     |        | (Spesa & Budget)  |
 +------------------+        +-------------------+        +-------------------+
                                                                    |
                                                                    v
                                                          +-------------------+
                                                          |   TradeExecutor   |
                                                          |  (Jupiter Swap)   |
                                                          +-------------------+
                                                                    |
                                                +-------------------+-------------------+
                                                |                                       |
                                                v                                       v
                                     +---------------------+                 +---------------------+
                                     |   Live Trading      |                 | PaperTradingEngine  |
                                     | (On-Chain Solana)   |                 | (Trial Mode 24/7)   |
                                     +---------------------+                 +---------------------+
                                                |                                       |
                                                +-------------------+-------------------+
                                                                    |
                                                                    v
                                                         +---------------------+
                                                         |    DiscordClient    |
                                                         | (Canali & Notifiche)|
                                                         +---------------------+
```

1. **Avvio del Bot (`START_BOT.bat`)**:
   - Viene eseguito `node src/index.js`.
   - Il `proxyManager` valida ed attiva i proxy per proteggere la frequenza di rete.
   - Il `discordClient` pulisce i comandi globali ed assicura la struttura dei canali Discord.

2. **Scansione e Rilevamento DEX**:
   - `DexMonitor` legge le nuove coppie Solana ed individua i token in momentum.

3. **Verifica di Sicurezza Fail-Safe**:
   - `checkTokenSafety` valuta il contratto. Se RugCheck è KO o l'API non risponde, il token viene scartato.

4. **Tracciamento e Notifiche nei Canali Discord**:
   - Nel canale dedicato della valuta under `CURRENCIES`, il bot aggiorna l'unico messaggio live con prezzo, liquidità e volume.
   - Se il token rispetta criteri eccezionali, invia una notifica in `#important` rimuovendo duplicati precedenti dello stesso token.

5. **Esecuzione Ordini Reali (Live Trading)**:
   - Controlla il saldo del wallet `HboafrkZrYKkc7gjfJvKqF3RcdqxQHRuWdJkWY5D1PV7`.
   - Se il saldo SOL è sufficiente, richiede la quotazione a Jupiter Swap API v6 ed esegue lo swap.

6. **Esecuzione ed Gestione Simulazione (Trial Mode)**:
   - Se l'utente ha la modalità Trial attiva, `paperTradingEngine` inserisce l'ordine nei portafogli virtuali.
   - Il monitor in background gestisce il Take-Profit (+25%) e lo Stop-Loss (-15%) chiudendo il trade quando il prezzo varia.
   - Dopo 12 ore invia un reminder con i pulsanti Continue/Close; dopo 24 ore d'inattività chiude la sessione.

---

## 4. SUITE DI VERIFICA AUTOMATIZZATA (`test/verify.js`)

Il progetto include una suite di test unitari completa per verificare l'integrità del sistema senza eseguire transazioni reali non autorizzate:

1. Validazione della configurazione all'avvio.
2. Controllo blocco del Risk Manager per singolo trade.
3. Controllo accumulo spesa giornaliera del Risk Manager.
4. Funzionamento del Kill Switch d'emergenza.
5. Controllo Fail-Safe di RugCheck su API o contratti non validi.
6. Simulazione del Trade Executor in modalità DRY_RUN senza loggare chiavi private.

Per eseguire la verifica:
```bash
node test/verify.js
```

---

## 5. RECAPITOLAZIONE COMANDI ED USO

Per avviare il sistema è sufficiente fare doppio clic sul file **[START_BOT.bat](file:///C:/Users/franc/OneDrive/Desktop/MemeCoin/START_BOT.bat)**.
