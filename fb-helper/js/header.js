// The header bar: the API-usage / throttle-pause pill. graph.js announces changes with the "usage" event; it is also
// redrawn on a language switch (the pause text is translated) and every 30 s (the minutes tick down).

import { t } from "./i18n.js";
import { $ } from "./dom.js";
import { state } from "./state.js";
import { on } from "./bus.js";
import { registerRender, registerStart } from "./registry.js";

function renderUsage() {
  const u = $("#usage");
  const cd = state.cooldownUntil - Date.now();
  if (cd > 0) { u.textContent = t("usage.pause", { n: Math.ceil(cd / 60000) }); u.className = "pill bad"; return; }
  if (state.usage === null || state.usage < 50) { u.className = "pill hidden"; return; }
  u.textContent = `API ${Math.round(state.usage)}%`;
  u.className = `pill ${state.usage >= 75 ? "bad" : "warn"}`;
}

on("usage", renderUsage);
registerRender(renderUsage, { lang: true, tick: true });
registerStart(renderUsage);
