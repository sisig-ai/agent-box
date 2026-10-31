/* ================= Icons ================= */
// Text-only monograms: the retro design has no sprite icons.
function podFor(service) {
  const words = String(service.name || "?")
    .trim()
    .split(/\s+/);
  const glyph =
    words.length > 1
      ? words
          .slice(0, 2)
          .map((w) => w[0])
          .join("")
      : (service.name || "?").trim().slice(0, 2);
  return { glyph: `[${glyph.toLowerCase()}]`, mono: true };
}

/* ================= URLs ================= */
const currentHost = window.location.hostname;

const defaultPorts = {
  plex: { port: 32400, path: "/web" },
  sonarr: { port: 8989 },
  radarr: { port: 7878 },
  prowlarr: { port: 9696 },
  deluge: { port: 8112 },
  bazarr: { port: 6767 },
  lidarr: { port: 8686 },
  readarr: { port: 8787 },
  jellyfin: { port: 8096 },
  overseerr: { port: 5055 },
  tautulli: { port: 8181 },
  transmission: { port: 9091 },
  qbittorrent: { port: 8080 },
  flaresolverr: { port: 8191 },
};

function resolve(service) {
  if (service.url && !service.url.includes("localhost")) {
    let port = "";
    try {
      port = new URL(service.url).port;
    } catch (e) {
      /* leave blank */
    }
    return { url: service.url, port };
  }
  if (service.port) {
    return {
      url: `http://${currentHost}:${service.port}${service.path || ""}`,
      port: String(service.port),
    };
  }
  const key = String(service.icon || service.name).toLowerCase();
  if (defaultPorts[key]) {
    const d = defaultPorts[key];
    return { url: `http://${currentHost}:${d.port}${d.path || ""}`, port: String(d.port) };
  }
  return { url: service.url || "#", port: "" };
}

/* ================= Readout ================= */
function tick() {
  const now = new Date();
  document.getElementById("readout-time").textContent = now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  document.getElementById("readout-date").textContent = now.toLocaleDateString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const tz = now.toLocaleTimeString([], { timeZoneName: "short" }).split(" ").pop();
  document.getElementById("readout-tz").textContent = tz;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return "deep in the night watch";
  if (h < 12) return "good morning";
  if (h < 18) return "good afternoon";
  return "good evening";
}

tick();
setInterval(tick, 15000);
document.getElementById("host").textContent = currentHost || "localhost";

/* ================= Render ================= */
const grid = document.getElementById("services");
const search = document.getElementById("search");

fetch("config.json")
  .then((res) => res.json())
  .then((config) => {
    if (config.title) {
      document.getElementById("title").textContent = config.title;
      document.title = config.title;
    }

    const services = config.services || [];
    document.getElementById("count").textContent =
      `${services.length} system${services.length === 1 ? "" : "s"} nominal`;
    document.getElementById("greeting").textContent = `${greeting()} · all systems standing by.`;

    services.forEach((service, i) => {
      const { url, port } = resolve(service);
      const pod = podFor(service);

      const card = document.createElement("a");
      card.href = url;
      card.target = "_blank";
      card.rel = "noopener";
      card.className = "card";
      card.style.setProperty("--i", i);
      if (service.color) card.style.setProperty("--accent", service.color);
      card.dataset.search = `${service.name} ${service.description || ""} ${port}`.toLowerCase();
      card.innerHTML = `
            <span class="pod${pod.mono ? " mono" : ""}">${pod.glyph}</span>
            <span class="info">
              <span class="name">${service.name}</span>
              <span class="meta">
                <span class="description">${service.description || ""}</span>
                ${port ? `<span class="port">:${port}</span>` : ""}
              </span>
            </span>
            <span class="chevron">→</span>
          `;
      grid.appendChild(card);
    });
  })
  .catch((err) => {
    console.error("Failed to load config:", err);
    document.getElementById("count").textContent = "signal lost";
    grid.innerHTML = '<p class="empty">// no contact with config.json</p>';
  });

/* ================= Scanner ================= */
search.addEventListener("input", () => {
  const q = search.value.trim().toLowerCase();
  let visible = 0;
  grid.querySelectorAll(".card").forEach((card) => {
    const match = !q || card.dataset.search.includes(q);
    card.style.display = match ? "" : "none";
    if (match) visible++;
  });
  let empty = grid.querySelector(".empty");
  if (!visible) {
    if (!empty) {
      empty = document.createElement("p");
      empty.className = "empty";
      grid.appendChild(empty);
    }
    empty.textContent = `// no system matches "${search.value.trim()}"`;
    empty.style.display = "";
  } else if (empty) {
    empty.style.display = "none";
  }
});

search.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    search.value = "";
    search.dispatchEvent(new Event("input"));
    search.blur();
  }
  if (e.key === "Enter") {
    const first = [...grid.querySelectorAll(".card")].find((c) => c.style.display !== "none");
    if (first) first.click();
  }
});

document.addEventListener("keydown", (e) => {
  const tag = document.activeElement && document.activeElement.tagName;
  if (
    e.key === "/" &&
    document.body.dataset.view === "stack" &&
    document.activeElement !== search &&
    tag !== "TEXTAREA" &&
    tag !== "INPUT"
  ) {
    e.preventDefault();
    search.focus();
  }
});
