<div align="center">

<img src="public/assets/icons/icon.png" alt="Icona di Altus +" width="96" />

# Altus +

**Più account WhatsApp in un'unica app desktop, sempre aggiornata.**

[![Ultima release](https://img.shields.io/github/v/release/lukethehawk/altus-plus?label=release)](https://github.com/lukethehawk/altus-plus/releases/latest)
[![Piattaforma](https://img.shields.io/badge/piattaforma-Windows%20x64-0078D6)](https://github.com/lukethehawk/altus-plus/releases/latest)
[![Licenza](https://img.shields.io/github/license/lukethehawk/altus-plus?label=licenza)](LICENSE)

[English](README.md) · **Italiano**

</div>

---

Altus + è un fork mantenuto di [**Altus**](https://github.com/amanharwara/altus) di [Aman Harwara](https://github.com/amanharwara): un'app Electron che racchiude WhatsApp Web, con una scheda per ogni account.

Il progetto originale non riceve più aggiornamenti. Altus + lo mantiene su una versione recente di Electron e aggiunge ciò che serve per usare ogni giorno più account. Le priorità sono **prima la sicurezza, poi la stabilità, poi il consumo di risorse**.

## In breve

| | |
|---|---|
| 👥 **Più account** | Una scheda per ogni account WhatsApp, ognuna con la propria sessione isolata. Per riordinarle, attiva Scheda → *Consenti di spostare le schede* e trascina una scheda sopra un'altra. |
| 🔔 **Notifiche chiare** | Il titolo della notifica indica l'account (`Lavoro · Mario Rossi`). Un clic apre la scheda e la chat giuste. |
| 🔕 **Silenzia per account** | Clic destro su una scheda per silenziarla per 1 ora, 8 ore o finché non la riattivi. Gli altri account continuano a notificare. |
| 📥 **Non letti a colpo d'occhio** | Passa il mouse sull'icona nel tray per vedere le chat non lette di ogni account e quali account sono silenziati. |
| 🔊 **Audio in background** | I vocali continuano a suonare quando cambi scheda; le schede inattive non vengono mai sospese né silenziate. |
| 📎 **Avviso download** | "Allegato salvato · Mostra nella cartella" dopo ogni download. |
| ⌨️ **Tasti Invio** | Con Impostazioni → *Non inviare il messaggio con Invio*, Invio va a capo e Ctrl+Invio invia. Con *Invia con Shift destro + Invio*, Shift destro + Invio invia e Shift sinistro + Invio va a capo. |
| 🔗 **Link whatsapp://** | Con Impostazioni → *Apri i link whatsapp://*, i link come il pulsante «Chatta su WhatsApp» di un sito si aprono in Altus +, dopo aver chiesto con quale account. Spento per default, così un'altra app WhatsApp li tiene. |
| 🌙 **Avvio nel tray** | Con Impostazioni → *Avvia all'accesso al sistema* e *Avvia nell'area di notifica con Windows*, all'accesso a Windows Altus + parte con la sola icona nel tray; gli account si collegano e notificano come sempre. Aperto dal menu Start, mostra sempre la finestra. |
| 📊 **Uso risorse** | Aiuto → Uso risorse mostra CPU e memoria di ogni account, aggiornate mentre è aperto. Aiuto → Fai test delle risorse le registra dall'avvio in un file CSV finché non lo termini, con un riepilogo di quanto è durato l'avvio e di come è cambiata la memoria. |
| 🩹 **Ripristino dai crash** | Un account che si blocca o va in crash si ricarica da solo, senza toccare gli altri. |
| ⬆️ **Aggiornamenti integrati** | Le nuove versioni si scaricano in background, vengono verificate (SHA512) e si installano con un clic. Durante l'installazione resta visibile un avviso. |
| 🌐 **English / Italiano** | Impostazioni → Lingua, con effetto immediato. |
| 🛡️ **Più sicura** | Electron aggiornato (44), pacchetto dell'app protetto da manomissioni, eseguibile e finestra blindati. [Dettagli](#sicurezza). |

## Download

1. Scarica **`Altus-Plus-Setup-<versione>.exe`** dall'[ultima release](https://github.com/lukethehawk/altus-plus/releases/latest).
2. Avvialo e segui l'installazione.

> [!NOTE]
> L'installer non è firmato digitalmente, quindi Windows SmartScreen potrebbe mostrare "Windows ha protetto il PC". Clicca **Ulteriori informazioni → Esegui comunque**. Ogni release riporta lo SHA256 dell'installer, se vuoi verificarlo.

Da lì in poi Altus + si aggiorna da solo. Controlla all'avvio (Impostazioni → *Controlla aggiornamenti all'avvio*) oppure da **Aiuto → Controlla aggiornamenti**, poi chiede **Riavvia ora / Più tardi**.

### Se hai già l'Altus originale

Se sul PC c'è l'Altus originale, alla prima installazione Altus + chiede come procedere:

- **Installa accanto ad Altus**: le due app restano separate, ciascuna con i propri account e impostazioni. Dell'Altus originale non viene letto né modificato nulla.
- **Sostituisci Altus**:
  1. Altus viene chiuso.
  2. Account WhatsApp, schede, impostazioni e temi vengono copiati in Altus +, quindi non serve riscansionare i codici QR.
  3. Altus viene disinstallato e la sua voce di avvio automatico rimossa.
  4. La sua cartella dati resta come backup in `%APPDATA%\Altus (backup AAAA-MM-GG)`: cancellala tu quando sei sicuro che tutto funziona.

  Se la copia non riesce, Altus resta com'era.

Aggiornamenti e reinstallazioni non lo chiedono più. Per le installazioni automatiche, `Altus-Plus-Setup-<versione>.exe /S --replace-altus` esegue la sostituzione, mentre `/S` da solo installa accanto ad Altus.

## Scorciatoie da tastiera

| Azione | Scorciatoia |
|---|---|
| Nuova scheda | `Ctrl+T` |
| Modifica scheda attiva | `Ctrl+E` |
| Chiudi scheda attiva | `Ctrl+W` |
| Strumenti di sviluppo della scheda | `Ctrl+Shift+D` |
| Riapri scheda chiusa | `Ctrl+Shift+T` |
| Scheda successiva / precedente | `Ctrl+Tab` / `Ctrl+Shift+Tab` |
| Prima / ultima scheda | `Ctrl+1` / `Ctrl+9` |
| Impostazioni | `Ctrl+,` |
| Gestore temi | `Alt+T` |
| Controlla aggiornamenti | `Ctrl+Shift+U` |
| Esci | `Ctrl+Q` |

## Privacy

Nelle schede Altus + carica solo WhatsApp Web. L'unica altra connessione è verso GitHub, per controllare gli aggiornamenti, e puoi disattivarla. Non c'è telemetria.

## Sicurezza

| Ambito | Cosa fa Altus + |
|---|---|
| **Account** | Ogni account gira in una sessione propria, isolata e in sandbox: un account non vede i dati di un altro. |
| **Contenuti web** | Le schede possono restare solo su WhatsApp Web. Gli altri link si aprono nel browser, i pop-up sono bloccati e i messaggi interni dell'app vengono accettati solo dalla finestra o dalla scheda giusta. |
| **Finestra dell'app** | Una Content-Security-Policy permette alla finestra di eseguire solo il codice di Altus +. |
| **Eseguibile** | Le fuse di Electron spengono `RunAsNode`, `NODE_OPTIONS` e `--inspect`: altri programmi non possono usare l'eseguibile di Altus + per far girare codice proprio. |
| **Integrità** | All'avvio l'app controlla il proprio pacchetto (`app.asar`) e si rifiuta di partire se è stato modificato. |
| **Aggiornamenti** | Scaricati solo dalle release di questo repository e installati solo se lo SHA512 corrisponde. |
| **Dipendenze** | Un audit settimanale fallisce su nuovi avvisi high o critical nelle dipendenze dell'app e su qualsiasi avviso relativo a Electron; Dependabot propone le correzioni di sicurezza. Un controllo settimanale segnala ogni nuova release di Electron, che porta le correzioni di sicurezza di Chromium, e la fine del supporto della versione di Electron in uso. Gli avvisi noti, e perché non riguardano l'app, sono in [`docs/DEPENDENCY-AUDIT-ELECTRON44.md`](docs/DEPENDENCY-AUDIT-ELECTRON44.md). |
| **Analisi del codice** | GitHub CodeQL controlla il codice dell'app e i workflow di build in cerca di problemi di sicurezza a ogni pull request, su `master` e ogni settimana; i risultati compaiono in Security → Code scanning. |

Non ancora fatto: l'installer non è firmato digitalmente e i cookie di sessione sono salvati come fa Chromium di default (non cifrati). Hai trovato un problema di sicurezza? Segnalalo con un [avviso di sicurezza privato](https://github.com/lukethehawk/altus-plus/security/advisories/new) invece che con una issue pubblica.

## Compilare dai sorgenti

Servono Node.js 22 o successivo e Corepack (Yarn 4).

```bash
corepack enable
yarn install --immutable
yarn start        # avvio in sviluppo
yarn lint         # controllo tipi + ESLint
yarn test         # test unitari
yarn smoke        # smoke test dell'app pacchettizzata (dopo yarn package)
yarn make         # installer Windows in out/make
```

I passi per una release sono in [`docs/RELEASING.md`](docs/RELEASING.md), le verifiche manuali in [`TESTING-ELECTRON44.md`](TESTING-ELECTRON44.md).

## Segnalazioni

Hai trovato un bug o hai un'idea? [Apri una issue](https://github.com/lukethehawk/altus-plus/issues). Per un bug indica la versione (Aiuto → Informazioni → Copia info versione).

## Ringraziamenti

Altus + esiste grazie ad [**Altus**](https://github.com/amanharwara/altus) di **Aman Harwara** e a chi ha contribuito al progetto:

- [Melvin-Abraham](https://github.com/Melvin-Abraham): correzioni di [#53](https://github.com/amanharwara/altus/issues/53), [#55](https://github.com/amanharwara/altus/issues/55)
- [Dylan McDougall](https://github.com/dmcdo): conferma all'uscita ([#10](https://github.com/amanharwara/altus/pull/10))
- [Dafnik](https://github.com/Dafnik): correzione di [#4](https://github.com/amanharwara/altus/issues/4) ([#5](https://github.com/amanharwara/altus/pull/5))
- [Marcelo Zapatta](https://github.com/MarceloZapatta): icona nel tray su Linux ([#77](https://github.com/amanharwara/altus/pull/77))
- [Maicol Battistini](https://github.com/maicol07): traduzione italiana ([#153](https://github.com/amanharwara/altus/pull/153))
- [Nicolás González Meneses](https://github.com/ngmoviedo): traduzione spagnola ([#163](https://github.com/amanharwara/altus/pull/163))
- [Hugo Rocha de Moura](https://github.com/hugorochaffs): traduzione portoghese ([#185](https://github.com/amanharwara/altus/pull/185))

Realizzato con [Electron](https://www.electronjs.org/), [SolidJS](https://www.solidjs.com/), [Kobalte](https://kobalte.dev/), [electron-store](https://github.com/sindresorhus/electron-store) ed [electron-updater](https://www.electron.build/auto-update). Il tema scuro si basa su [vednoc/dark-whatsapp](https://github.com/vednoc/dark-whatsapp).

Altus + non è affiliato a WhatsApp né a Meta.

## Licenza

[GPL-3.0](LICENSE), come l'Altus originale. Il copyright del codice originale resta ai suoi autori.
