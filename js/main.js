/* ==========================================================
   SOLACE · an odyssey for Ica
   Vanilla JS, no dependencies, no build step.
   ========================================================== */
(() => {
  "use strict";

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const root = document.documentElement;
  const body = document.body;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const fine = matchMedia("(pointer: fine)").matches;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const TAU = Math.PI * 2;

  /* ---------------------------------------------------------
     THE LETTERS (encrypted; each opens only with its own keyword)
     Source + keywords live in private/letters.json and are built
     into js/letters.enc.js by private/build.mjs.
     --------------------------------------------------------- */
  const LETTERS = window.SOLACE_LETTERS || [];
  const N = LETTERS.length;

  /* ---------------------------------------------------------
     STATE (which letters have been opened)
     --------------------------------------------------------- */
  const KEY = "solace.opened.v1",
    VAULT = "solace.keys.v1";
  const opened = new Set();
  try {
    JSON.parse(localStorage.getItem(KEY) || "[]").forEach((i) => {
      if (i >= 0 && i < N) opened.add(i);
    });
  } catch (e) {
    /* ignore */
  }
  const saveOpened = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify([...opened]));
    } catch (e) {
      /* ignore */
    }
  };

  /* ---------------------------------------------------------
     KEYWORDS: decrypt a letter's body (PBKDF2 -> AES-GCM)
     --------------------------------------------------------- */
  const BODY = []; // decrypted paragraphs, by letter index
  // must match norm() in private/build.mjs
  const norm = (s) =>
    String(s).normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const subtle = window.crypto && window.crypto.subtle;
  let vault = {};
  try {
    vault = JSON.parse(localStorage.getItem(VAULT) || "{}") || {};
  } catch (e) {
    vault = {};
  }
  const saveVault = () => {
    try {
      localStorage.setItem(VAULT, JSON.stringify(vault));
    } catch (e) {
      /* ignore */
    }
  };

  async function decryptLetter(i, keyword) {
    const L = LETTERS[i];
    const base = await subtle.importKey(
      "raw",
      new TextEncoder().encode(norm(keyword)),
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    const key = await subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: b64(L.salt),
        iterations: L.iter,
        hash: "SHA-256",
      },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"],
    );
    const plain = await subtle.decrypt(
      { name: "AES-GCM", iv: b64(L.iv) },
      key,
      b64(L.ct),
    );
    return JSON.parse(new TextDecoder().decode(plain));
  }
  async function tryUnlock(i, keyword) {
    if (!subtle || !norm(keyword)) return false;
    try {
      BODY[i] = await decryptLetter(i, keyword);
      vault[i] = norm(keyword);
      saveVault();
      return true;
    } catch (e) {
      return false; // wrong keyword fails the AES-GCM check
    }
  }

  /* ---------------------------------------------------------
     ENVELOPE MARKUP (used by the cards and by the reader)
     --------------------------------------------------------- */
  function envHTML() {
    return `
    <div class="env">
      <div class="env__shadow"></div>
      <svg class="env__back" viewBox="0 0 300 200" preserveAspectRatio="none" aria-hidden="true"><rect width="300" height="200" rx="5" fill="#c9b074"/></svg>
      <div class="env__flap">
        <svg class="env__flap-in" viewBox="0 0 300 108" preserveAspectRatio="none" aria-hidden="true"><polygon points="0,0 300,0 150,108" fill="url(#g-flap-in)"/></svg>
        <svg class="env__flap-out" viewBox="0 0 300 108" preserveAspectRatio="none" aria-hidden="true"><polygon points="0,0 300,0 150,108" fill="url(#g-flap)"/><polyline points="0,0 150,108 300,0" fill="none" stroke="rgba(110,76,28,.38)" stroke-width=".9"/></svg>
      </div>
      <div class="env__clip"><div class="env__paper"><i></i><i></i><i></i><i></i></div></div>
      <svg class="env__front" viewBox="0 0 300 200" preserveAspectRatio="none" aria-hidden="true">
        <polygon points="0,0 150,108 0,200" fill="url(#g-left)"/>
        <polygon points="300,0 150,108 300,200" fill="url(#g-right)"/>
        <polygon points="0,200 150,108 300,200" fill="url(#g-bottom)"/>
        <polyline points="0,0 150,108 300,0" fill="none" stroke="rgba(110,76,28,.35)" stroke-width=".8"/>
        <polyline points="0,200 150,108 300,200" fill="none" stroke="rgba(110,76,28,.3)" stroke-width=".8"/>
        <rect width="300" height="200" rx="5" fill="none" stroke="rgba(110,76,28,.3)" stroke-width=".8"/>
      </svg>
      <div class="env__seal"><span class="seal__half seal__half--l"></span><span class="seal__half seal__half--r"></span><svg class="env__lock" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 11V8a5 5 0 0 1 10 0v3" fill="none" stroke="#ffe3d6" stroke-width="2.2" stroke-linecap="round"/><rect x="4.5" y="11" width="15" height="10.5" rx="2.4" fill="#ffe3d6"/><circle cx="12" cy="16" r="1.7" fill="#8f2a1f"/></svg></div>
      <div class="env__addr">For Ica</div>
      <div class="env__stamp"></div>
    </div>`;
  }

  /* ---------------------------------------------------------
     SKY (stars canvas) + FX (particles canvas)
     --------------------------------------------------------- */
  const sky = $("#sky"),
    sctx = sky.getContext("2d");
  const fx = $("#fx"),
    fctx = fx.getContext("2d");
  let sw = 0,
    sh = 0,
    stars = [];
  let sailed = false;
  let mx = 0,
    my = 0,
    tmx = 0,
    tmy = 0; // parallax mouse (smoothed / target)
  let shooters = [],
    nextShot = 0;
  let parts = [];

  function sizeCanvases(regen = true) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    sw = window.innerWidth;
    sh = window.innerHeight;
    [sky, fx].forEach((c) => {
      c.width = Math.round(sw * dpr);
      c.height = Math.round(sh * dpr);
    });
    sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!regen) return;
    const n = Math.round(clamp((sw * sh) / 7000, 80, 260));
    stars = Array.from({ length: n }, () => ({
      x: rand(0, sw),
      y: rand(0, sh),
      r: rand(0.4, 1.5) * (Math.random() < 0.08 ? 1.8 : 1),
      tw: rand(0.4, 1.6),
      ph: rand(0, TAU),
      d: rand(0.2, 1),
      hue: Math.random() < 0.2 ? 45 : Math.random() < 0.3 ? 210 : 0,
    }));
  }

  function paintStars(t, dt) {
    sctx.clearRect(0, 0, sw, sh);
    const sy = window.scrollY;
    for (const s of stars) {
      let y = s.y - sy * s.d * 0.08 - my * s.d * 12;
      y = ((y % sh) + sh) % sh;
      const x = s.x - mx * s.d * 14;
      const a = reduce
        ? 0.7
        : 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 0.001 * s.tw + s.ph));
      sctx.globalAlpha = a;
      sctx.fillStyle = s.hue ? `hsl(${s.hue} 80% 85%)` : "#fff";
      sctx.beginPath();
      sctx.arc(x, y, s.r, 0, TAU);
      sctx.fill();
      if (s.r > 1.6) {
        sctx.globalAlpha = a * 0.25;
        sctx.beginPath();
        sctx.arc(x, y, s.r * 3, 0, TAU);
        sctx.fill();
      }
    }
    sctx.globalAlpha = 1;

    if (!reduce && sailed && t > nextShot) {
      spawnShooter();
      nextShot = t + rand(3500, 8000);
    }
    shooters = shooters.filter((o) => (o.age += dt) < o.life);
    for (const o of shooters) {
      o.x += (o.vx * dt) / 16;
      o.y += (o.vy * dt) / 16;
      const k = 1 - o.age / o.life;
      const g = sctx.createLinearGradient(
        o.x,
        o.y,
        o.x - o.vx * 9,
        o.y - o.vy * 9,
      );
      g.addColorStop(0, `rgba(255,244,210,${0.95 * k})`);
      g.addColorStop(1, "rgba(255,244,210,0)");
      sctx.strokeStyle = g;
      sctx.lineWidth = 1.6;
      sctx.lineCap = "round";
      sctx.beginPath();
      sctx.moveTo(o.x, o.y);
      sctx.lineTo(o.x - o.vx * 9, o.y - o.vy * 9);
      sctx.stroke();
    }
  }
  function spawnShooter(x, y) {
    const a = rand(0.25, 0.5),
      sp = rand(8, 13);
    shooters.push({
      x: x ?? rand(sw * 0.15, sw * 0.95),
      y: y ?? rand(0, sh * 0.35),
      vx: -Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      age: 0,
      life: 900,
    });
  }

  function burst(x, y, o = {}) {
    if (reduce) return;
    const {
      n = 18,
      speed = 4,
      life = 1000,
      size = 2.4,
      gravity = 0.06,
      hue = 44,
    } = o;
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU),
        s = rand(0.3, 1) * speed;
      parts.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - speed * 0.2,
        life: rand(0.5, 1) * life,
        age: 0,
        size: rand(0.6, 1) * size,
        hue: hue + rand(-8, 14),
        g: gravity,
      });
    }
  }
  function drawFx(dt) {
    fctx.clearRect(0, 0, sw, sh);
    if (!parts.length) return;
    fctx.globalCompositeOperation = "lighter";
    parts = parts.filter((p) => (p.age += dt) < p.life);
    for (const p of parts) {
      p.vy += (p.g * dt) / 16;
      p.vx *= 0.992;
      p.x += (p.vx * dt) / 16;
      p.y += (p.vy * dt) / 16;
      const k = 1 - p.age / p.life;
      fctx.globalAlpha = k;
      fctx.fillStyle = `hsl(${p.hue} 95% ${60 + 30 * k}%)`;
      fctx.beginPath();
      fctx.arc(p.x, p.y, p.size * (0.4 + 0.6 * k), 0, TAU);
      fctx.fill();
    }
    fctx.globalAlpha = 1;
    fctx.globalCompositeOperation = "source-over";
  }

  /* ---------------------------------------------------------
     LETTER CARDS ALONG THE VOYAGE
     --------------------------------------------------------- */
  const list = $("#list");
  list.innerHTML = LETTERS.map(
    (L, i) => `
    <li class="stop ${i % 2 ? "stop--r" : "stop--l"}" data-i="${i}" style="--k:${i}">
      <div class="stop__text reveal">
        <span class="stop__num">Letter ${L.n}</span>
        <h3>${L.title}</h3>
        <p>${L.sub}</p>
      </div>
      <span class="node" aria-hidden="true"></span>
      <div class="stop__env reveal">
        <button class="env-btn" type="button" data-open="${i}" style="--k:${i}" aria-label="Open Letter ${L.n}: ${L.title}">
          <span class="env-box"><span class="env-tilt">${envHTML()}</span></span>
          <span class="env-btn__hint">Break the seal</span>
        </button>
      </div>
    </li>`,
  ).join("");

  function refreshCards() {
    $$(".env-btn", list).forEach((b) => {
      const i = +b.dataset.open,
        locked = !BODY[i],
        done = !locked && opened.has(i);
      b.classList.toggle("is-locked", locked);
      b.classList.toggle("is-opened", done);
      const env = $(".env", b);
      env.classList.toggle("is-broken", done);
      env.classList.toggle("is-open", done);
      env.classList.toggle("is-peek", done);
      $(".env-btn__hint", b).textContent = locked
        ? "Sealed · needs a keyword"
        : done
          ? "Read again"
          : "Break the seal";
      b.setAttribute(
        "aria-label",
        `${locked ? "Locked. " : ""}Open Letter ${LETTERS[i].n}: ${LETTERS[i].title}`,
      );
    });
    $("#count").textContent = opened.size;
    $$("#dots li").forEach((li) =>
      li.classList.toggle("is-done", opened.has(+li.dataset.i)),
    );
  }

  // 3D tilt on hover (mouse only)
  list.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    const b = e.target.closest(".env-btn");
    if (!b) return;
    const r = b.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5,
      y = (e.clientY - r.top) / r.height - 0.5;
    b.style.setProperty("--ry", (x * 18).toFixed(2) + "deg");
    b.style.setProperty("--rx", (-y * 14).toFixed(2) + "deg");
  });
  list.addEventListener("pointerout", (e) => {
    const b = e.target.closest(".env-btn");
    if (b && !b.contains(e.relatedTarget)) {
      b.style.setProperty("--rx", "0deg");
      b.style.setProperty("--ry", "0deg");
    }
  });
  list.addEventListener("click", (e) => {
    const b = e.target.closest("[data-open]");
    if (!b) return;
    const i = +b.dataset.open;
    ensureUnlocked(i, b).then((ok) => {
      if (ok) openReader(i, b);
    });
  });

  /* ---------------------------------------------------------
     THE VOYAGE ROUTE (path through the five waypoints + ship)
     --------------------------------------------------------- */
  const stopsBox = $("#stops"),
    routeSvg = $("#route"),
    routeBase = $("#route-base"),
    routeSail = $("#route-sail"),
    sailship = $("#sailship");
  let route = { len: 0, nodes: [], h: 0 };
  let shipTarget = 0,
    shipY = 0;

  function buildRoute() {
    const r = stopsBox.getBoundingClientRect();
    const nodeEls = $$(".node", stopsBox);
    if (!nodeEls.length || !r.height) return;
    const nodes = nodeEls.map((el) => {
      const b = el.getBoundingClientRect();
      return {
        el,
        x: b.left - r.left + b.width / 2,
        y: b.top - r.top + b.height / 2,
      };
    });
    const w = r.width,
      h = r.height;
    routeSvg.setAttribute("width", w);
    routeSvg.setAttribute("height", h);
    routeSvg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    const amp = matchMedia("(min-width: 861px)").matches ? 96 : 16;
    const P = [
      { x: nodes[0].x, y: 0 },
      ...nodes,
      { x: nodes[nodes.length - 1].x, y: h },
    ];
    let d = `M${P[0].x.toFixed(1)} ${P[0].y.toFixed(1)}`;
    for (let i = 0; i < P.length - 1; i++) {
      const a = P[i],
        b = P[i + 1],
        dy = b.y - a.y,
        s = i % 2 ? -1 : 1;
      d += ` C${(a.x + amp * s).toFixed(1)} ${(a.y + dy * 0.33).toFixed(1)} ${(b.x + amp * s).toFixed(1)} ${(a.y + dy * 0.66).toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
    }
    routeBase.setAttribute("d", d);
    routeSail.setAttribute("d", d);
    route = { len: routeBase.getTotalLength(), nodes, h };
    routeSail.style.strokeDasharray = route.len;
    routeSail.style.strokeDashoffset = route.len;
    placeShip(shipY);
  }
  function pointAtY(y) {
    let lo = 0,
      hi = route.len;
    for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) / 2;
      if (routeBase.getPointAtLength(mid).y < y) lo = mid;
      else hi = mid;
    }
    return { len: hi, p: routeBase.getPointAtLength(hi) };
  }
  function placeShip(y) {
    if (!route.len) return;
    const { len, p } = pointAtY(y);
    const q = routeBase.getPointAtLength(Math.min(route.len, len + 4));
    const dx = q.x - p.x;
    sailship.style.transform = `translate3d(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px, 0) translate(-50%, -64%) scaleX(${dx < 0 ? -1 : 1}) rotate(${clamp(Math.abs(dx) * 1.2, 0, 14).toFixed(1)}deg)`;
    routeSail.style.strokeDashoffset = route.len - len;
    for (const n of route.nodes)
      n.el.classList.toggle("reached", p.y >= n.y - 6);
  }

  /* ---------------------------------------------------------
     THE READER (envelope opening + letter)
     --------------------------------------------------------- */
  const reader = $("#reader"),
    paper = $("#paper"),
    paperInner = $("#paper-inner"),
    rEnvBox = $("#reader-env");
  const prevBtn = $("#prev"),
    nextBtn = $("#next"),
    nextLabel = $("#next-label"),
    dots = $("#dots"),
    stage = $("#stage");
  rEnvBox.innerHTML = `<div class="env-box env-box--lg"><div class="env-tilt">${envHTML()}</div></div>`;
  const rEnv = $(".env", rEnvBox);
  dots.innerHTML = LETTERS.map((_, i) => `<li data-i="${i}"></li>`).join("");

  let cur = -1,
    timers = [],
    lastFocus = null;
  const later = (fn, ms) => {
    const t = setTimeout(fn, ms);
    timers.push(t);
    return t;
  };
  const clearTimers = () => {
    timers.forEach(clearTimeout);
    timers = [];
  };
  const mainEl = $("#main");

  function renderPaper(i) {
    const L = LETTERS[i];
    paperInner.innerHTML = `
      <p class="paper__num">Letter ${L.n} of V</p>
      <h2 id="paper-title" class="paper__title">${L.title}</h2>
      <p class="paper__sub">${L.sub}</p>
      <div class="paper__rule" aria-hidden="true"></div>
      <p class="line greet" style="--i:0">Dear Ica,</p>
      ${BODY[i].map((t, k) => `<p class="line" style="--i:${k + 1}">${t}</p>`).join("")}
      <p class="line sign" style="--i:${BODY[i].length + 1}">Keefa</p>`;
    prevBtn.disabled = i === 0;
    nextLabel.textContent = i === N - 1 ? "The ninth star" : "Next";
    $$("#dots li").forEach((li) =>
      li.classList.toggle("is-cur", +li.dataset.i === i),
    );
    paper.scrollTop = 0;
  }
  function startWriting() {
    paper.classList.remove("is-written");
    void paper.offsetWidth;
    paper.classList.add("is-written");
  }
  function markOpened(i) {
    if (!opened.has(i)) {
      opened.add(i);
      saveOpened();
    }
    refreshCards();
  }
  function toRead(i) {
    reader.dataset.phase = "read";
    markOpened(i);
    startWriting();
    later(() => paper.focus({ preventScroll: true }), 700);
  }
  function sealCenter() {
    const r = $(".env__seal", rEnv).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  function playIntro(i) {
    later(() => {
      rEnv.classList.add("is-broken");
      const c = sealCenter();
      burst(c.x, c.y, { n: 40, speed: 5.5, life: 1200, size: 2.8, hue: 8 });
      burst(c.x, c.y, { n: 22, speed: 4, life: 1400, size: 2.2 });
    }, 750);
    later(() => rEnv.classList.add("is-open"), 1350);
    later(() => rEnv.classList.add("is-out"), 2000);
    later(() => toRead(i), 3000);
  }
  function skipIntro() {
    if (reader.dataset.phase !== "intro") return;
    clearTimers();
    rEnv.classList.add("is-broken", "is-open", "is-out");
    toRead(cur);
  }

  function openReader(i, trigger) {
    lastFocus = trigger || document.activeElement;
    cur = i;
    clearTimers();
    reader.hidden = false;
    root.classList.add("locked");
    mainEl.inert = true;
    renderPaper(i);
    rEnv.className = "env";
    paper.classList.remove("is-written");
    reader.dataset.phase = "intro";
    void reader.offsetWidth;
    reader.classList.add("is-on");
    if (!opened.has(i) && !reduce) {
      playIntro(i);
    } else {
      rEnv.classList.add("is-broken", "is-open", "is-out");
      later(() => toRead(i), reduce ? 0 : 350);
    }
  }
  function closeReader() {
    if (reader.hidden) return;
    clearTimers();
    reader.classList.remove("is-on");
    mainEl.inert = false;
    root.classList.remove("locked");
    later(() => {
      reader.hidden = true;
      reader.dataset.phase = "";
    }, 460);
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }
  function go(delta) {
    if (reader.dataset.phase !== "read") return;
    const j = cur + delta;
    if (j < 0) return;
    if (j >= N) {
      closeReader();
      later(
        () =>
          $("#ninth").scrollIntoView({
            behavior: reduce ? "auto" : "smooth",
            block: "start",
          }),
        480,
      );
      return;
    }
    ensureUnlocked(j, delta > 0 ? nextBtn : prevBtn).then((ok) => {
      if (!ok || reader.hidden) return;
      cur = j;
      paper.classList.add("is-swapping");
      later(() => {
        renderPaper(j);
        markOpened(j);
        startWriting();
        paper.classList.remove("is-swapping");
      }, 320);
    });
  }

  /* ---------------------------------------------------------
     THE KEYWORD PROMPT
     --------------------------------------------------------- */
  const lockEl = $("#lock"),
    lockForm = $("#lock-form"),
    lockInput = $("#lock-input"),
    lockMsg = $("#lock-msg"),
    lockHint = $("#lock-hint"),
    lockNum = $("#lock-num"),
    lockTitle = $("#lock-title"),
    lockGo = $("#lock-go"),
    lockCard = $(".lock__card", lockEl);
  let lockState = null; // { i, resolve, from, readerWas }

  function ensureUnlocked(i, from) {
    if (BODY[i]) return Promise.resolve(true);
    if (lockState) return Promise.resolve(false);
    return new Promise((resolve) => {
      const L = LETTERS[i];
      lockState = {
        i,
        resolve,
        from: from || document.activeElement,
        readerWas: reader.inert,
      };
      lockNum.textContent = "Letter " + L.n;
      lockTitle.textContent = subtle
        ? "This one is sealed"
        : "This needs a secure connection";
      lockHint.textContent = subtle
        ? L.hint || "Type the keyword Keefa gave you."
        : "Open the site over https to unseal letters.";
      lockMsg.textContent = "";
      lockInput.value = "";
      lockInput.disabled = lockGo.disabled = !subtle;
      mainEl.inert = true;
      reader.inert = true;
      lockEl.hidden = false;
      void lockEl.offsetWidth;
      lockEl.classList.add("is-on");
      setTimeout(
        () => lockInput.focus({ preventScroll: true }),
        reduce ? 0 : 120,
      );
    });
  }
  function closeLock(ok) {
    if (!lockState) return;
    const st = lockState;
    lockState = null;
    lockEl.classList.remove("is-on");
    reader.inert = st.readerWas;
    mainEl.inert = !reader.hidden;
    setTimeout(
      () => {
        lockEl.hidden = true;
      },
      reduce ? 0 : 400,
    );
    if (!ok && st.from && st.from.focus) st.from.focus({ preventScroll: true });
    st.resolve(ok);
  }
  lockForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!lockState || lockGo.disabled) return;
    const i = lockState.i,
      word = lockInput.value;
    if (!norm(word)) {
      lockInput.focus();
      return;
    }
    lockGo.disabled = true;
    lockMsg.textContent = "Listening…";
    const ok = await tryUnlock(i, word);
    if (!lockState) return;
    if (ok) {
      lockMsg.textContent = "The seal gives way.";
      const r = lockCard.getBoundingClientRect();
      burst(r.left + r.width / 2, r.top + r.height * 0.45, {
        n: 54,
        speed: 5.5,
        life: 1300,
        size: 2.8,
      });
      refreshCards();
      setTimeout(() => closeLock(true), reduce ? 0 : 650);
    } else {
      lockGo.disabled = false;
      lockMsg.textContent = "That is not the word. Try again.";
      lockCard.classList.remove("is-shaking");
      void lockCard.offsetWidth;
      lockCard.classList.add("is-shaking");
      lockInput.select();
    }
  });
  lockEl.addEventListener("click", (e) => {
    if (e.target.closest("[data-lock-close]")) closeLock(false);
  });
  lockInput.addEventListener("input", () => {
    if (lockMsg.textContent.startsWith("That")) lockMsg.textContent = "";
  });

  prevBtn.addEventListener("click", () => go(-1));
  nextBtn.addEventListener("click", () => go(1));
  reader.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) closeReader();
  });
  stage.addEventListener("click", (e) => {
    if (reader.dataset.phase === "intro" && !e.target.closest("[data-close]"))
      skipIntro();
  });
  document.addEventListener("keydown", (e) => {
    if (lockState) {
      // the keyword prompt sits on top and takes the keyboard
      if (e.key === "Escape") {
        e.preventDefault();
        closeLock(false);
      } else if (e.key === "Tab") {
        const f = $$("input, button", lockEl).filter((x) => !x.disabled);
        if (!f.length) return;
        const idx = f.indexOf(document.activeElement);
        e.preventDefault();
        f[
          e.shiftKey ? (idx - 1 + f.length) % f.length : (idx + 1) % f.length
        ].focus();
      }
      return;
    }
    if (reader.hidden) return;
    if (e.key === "Escape") {
      closeReader();
    } else if (e.key === "ArrowRight") {
      go(1);
    } else if (e.key === "ArrowLeft") {
      go(-1);
    } else if (
      (e.key === " " || e.key === "Enter") &&
      reader.dataset.phase === "intro"
    ) {
      e.preventDefault();
      skipIntro();
    } else if (e.key === "Tab") {
      const f = [$("#reader-close"), prevBtn, nextBtn, paper].filter(
        (x) => x && !x.disabled,
      );
      const idx = f.indexOf(document.activeElement);
      e.preventDefault();
      const next = e.shiftKey
        ? f[(idx - 1 + f.length) % f.length]
        : f[(idx + 1) % f.length];
      next.focus();
    }
  });

  /* ---------------------------------------------------------
     THE NINTH STAR
     --------------------------------------------------------- */
  const cons = $("#constellation");
  const caption = $("#ninth-caption");
  const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX"];
  const DESKTOP = {
    W: 1000,
    H: 380,
    pts: [
      [70, 260],
      [177, 205],
      [285, 240],
      [392, 170],
      [500, 215],
      [607, 140],
      [715, 180],
      [822, 110],
      [930, 66],
    ],
  };
  const PHONE = {
    W: 420,
    H: 700,
    pts: [
      [130, 70],
      [270, 135],
      [150, 200],
      [260, 265],
      [120, 330],
      [275, 395],
      [160, 460],
      [250, 525],
      [205, 620],
    ],
  };
  let skyMode = "",
    ninthAwake = false;

  function buildConstellation() {
    const phone = window.innerWidth < 700;
    const mode = phone ? "p" : "d";
    if (mode === skyMode) return;
    skyMode = mode;
    const C = phone ? PHONE : DESKTOP;
    cons.setAttribute("viewBox", `0 0 ${C.W} ${C.H}`);
    const first8 = C.pts.slice(0, 8);
    let h = `<polyline class="c-line" points="${first8.map((p) => p.join(",")).join(" ")}"/>`;
    h += `<line class="c-line c-line--next" x1="${C.pts[7][0]}" y1="${C.pts[7][1]}" x2="${C.pts[8][0]}" y2="${C.pts[8][1]}"/>`;
    first8.forEach(([x, y], i) => {
      const s = 14 + (i % 3) * 3;
      const left = x < C.W / 2;
      const tx = phone ? (left ? x + 32 : x - 32) : x;
      const ty = phone ? y + 6 : y + s + 26;
      const anchor = phone ? (left ? "start" : "end") : "middle";
      h += `<g transform="translate(${x} ${y})"><g class="cstar__in cstar" style="--i:${i}"><use href="#star4" x="${-s}" y="${-s}" width="${s * 2}" height="${s * 2}"/></g></g>`;
      h += `<text class="c-num" style="--i:${i}" x="${tx}" y="${ty}" text-anchor="${anchor}">${ROMAN[i]}</text>`;
    });
    const [nx, ny] = C.pts[8];
    const nleft = nx < C.W / 2;
    const ntx = phone ? (nleft ? nx + 40 : nx - 40) : nx;
    const nty = phone ? ny + 6 : ny + 56;
    h += `<g class="ninth__g${ninthAwake ? " awake" : ""}" transform="translate(${nx} ${ny})" tabindex="0" role="button" aria-label="The ninth star. Not written yet.">
      <circle class="ninth__halo" r="30"/><circle class="ninth__ring" r="27"/>
      <use class="ninth__star" href="#star4" x="-17" y="-17" width="34" height="34"/>
      <circle r="50" fill="transparent"/>
      <text class="c-num" style="--i:8;opacity:1" x="${ntx - nx}" y="${nty - ny}" text-anchor="${phone ? (nleft ? "start" : "end") : "middle"}">IX</text>
    </g>`;
    cons.innerHTML = h;
  }
  function wakeNinth() {
    const g = $(".ninth__g", cons);
    if (!g) return;
    const first = !ninthAwake;
    ninthAwake = true;
    g.classList.add("awake");
    const r = $(".ninth__star", cons).getBoundingClientRect();
    burst(r.left + r.width / 2, r.top + r.height / 2, {
      n: first ? 46 : 20,
      speed: 5,
      life: 1500,
      size: 2.6,
      gravity: 0.02,
    });
    caption.textContent = `Not written yet. I'm looking forward to it.`;
  }
  cons.addEventListener("click", (e) => {
    if (e.target.closest(".ninth__g")) wakeNinth();
  });
  cons.addEventListener("keydown", (e) => {
    if ((e.key === "Enter" || e.key === " ") && e.target.closest(".ninth__g")) {
      e.preventDefault();
      wakeNinth();
    }
  });

  /* ---------------------------------------------------------
     GATE ("Set sail")
     --------------------------------------------------------- */
  const gate = $("#gate"),
    sailBtn = $("#set-sail");
  function sail() {
    if (sailed) return;
    sailed = true;
    body.classList.add("sailed");
    const r = sailBtn.getBoundingClientRect();
    burst(r.left + r.width / 2, r.top + r.height / 2, {
      n: 70,
      speed: 7,
      life: 1500,
      size: 3,
    });
    gate.classList.add("is-leaving");
    mainEl.inert = false;
    setTimeout(() => {
      gate.hidden = true;
      root.classList.remove("locked");
      buildRoute();
    }, 1500);
  }
  sailBtn.addEventListener("click", sail);

  /* ---------------------------------------------------------
     PARALLAX, PROGRESS, CURSOR, REVEAL
     --------------------------------------------------------- */
  const depthEls = $$("[data-depth]");
  const heroContent = $("#hero-content");
  const progBar = $("#progress-bar"),
    progShip = $("#progress-ship");
  const cursor = $("#cursor");
  let cx = -100,
    cy = -100,
    tcx = -100,
    tcy = -100;

  window.addEventListener(
    "pointermove",
    (e) => {
      tmx = e.clientX / window.innerWidth - 0.5;
      tmy = e.clientY / window.innerHeight - 0.5;
      tcx = e.clientX;
      tcy = e.clientY;
      if (fine && !reduce && Math.random() < 0.45)
        burst(e.clientX, e.clientY, {
          n: 1,
          speed: 0.7,
          life: 650,
          size: 1.7,
          gravity: 0.01,
        });
    },
    { passive: true },
  );

  if (fine && !reduce) {
    root.classList.add("has-cursor");
    document.addEventListener("pointerover", (e) => {
      cursor.classList.toggle(
        "is-hover",
        !!e.target.closest('a, button, [role="button"], .moon'),
      );
    });
  }

  // moon easter egg
  $("#moon").addEventListener("click", (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    burst(r.left + r.width / 2, r.top + r.height / 2, {
      n: 36,
      speed: 5,
      life: 1400,
      size: 2.6,
      gravity: 0.02,
    });
    for (let i = 0; i < 3; i++) setTimeout(() => spawnShooter(), i * 220);
  });

  // reveal on scroll
  const reveals = $$(".reveal");
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (es) =>
        es.forEach((en) => {
          if (en.isIntersecting) {
            en.target.classList.add("in");
            io.unobserve(en.target);
          }
        }),
      { threshold: 0.15, rootMargin: "0px 0px -8% 0px" },
    );
    reveals.forEach((el) => io.observe(el));
  } else {
    reveals.forEach((el) => el.classList.add("in"));
  }

  /* ---------------------------------------------------------
     MAIN LOOP
     --------------------------------------------------------- */
  let last = 0;
  function tick(t) {
    const dt = Math.min(48, t - last || 16);
    last = t;
    const k = reduce ? 1 : 0.06;
    mx += (tmx - mx) * k;
    my += (tmy - my) * k;
    const sy = window.scrollY,
      vh = window.innerHeight;

    paintStars(t, dt);
    drawFx(dt);

    if (sy < vh * 1.3) {
      for (const el of depthEls) {
        const d = +el.dataset.depth;
        el.style.transform = `translate3d(${(-mx * d).toFixed(2)}px, ${(-my * d * 0.6 + sy * d * 0.012).toFixed(2)}px, 0)`;
      }
      const f = clamp(sy / (vh * 0.7), 0, 1);
      heroContent.style.transform = `translate3d(0, ${(sy * 0.25).toFixed(1)}px, 0)`;
      heroContent.style.opacity = String(1 - f);
    }

    const max = document.documentElement.scrollHeight - vh;
    const p = max > 0 ? clamp(sy / max, 0, 1) : 0;
    progBar.style.transform = `scaleX(${p.toFixed(4)})`;
    progShip.style.left = (p * 100).toFixed(2) + "%";

    if (route.len) {
      const r = stopsBox.getBoundingClientRect();
      shipTarget = clamp(vh * 0.5 - r.top, 0, r.height);
      shipY += (shipTarget - shipY) * (reduce ? 1 : 0.1);
      placeShip(shipY);
    }

    if (root.classList.contains("has-cursor")) {
      cx += (tcx - cx) * 0.22;
      cy += (tcy - cy) * 0.22;
      cursor.style.transform = `translate3d(${cx.toFixed(1)}px, ${cy.toFixed(1)}px, 0)`;
    }
    requestAnimationFrame(tick);
  }

  /* ---------------------------------------------------------
     BOOT
     --------------------------------------------------------- */
  sizeCanvases();
  buildConstellation();
  refreshCards();
  buildRoute();
  // letters already unlocked on this device stay unlocked
  if (subtle) {
    Promise.all(
      LETTERS.map((_, i) =>
        vault[i]
          ? decryptLetter(i, vault[i]).then(
              (b) => {
                BODY[i] = b;
              },
              () => {
                delete vault[i];
              },
            )
          : null,
      ),
    ).then(() => {
      saveVault();
      refreshCards();
    });
  }

  // iOS Safari fires resize whenever its toolbar collapses/expands (height only);
  // keep the starfield and route as they are for those small vertical changes.
  let rz,
    lastW = window.innerWidth,
    lastH = window.innerHeight;
  window.addEventListener("resize", () => {
    clearTimeout(rz);
    rz = setTimeout(() => {
      const w = window.innerWidth,
        h = window.innerHeight;
      const layoutChanged = w !== lastW || Math.abs(h - lastH) > 160;
      lastW = w;
      lastH = h;
      sizeCanvases(layoutChanged);
      if (layoutChanged) {
        buildConstellation();
        buildRoute();
      }
    }, 150);
  });
  window.addEventListener("load", () => {
    buildRoute();
  });
  if (document.fonts && document.fonts.ready)
    document.fonts.ready.then(buildRoute);

  if (/[?&]skip\b/.test(location.search)) {
    sailed = true;
    body.classList.add("sailed");
    gate.hidden = true;
  } else {
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    window.scrollTo(0, 0);
    root.classList.add("locked");
    mainEl.inert = true;
    sailBtn.focus({ preventScroll: true });
  }

  requestAnimationFrame(tick);
})();
