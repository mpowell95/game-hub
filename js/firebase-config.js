// firebase-config.js - the shared Firebase project config for the Game Hub.
//
// SHARED between the multiplayer effort (js/net.js, per the MP docs) and the hidden
// challenge (js/challenge/challenge-net.js). Both import THIS one file; do not duplicate it.
//
// Matt: paste the config object from the Firebase console here (MP-01 step 5). The apiKey
// is NOT a secret and is fine in the public repo. Until real values are pasted, both the
// multiplayer and the challenge network layers stay inert, so offline play is unaffected.

export const firebaseConfig = {
  apiKey: "AIzaSyBLFwNQIut_DhZqjlgo2uu5-65Ojl_Wqus",
  authDomain: "game-hub-5b91c.firebaseapp.com",
  projectId: "game-hub-5b91c",
  databaseURL: "https://game-hub-5b91c-default-rtdb.firebaseio.com",
  storageBucket: "game-hub-5b91c.firebasestorage.app",
  messagingSenderId: "494412379465",
  appId: "1:494412379465:web:49cec1547b2740b5099698",
  measurementId: "G-L13PY21J73",
};

export default { firebaseConfig };
