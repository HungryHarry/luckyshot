// ─────────────────────────────────────────────────────────────
//  LuckyShot – Konfiguration
//  1) Firebase-Werte eintragen (Firebase Console → Projekteinstellungen → Web-App).
//     Solange apiKey/databaseURL leer sind, läuft das Spiel im DEMO-MODUS
//     (nur in diesem Browser, über mehrere Tabs – ideal zum Testen mit Bots).
//  2) Spielleiter-Code festlegen.
// ─────────────────────────────────────────────────────────────
export const CONFIG = {
  firebase: {
    // Gemeinsames Firebase-Projekt mit Farbspur – LuckyShot schreibt nur unter /luckyshot
    apiKey: "AIzaSyCXUsH3uH3KdV42VIZMCxcelFbVDHH39UM",
    authDomain: "farbspur.firebaseapp.com",
    databaseURL: "https://farbspur-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "farbspur",
    storageBucket: "farbspur.firebasestorage.app",
    messagingSenderId: "976568262556",
    appId: "1:976568262556:web:92a65d772809b2a7707259",
  },
  firebaseSdkVersion: "10.12.2",

  // Spielleiter-Code NUR für den Demo-Modus.
  // Mit Firebase prüft der Server den Code gegen den Datenbankeintrag config/luckyshotHostKey
  // (in der Firebase Console anlegen, Groß/Kleinschreibung beachten). Dieser Wert hier wird dann ignoriert.
  hostCode: "LUCKY2026",

  maxPlayers: 30,
  readySeconds: 3,         // "Bereit?"-Phase vor jeder Runde
  pickSeconds: 10,         // Zeit zum Karte wählen
  // Nach dem Aufdecken startet der Spielleiter die nächste Runde per Klick.
};
