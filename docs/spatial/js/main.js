// Whim Spatial Bench: start-up. Order matters only in one place: the controls exist before the bench starts
// talking, so nothing it says at start-up is lost.
import * as A from "./app.js";
import * as X from "./xr.js";
import { initUI, refreshXR } from "./ui.js";
import * as THREE from "three";

window.whim = { A, X, S: A.S, THREE, version: A.VERSION };       // open the console and poke at it

// Anything that goes wrong is said out loud: on the page, and on the board when in the headset.
let lastSaid = "";
function say(what) { const text = "Something went wrong: " + what; if (text === lastSaid) return; lastSaid = text; console.error(text); A.toast(text, 9000); setTimeout(() => { lastSaid = ""; }, 4000); }
addEventListener("error", (e) => { if (e.message && !/ResizeObserver/.test(e.message)) say(e.message); });
addEventListener("unhandledrejection", (e) => say(e.reason && e.reason.message ? e.reason.message : String(e.reason)));

initUI();
A.on("ready", () => {
  let seen = false; try { seen = !!localStorage.getItem("whim.spatial.seen"); localStorage.setItem("whim.spatial.seen", "1"); } catch (e) { /* storage may be off */ }
  if (!seen && A.S.nodes.some((n) => n.kind === "clamp")) A.toast("This bracket is clamped and loaded already. Press Test to see if it holds.", 7000);
});
A.init(document.getElementById("stage")).catch((e) => {
  console.error(e);
  const box = document.createElement("div"); box.id = "fatal";
  box.innerHTML = "<b>The bench could not start.</b><span></span><span>It needs a browser with WebGL 2, such as a current Chrome, Edge, Firefox, Safari or the Quest browser.</span>";
  box.children[1].textContent = e && e.message ? e.message : String(e); document.body.appendChild(box);
});
X.detect().then(refreshXR);

// Offline: after one visit the bench opens without a network. Not available inside a preview frame.
const local = location.hostname === "localhost" || location.hostname === "127.0.0.1";
if ("serviceWorker" in navigator && !A.EMBED && (location.protocol === "https:" || local) && !new URLSearchParams(location.search).has("nosw")) {
  navigator.serviceWorker.register("sw.js").catch((e) => console.warn("offline copy not installed", e));
}
