/* Presence beacon — feeds the live circulation count on /admin.html.
 *
 * One node per open connection under /presence, stamped with the server
 * clock and removed by the server the moment the connection drops
 * (onDisconnect). The 4-minute re-stamp keeps the timestamp fresh so the
 * admin page can discount nodes a dead connection left behind. Database
 * rules only allow number writes inside /presence — nothing else on the
 * database is readable or writable from here.
 *
 * Fire-and-forget: any failure (offline, blocked CDN, old browser) must
 * leave the page it rides on untouched — hence the blanket try/catch.
 */
try {
  const [{ initializeApp }, { getDatabase, ref, push, set, onValue, onDisconnect, serverTimestamp }] =
    await Promise.all([
      import('https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/12.1.0/firebase-database.js'),
    ]);

  const db = getDatabase(initializeApp({
    apiKey: 'AIzaSyCYSAat_8WvaAYhKfYpShGYEGHtLapLn8I',
    authDomain: 'cipherbreaker-75885.firebaseapp.com',
    databaseURL: 'https://cipherbreaker-75885-default-rtdb.firebaseio.com',
    projectId: 'cipherbreaker-75885',
    appId: '1:344319484676:web:e7f074f8cf9df2a5c36651',
  }));

  let node = null;
  let timer = null;
  onValue(ref(db, '.info/connected'), (snap) => {
    if (snap.val() !== true) return;
    /* Each (re)connect gets a fresh node; the previous connection's node
       is removed server-side by its own onDisconnect. */
    node = push(ref(db, 'presence'));
    onDisconnect(node).remove().catch(() => {});
    set(node, serverTimestamp()).catch(() => {});
    if (timer) clearInterval(timer);
    timer = setInterval(() => {
      if (node) set(node, serverTimestamp()).catch(() => {});
    }, 240000);
  });
} catch {
  /* the page owes the visitor its content, not telemetry */
}
