# AGENTS.md

## Context

Application de gestion des reservations pour des appartements annonces sur plusieurs plateformes, principalement Airbnb et Booking.com.

Le projet concerne 3 chambres/appartements a louer. Les annonces sont actuellement publiees sur 2 plateformes : Airbnb et Booking.com.

Sur Airbnb, les 3 chambres apparaissent comme 3 annonces separees. Sur Booking.com, l'utilisateur voit d'abord un etablissement commun, puis les 3 chambres disponibles a l'interieur de cet etablissement.

Malgre cette difference d'organisation, les deux plateformes fournissent des calendriers iCal/API calendrier par chambre. Ces calendriers doivent permettre de synchroniser les reservations entre plateformes et de detecter les conflits.

La gestion des prix est differente selon la plateforme :

- Sur Booking.com, le prix saisi inclut la commission de la plateforme.
- Sur Airbnb, le prix saisi correspond au montant que le proprietaire recoit.
- Pour obtenir un montant net equivalent, le prix Booking.com doit etre environ 22% plus eleve que le prix Airbnb.

## Product Goal

Construire un outil simple et operationnel pour aider le proprietaire a gerer ses reservations, verifier les conflits entre plateformes, automatiser les messages clients, et plus tard ajuster les prix selon des references externes.

Le projet doit rester pragmatique : l'objectif initial est un MVP utile, pas une interface marketing.

## Main Functions

1. Verifier les reservations entre plateformes.
   - Importer ou lire les calendriers iCal de chaque chambre/appartement.
   - Comparer les reservations venant de Airbnb, Booking.com et autres plateformes futures.
   - Detecter les doublons, chevauchements ou conflits possibles.
   - Si un probleme est detecte, preparer ou envoyer une notification email.

2. Envoyer automatiquement un message 2 jours avant l'arrivee.
   - Inclure un texte de politesse.
   - Inclure le code d'entree, identique pour les 3 appartements.
   - Inclure le numero d'appartement et l'etage.
   - Inclure l'heure de check-in, par exemple a partir de 15h.
   - Expliquer comment recuperer les cles.
   - Terminer par une formule de politesse.

Exemple de message pour l'appartement 1A :

```text
Bonjour,

Voici quelques informations utiles pour votre arrivee :

Adresse: 88 boulevard Camelinat, 92240 Malakoff
Modalites d'acces : code 140789

Vous logez dans l'appartement 1A au 1er etage. Les cles vous attendent dans la serrure. N'hesitez pas a les recuperer et a profiter pleinement de votre sejour.

A tres vite!
```

3. Envoyer automatiquement un message le premier soir a 22h.

Exemple :

```text
Bonjour,

J'espere que vous etes bien installe. N'hesitez pas a me contacter dans le cas necessaire.

Cordialement
```

4. Changer automatiquement les prix sur les plateformes.
   - Reference cible : B&B HOTEL Paris Malakoff Parc des Expositions, Malakoff.
   - Utiliser les tarifs actualises pour 2026.
   - Cette fonctionnalite est future scope tant que la strategie de prix n'est pas definie.

## Active MVP: Step 1

Commencer par une application capable de verifier les bookings/reservations.

### Expected UI

- Interface simple et directe.
- Bouton pour ajouter un appartement.
- Bouton pour supprimer un appartement.
- Dans chaque appartement, permettre d'ajouter plusieurs calendriers iCal venant de differentes plateformes.
- Chaque calendrier doit pouvoir etre associe a une plateforme, par exemple Airbnb, Booking.com, Hotels.com ou autre.
- Ajouter un bouton manuel pour lancer la verification des reservations.

### Expected Report

Apres verification, afficher un rapport clair qui groupe les reservations en conflit.

Pour chaque groupe de reservations qui se chevauchent, afficher :

- Numero de reservation, si disponible.
- Date d'arrivee.
- Date de depart.
- Nom de la personne qui a reserve, si disponible.
- Plateforme source, si disponible.
- Appartement/chambre concernee.

Le rapport doit aider le proprietaire a comprendre rapidement s'il existe un risque de double reservation.

## Future Steps

### Step 2

App in step 1 run automatiquely at 8 AM everyday, set a repport of booking conflit and automatique send to user via telegram.
In message, show: reservation 1: plateforme, check-in, check-out; reservation 2: plateforme, check-in, check-out; reservation n: .....

### Step 3

A definir.

## Technical Context

Project root: `C:\Users\TUNGODUN\Documents\gestion-reservation`

Current stack:

- React 19
- Vite 8
- JavaScript modules (`type: module`)
- ESLint configured

Available scripts:

```bash
npm run dev
npm run build
npm run lint
npm run preview
```

## Implementation Guidance

- Keep the first version simple, useful, and easy to inspect.
- Do not build a landing page unless explicitly requested.
- Prioritize the booking conflict workflow as the core domain behavior.
- Treat iCal parsing, date overlap detection, and conflict grouping as important domain logic.
- Prefer clear names for apartments, platforms, calendars, reservations, and conflicts.
- For the MVP, prefer local state or lightweight browser persistence unless a backend/API is explicitly requested.
- Keep platform-specific behavior isolated so Airbnb, Booking.com, Hotels.com, and future platforms can be handled cleanly.
- Do not assume Booking.com and Airbnb expose the same reservation fields.
- Handle missing reservation names, IDs, or platform metadata gracefully.
- Dates should be displayed clearly for a hospitality/reservation workflow.
- Avoid destructive behavior. The app should report potential problems before automating actions.

## Pricing Notes

- Airbnb entered price = amount received by owner.
- Booking.com entered price = client/platform price including commission.
- Approximate conversion: `bookingPrice = airbnbNetPrice * 1.22`.
- Do not automate pricing changes until the pricing rule and external data source are explicitly specified.

## Messaging Notes

Check-in messages need room-specific information:

- Address.
- Entry code.
- Apartment number.
- Floor.
- Check-in time.
- Key pickup instructions.
- Polite greeting and closing.

The same entry code may apply to all 3 apartments, but apartment number and floor are room-specific.

## Testing Guidance

For this file-only task, no build is required.

For future code changes, run:

```bash
npm run lint
npm run build
```

Manual acceptance criteria for Step 1:

- User can add and remove apartments.
- User can attach multiple iCal URLs to each apartment.
- User can identify the source platform for each iCal URL.
- User can manually run a reservation check.
- The report groups overlapping reservations clearly.
- Each conflict group shows reservation number, arrival date, departure date, guest name, platform, and apartment when those values are available.

## Non-Goals For Now

- Do not implement automated email sending unless explicitly requested.
- Do not implement automated guest messaging unless explicitly requested.
- Do not implement automated price changes unless explicitly requested.
- Do not add a backend unless the requested feature needs it.
- Do not modify `README.md` unless explicitly requested.