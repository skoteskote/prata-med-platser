/* Firebase connection details for the shared map.
 *
 * These are NOT secret. A Firebase web config is public by design — it
 * identifies the project, it does not grant access. What actually protects the
 * data is the database rules, which live in the Firebase console.
 *
 * Until this is filled in the map still works: you can draw, undo and save a
 * PDF, you just don't see anyone else. To switch sharing on, paste the config
 * object from
 *   Firebase console -> Project settings -> Your apps -> Web app -> SDK setup
 * and make sure `databaseURL` is included (it only appears once a Realtime
 * Database exists in the project).
 */
export const FIREBASE_CONFIG = null;

/* Example of what goes here:

export const FIREBASE_CONFIG = {
  apiKey: "…",
  authDomain: "prata-med-platser.firebaseapp.com",
  databaseURL: "https://prata-med-platser-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "prata-med-platser",
  appId: "…",
};

Suggested database rules — anyone with the link may draw, but a single stroke
cannot be enormous and nothing outside /rooms is reachable:

{
  "rules": {
    "rooms": {
      "$room": {
        ".read": true,
        ".write": true,
        "strokes": {
          "$stroke": {
            ".validate": "newData.hasChildren(['pts']) && newData.child('pts').val().length < 20000"
          }
        }
      }
    }
  }
}
*/
