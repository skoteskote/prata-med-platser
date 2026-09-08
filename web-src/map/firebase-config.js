/* Firebase connection details for the shared map.
 *
 * These are NOT secret. A Firebase web config identifies the project, it does
 * not grant access — that is what the database rules are for, and they live in
 * firebase/database.rules.json (deploy with `firebase deploy --only database`
 * from that folder). Anyone with the link can draw on the map and clear it;
 * nothing outside /rooms is reachable at all.
 *
 * Set this back to `null` to work on the map without sharing: the page still
 * draws, undoes and saves a PDF, and the whole Firebase branch drops out of the
 * bundle. Pointing it at the local emulator instead is described under "Testa
 * delningen utan projekt" in CLAUDE.md.
 */
export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAslBhWTI8QNT169ed1QKB2ZiMTn23c0cI",
  authDomain: "prata-med-platser.firebaseapp.com",
  databaseURL: "https://prata-med-platser-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "prata-med-platser",
  appId: "1:786738775900:web:148ab86663a1e69e342399",
};
