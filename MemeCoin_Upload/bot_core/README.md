# 🚀 Solana Meme Coin Monitor & Trading Bot 24/7 (Multi-User Edition)

BotDiscord automatizzato per il monitoraggio ed il trading ad alta velocità di **Meme Coin su Solana** con supporto **Multi-Utente**, crittografia **AES-256-GCM** e filtro avanzato di sicurezza.

---

### 🛡️ Privacy e Gestione Multi-Utente

1. **Risposte Ephemeral (Private)**:  
   Tutti i comandi relativi alle chiavi o al wallet (`/wallet register`, `/wallet info`, `/wallet remove`, `/autotrade`, `/budget`) restituiscono **risposte ephemere su Discord** (visibili **esclusivamente all'utente che esegue il comando**). Nessun altro utente, amministratore o proprietario del server può vedere la tua chiave o i tuoi dati!

2. **Crittografia AES-256-GCM a Riposo**:  
   Le chiavi private vengono cifrate nel database locale (`data/users.json`) mediante il modulo nativo `crypto` (AES-256-GCM con IV dinamico e Tag di Autenticazione).

3. **Trading Automatico Indipendente**:  
   Ogni utente abilitato (`/autotrade enable:true`) partecipa automaticamente agli acquisti sui token idonei rilevati dal bot, entro i propri limiti personali di spesa (`maxSolPerTrade` e `maxSolPerDay`).

---

### 🎮 Comandi Slash Multi-Utente

| Comando Slash | Descrizione | Visibilità |
|---|---|---|
| `/buy` | **Pannello Interattivo 1-Clic**: Bottoni rapidi per acquistare €20, €50, €100, €200 SOL | 🔒 **Ephemero (Privato)** |
| `/menu` | **Pannello di Controllo**: Bottoni per Saldo Wallet, Pausa/Attiva Trade e Token Idonei | 🔒 **Ephemero (Privato)** |
| `/topup importo_eur:<num>` | Acquista SOL tramite Switchere con scomposizione trasparente delle fee | 🔒 **Ephemero (Privato)** |
| `/wallet register key:<key>` | Registra la tua chiave privata Solana in modo cifrato (AES-256) | 🔒 **Ephemero (Privato)** |
| `/wallet info` | Mostra il tuo indirizzo pubblico, saldo SOL ed impostazioni attive | 🔒 **Ephemero (Privato)** |
| `/wallet remove` | Rimuove e cancella definitivamente la tua chiave dal database | 🔒 **Ephemero (Privato)** |
| `/autotrade enable:<bool>` | Attiva o metti in pausa il trading automatico per il tuo account | 🔒 **Ephemero (Privato)** |
| `/budget trade_limit:<sol>` | Personalizza la dimensione massima dei tuoi trade ed il budget giornaliero | 🔒 **Ephemero (Privato)** |
| `/status` | Mostra lo stato generale del sistema ed il numero di utenti attivi | 🌐 Pubblico |
| `/config` | Visualizza le soglie di liquidità, volume e filtri di sicurezza attivi | 🌐 Pubblico |
| `/proxies` | Mostra lo stato del Proxy Manager e il pool di proxy verificati | 🌐 Pubblico |
| `/candidates` | Elenca gli ultimi token idonei rilevati | 🌐 Pubblico |
| `/killswitch` | Permette all'Owner di attivare/disattivare il blocco d'emergenza generale | 🌐 Pubblico (Owner) |
| `/help` | Guida completa ed elenco dei comandi | 🌐 Pubblico |

---

### ⚙️ Requisiti ed Avvio

1. Assicurati che il file `.env` contenga il `DISCORD_TOKEN` del tuo bot.
2. Per avviare il bot in modalità interattiva:
   ```cmd
   START_BOT.bat
   ```
3. Per eseguirlo 24/7 in sottofondo:
   ```cmd
   START_BOT_BACKGROUND.bat
   ```
