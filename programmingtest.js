// 1. Setup der Daten (Simulation der Vorgabe)
// Wir wandeln den String in ein echtes Array um, wie in der Aufgabe gefordert.
const rohDatenString = "QQQQRRRRRRTTTTTTTTTTLLLLLLLLLLLMNNNVVVVVVVVVVVAAAAAAAAAAAAA";
const bildDaten = rohDatenString.split(''); // Erstellt Array ['Q', 'Q', ...]

// Initialisierung der Variablen
const komprimierteDaten = [];
const sonderzeichen = "§";
let zaehlerWiederholung = 1;

// 2. Der Algorithmus
for (let i = 0; i < bildDaten.length; i++) {

  // Wir prüfen: Ist das aktuelle Zeichen gleich dem nächsten?
  // WICHTIG: Wir müssen sicherstellen, dass wir nicht über das Array hinauslesen (i < length - 1)
  if (i < bildDaten.length - 1 && bildDaten[i] === bildDaten[i + 1]) {
    // Ja: Zähler erhöhen
    zaehlerWiederholung++;
  } else {
    // Nein: Es findet ein Wechsel statt ODER wir sind am Ende des Arrays.
    // Jetzt müssen wir schreiben.

    if (zaehlerWiederholung >= 4) {
      // Komprimierung anwenden
      // JS wandelt Zahlen hier automatisch in Strings um
      let block = sonderzeichen + zaehlerWiederholung + bildDaten[i];
      komprimierteDaten.push(block);
    } else {
      // Keine Komprimierung: Zeichen einzeln hinzufügen
      for (let j = 0; j < zaehlerWiederholung; j++) {
        komprimierteDaten.push(bildDaten[i]);
      }
    }

    // Reset für den nächsten Durchlauf
    zaehlerWiederholung = 1;
  }
}

// 3. Ausgabe und Überprüfung
console.log("Original Länge:", bildDaten.length);
// Array wieder zu String zusammenfügen für die Ausgabe
const ergebnisString = komprimierteDaten.join('');
console.log("Komprimiert:", ergebnisString);
console.log("Neue Länge:", ergebnisString.length);

// Einfacher Test gegen das erwartete Ergebnis aus der Aufgabe
const erwartung = "§4Q§6R§10T§11LMNNN§11V§13A";
console.log("Test bestanden?", ergebnisString === erwartung);
