# Palestra: guida di configurazione

App web installabile (PWA) per schede, allenamenti, pesi, ripetizioni e recuperi. Ogni persona crea il proprio account e vede solo i propri dati.

Serve circa mezz'ora. Non devi installare nulla sul computer.

## 1. Crea il database su Supabase

1. Vai su **supabase.com**, crea un account e poi un **New project**.
2. Scegli una regione europea (es. **Frankfurt**) per i dati degli utenti. Annota la password del database in un posto sicuro.
3. Quando il progetto è pronto, apri **SQL Editor** > **New query**.
4. Incolla tutto il contenuto del file `schema.sql` e premi **Run**. Crea le tabelle, le regole di sicurezza e circa 40 esercizi iniziali.

## 2. Collega l'app al database

1. In Supabase vai su **Project Settings** > **API** (o **API Keys**).
2. Copia il **Project URL** e la chiave **anon / publishable**.
3. Apri `config.js` e sostituisci i due valori tra virgolette.

Non usare mai la chiave `service_role` / `secret`: darebbe accesso totale al database a chiunque apra l'app.

## 3. Carica il codice su GitHub

1. Su **github.com** crea un nuovo repository (anche privato).
2. Premi **Add file** > **Upload files** e trascina tutti i file e la cartella `icons` di questo progetto.
3. Premi **Commit changes**.

## 4. Pubblica l'app (gratis)

Scegli una delle opzioni, tutte collegabili al repository:

- **Cloudflare Pages** o **Netlify**: "Import from GitHub", seleziona il repository, nessun comando di build, cartella di pubblicazione `/` (la radice).
- **GitHub Pages**: Settings > Pages > Deploy from a branch > `main` / root.

Alla fine ottieni un indirizzo tipo `https://nome-app.pages.dev`. Quello è il link da mandare agli utenti.

## 5. Ultimo passaggio su Supabase

Vai su **Authentication** > **URL Configuration** e inserisci l'indirizzo dell'app come **Site URL**. Serve perché i link nelle email di conferma portino all'app.

Per provare subito senza conferma email: **Authentication** > **Sign In / Providers** > **Email** e disattiva "Confirm email". Per un uso reale conviene lasciarla attiva.

## Come lo usano gli utenti

- **Android (Chrome)**: apre il link, si registra e sceglie "Installa app".
- **iPhone (Safari)**: apre il link, si registra, poi **Condividi** > **Aggiungi a Home**.

## Cose da sapere

- **Limiti del piano gratuito Supabase**: il progetto può essere messo in pausa dopo un periodo di inattività e ci sono limiti di spazio e utenti. Controlla i limiti attuali su supabase.com/pricing.
- **Email di conferma**: il servizio email gratuito integrato ha un limite di invii all'ora. Per molti utenti va configurato un provider SMTP.
- **Senza rete**: l'app si apre anche offline, ma salvataggio e caricamento dei dati richiedono connessione. Un allenamento iniziato resta salvato sul telefono e può essere terminato quando torna la rete.
- **Immagini degli esercizi**: gli esercizi iniziali non hanno immagini. Puoi aggiungerle in due modi: indicare l'indirizzo di un'immagine quando crei un esercizio, oppure compilare la colonna `image_url` della tabella `exercises` in Supabase (Table Editor). Usa solo immagini tue o con licenza libera: verifica sempre la licenza.
- **Privacy (GDPR)**: se l'app la usano persone reali, serve una pagina con l'informativa privacy (quali dati raccogli, dove sono, come cancellarli). L'app include già "Scarica i miei dati" ed "Elimina il mio account" nel Profilo. I dati di allenamento possono rientrare tra i dati relativi alla salute: in caso di dubbi, confrontati con un consulente.

## Aggiornare l'app e carattere dei titoli

- Quando carichi una nuova versione su GitHub, ricordati di includere anche la cartella `fonts` (contiene il carattere dei titoli e dei numeri) e la cartella `icons`.
- Le foto degli esercizi (cartella `images`) vengono dall'archivio free-exercise-db (github.com/yuhonas/free-exercise-db), di pubblico dominio (Unlicense). Ogni esercizio ha due foto, `nome-0.webp` (partenza) e `nome-1.webp` (arrivo); nel campo `image_url` va indicata la prima. Includi la cartella `images` quando carichi una nuova versione.
- Il carattere è TeX Gyre Heros Cn Bold, distribuito con licenza GUST Font License, che ne permette l'uso e l'incorporazione nelle app.
