/* ==========================================================================
 *  Sharing the sheet.
 *
 *  Firebase Realtime Database, talked to straight from the browser — the site
 *  is static, so there is no server of ours to put in between. Two things
 *  decided it over the alternatives: a free project does not go to sleep when
 *  it is unused, which matters when the tool is wanted on four workshop days
 *  spread over months, and a late arrival gets the whole sheet handed to them
 *  without any replay logic of our own.
 *
 *  Strokes travel, not pixels.
 * ========================================================================== */
import { FIREBASE_CONFIG } from "./firebase-config.js";

/* A stroke goes over the wire as a *string* of comma-separated numbers, not as
 * an array. Realtime Database stores an array as an object keyed "0", "1",
 * "2"…, so a few hundred points would carry a few hundred keys of overhead in
 * both bandwidth and storage. A string is a single value, it is compact, it is
 * readable in the console, and it lets the security rules cap a stroke by
 * simple length. Four decimals is finer than a pixel on an A2 sheet at print
 * resolution. */
function encode(pts) {
  let out = "";
  for (let i = 0; i < pts.length; i++) {
    out += (i ? "," : "") + Math.round(pts[i] * 1e4) / 1e4;
  }
  return out;
}

function decode(text) {
  if (typeof text !== "string" || !text) return null;
  const parts = text.split(",");
  const out = new Array(parts.length);
  for (let i = 0; i < parts.length; i++) {
    const v = +parts[i];
    if (!Number.isFinite(v)) return null;
    out[i] = v;
  }
  return out.length >= 3 ? out : null;
}

/** Everything the map needs, with sharing switched off. The page is fully
 *  usable like this — it is also where we land if the network drops. */
function soloSync(onStatus, message) {
  onStatus(message);
  return { publish() {}, remove() {}, clear() {}, enabled: false };
}

export function createSync({ room, onStroke, onRemove, onStatus }) {
  if (!FIREBASE_CONFIG || !FIREBASE_CONFIG.databaseURL) {
    return soloSync(onStatus, "Bara du — delning ej inkopplad");
  }

  const api = { publish() {}, remove() {}, clear() {}, enabled: true };
  onStatus("Ansluter…");

  // Loaded on demand so a solo session never pays for the SDK.
  (async () => {
    try {
      const [{ initializeApp }, db] = await Promise.all([
        import("firebase/app"),
        import("firebase/database"),
      ]);
      const {
        getDatabase, ref, child, onChildAdded, onChildChanged, onChildRemoved,
        onValue, set, remove: removeRef, onDisconnect, connectDatabaseEmulator,
      } = db;

      const app = initializeApp(FIREBASE_CONFIG);
      const database = getDatabase(app);
      if (FIREBASE_CONFIG.emulator) {
        connectDatabaseEmulator(database, FIREBASE_CONFIG.emulator.host,
          FIREBASE_CONFIG.emulator.port);
      }

      const roomRef = ref(database, `rooms/${room}`);
      const strokesRef = child(roomRef, "strokes");
      const presenceRef = child(roomRef, "present");

      const me = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
      let present = 0;
      let online = false;

      const report = () => {
        if (!online) return onStatus("Frånkopplad — ritar lokalt");
        onStatus(present > 1 ? `${present} deltagare` : "Ansluten — ensam just nu");
      };

      // Presence: the marker is cleared by the server if the tab dies, so a
      // closed laptop does not linger in the count.
      const mineRef = child(presenceRef, me);
      onValue(ref(database, ".info/connected"), (snap) => {
        online = snap.val() === true;
        if (online) {
          onDisconnect(mineRef).remove();
          set(mineRef, true);
        }
        report();
      });
      onValue(presenceRef, (snap) => {
        present = snap.size || 0;
        report();
      });

      // Only ever child-level listeners. Watching the whole strokes node would
      // re-send every stroke on the sheet to every participant on every single
      // update — which, while people are drawing, is most of a second.
      const receive = (snap) => {
        const pts = decode(snap.val() && snap.val().pts);
        if (pts) onStroke(snap.key, pts);
      };
      onChildAdded(strokesRef, receive);
      onChildChanged(strokesRef, receive);
      // Clearing the sheet removes the whole node; that still arrives here as
      // one removal per stroke, which the map coalesces into a single redraw.
      onChildRemoved(strokesRef, (snap) => onRemove(snap.key));

      // A rejected write must not take the drawing down with it: the local
      // canvas is already painted, and a dropped connection or a rules
      // rejection should cost you the sharing, not the stroke.
      const guard = (promise) => promise.catch((err) => {
        console.warn("could not reach the shared sheet", err);
        onStatus("Kunde inte dela — ritar lokalt");
      });

      api.publish = (id, pts) => guard(set(child(strokesRef, id), { pts: encode(pts) }));
      api.remove = (id) => guard(removeRef(child(strokesRef, id)));
      api.clear = () => guard(removeRef(strokesRef));
    } catch (err) {
      console.error("sync unavailable", err);
      Object.assign(api, soloSync(onStatus, "Delning otillgänglig — ritar lokalt"));
    }
  })();

  return api;
}
