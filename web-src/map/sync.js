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
 *  Strokes travel, not pixels. A stroke is a flat [x, y, width, …] array in
 *  map-width units, so it is a few kB and renders identically everywhere.
 * ========================================================================== */
import { FIREBASE_CONFIG } from "./firebase-config.js";

/** Rounded on the way out: five decimals is finer than a pixel on an A2 sheet
 *  at print resolution, and it roughly halves what goes over the wire. */
function trim(pts) {
  const out = new Array(pts.length);
  for (let i = 0; i < pts.length; i++) out[i] = Math.round(pts[i] * 1e5) / 1e5;
  return out;
}

/** Everything the map needs, with sharing switched off. The page is fully
 *  usable like this — it is also what you fall back to if the network drops. */
function soloSync(onStatus, message) {
  onStatus(message);
  return { publish() {}, remove() {}, clear() {}, enabled: false };
}

export function createSync({ room, onStroke, onRemove, onClear, onStatus }) {
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
        onValue, set, remove: removeRef, onDisconnect,
      } = db;

      const app = initializeApp(FIREBASE_CONFIG);
      const database = getDatabase(app);
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

      // Presence: our marker is cleared by the server if the tab dies, so a
      // crashed laptop does not linger in the count.
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

      const receive = (snap) => {
        const value = snap.val();
        if (value && Array.isArray(value.pts)) onStroke(snap.key, value.pts);
      };
      onChildAdded(strokesRef, receive);
      onChildChanged(strokesRef, receive);
      onChildRemoved(strokesRef, (snap) => onRemove(snap.key));

      // Clearing removes the whole node at once. The per-stroke removals still
      // arrive, and the map coalesces them into one redraw.
      onValue(strokesRef, (snap) => { if (!snap.exists()) onClear(); });

      // A rejected write must not take the drawing down with it: the local
      // canvas is already painted, and a dropped connection or a rules
      // rejection should cost you the sharing, not the stroke.
      const guard = (promise) => promise.catch((err) => {
        console.warn("could not reach the shared sheet", err);
        onStatus("Kunde inte dela — ritar lokalt");
      });

      api.publish = (id, pts) => guard(set(child(strokesRef, id), { pts: trim(pts) }));
      api.remove = (id) => guard(removeRef(child(strokesRef, id)));
      api.clear = () => guard(removeRef(strokesRef));
    } catch (err) {
      console.error("sync unavailable", err);
      Object.assign(api, soloSync(onStatus, "Delning otillgänglig — ritar lokalt"));
    }
  })();

  return api;
}
