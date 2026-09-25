"use strict";

/* ============================================================
 * 共通
 * ============================================================ */
const SITES = {
  asmrone: "asmr.one",
  asmr18: "asmr18.fans",
  japaneseasmr: "japaneseasmr.com",
  hentaiasmr: "hentaiasmr.moe",
  jasmr: "jasmr.net",
};
const DEFAULT_ORDER = Object.keys(SITES);

const $ = (sel, root = document) => root.querySelector(sel);
const app = $("#app");

const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* 保存できなくても動作は継続 */
    }
  },
};

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function fmtTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = String(sec % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

function stars(r) {
  const full = Math.round(r || 0);
  return "★".repeat(full) + "☆".repeat(Math.max(0, 5 - full));
}

function toast(msg, kind = "", ms = 4000) {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $("#toasts").appendChild(el);
  setTimeout(() => el.remove(), ms);
}

/**
 * API サーバーのURL。
 * - Bun サーバー（bun start / exe / Docker）: 画面と同じサーバーなので空（同じオリジン）
 * - GitHub Pages などの静的配置: Cloudflare Worker のURL（config.js か、設定画面で指定）
 */
const API_BASE = (store.get("apiBase", "") || (window.ASMR_CONFIG && window.ASMR_CONFIG.apiBase) || "").replace(/\/+$/, "");
/** 静的配置（API サーバーが画面と別）で動いているか */
const STATIC_MODE = !!(window.ASMR_CONFIG && window.ASMR_CONFIG.static);

/** API の中継URL（/api/proxy?url=...）は API サーバー側のURLにする */
function mediaUrl(src) {
  return src && src.startsWith("/api/") ? API_BASE + src : src;
}

async function api(path) {
  if (STATIC_MODE && !API_BASE) throw new Error("API サーバー（Cloudflare Worker）のURLが設定されていません。「サーバー状況・設定」で設定してください");
  const res = await fetch(API_BASE + path);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

/** DLsite の作品コード（RJ / VJ / BJ）。数字だけなら RJ とみなす */
function normalizeRJ(s) {
  const m = String(s).trim().match(/^(RJ|VJ|BJ)?0*(\d{1,8})$/i);
  if (!m) return null;
  const prefix = (m[1] || "RJ").toUpperCase();
  const raw = String(s).trim().replace(/^(RJ|VJ|BJ)/i, "");
  const num = m[2];
  if (raw.length === 8 || num.length === 7) return prefix + num.padStart(8, "0");
  if (num.length === 8) return prefix + num;
  return prefix + num.padStart(6, "0");
}

/** DLsite の画像URL（RJ: 同人 / VJ: 商業 / BJ: 書籍 でフォルダが違う） */
function dlsiteCover(rj, kind = "main") {
  const prefix = /^(VJ|BJ)/i.test(rj) ? rj.slice(0, 2).toUpperCase() : "RJ";
  const dir = { RJ: "doujin", VJ: "professional", BJ: "books" }[prefix];
  const digits = rj.replace(/^(RJ|VJ|BJ)/i, "");
  const n = Number(digits);
  const bucket = n % 1000 === 0 ? n : (Math.floor(n / 1000) + 1) * 1000;
  return `https://img.dlsite.jp/modpub/images2/work/${dir}/${prefix}${String(bucket).padStart(digits.length, "0")}/${rj}_img_${kind}.jpg`;
}

/** 画像が読めなかったら 代替画像（data-alt）→ DLsite の img_main の順に差し替え */
document.addEventListener(
  "error",
  (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement)) return;
    if (img.dataset.alt && !img.dataset.altTried) {
      img.dataset.altTried = "1";
      img.src = img.dataset.alt;
    } else if (img.dataset.rj && !img.dataset.fallen) {
      img.dataset.fallen = "1";
      img.src = dlsiteCover(img.dataset.rj);
    }
  },
  true,
);

/** 設定: サイト優先順位と有効/無効 */
const settings = {
  get order() {
    const saved = store.get("siteOrder.v3", DEFAULT_ORDER).filter((s) => SITES[s]);
    return [...saved, ...DEFAULT_ORDER.filter((s) => !saved.includes(s))];
  },
  set order(v) {
    store.set("siteOrder.v3", v);
  },
  get disabled() {
    return store.get("siteDisabled.v3", []);
  },
  set disabled(v) {
    store.set("siteDisabled.v3", v);
  },
  get enabledSites() {
    const off = this.disabled;
    return this.order.filter((s) => !off.includes(s));
  },
};

/* ============================================================
 * ルーター
 * ============================================================ */
function parseHash() {
  const raw = location.hash.replace(/^#/, "") || "/";
  const [path, qs] = raw.split("?");
  return { path, params: new URLSearchParams(qs || "") };
}

function go(path, params) {
  const qs = params && [...params].length ? `?${params}` : "";
  location.hash = `#${path}${qs}`;
}

function searchFor(q) {
  const rj = normalizeRJ(q.replace(/\s+/g, ""));
  if (rj && /^(rj|vj|bj)?\d{6,8}$/i.test(q.trim())) return go(`/work/${rj}`);
  go(`/search/${encodeURIComponent(q.trim())}`);
}

let routeToken = 0;
async function route() {
  const token = ++routeToken;
  const { path, params } = parseHash();
  document.body.classList.remove("drawer-open");
  let m;
  let nav = "home";
  if (STATIC_MODE && !API_BASE && path !== "/status") {
    app.innerHTML = `<div class="empty setup">
      <span class="ms" style="font-size:48px">cloud_off</span>
      <h2>API サーバーが設定されていません</h2>
      <p>この画面は静的ファイルとして配置されています。各サイトから作品情報を取得するには、Cloudflare Worker などで動かした API サーバーのURLを設定してください。</p>
      <a class="btn primary" href="#/status"><span class="ms">settings</span>設定を開く</a>
    </div>`;
    document.querySelectorAll(".drawer a").forEach((a) => a.classList.toggle("active", false));
    return;
  }
  if ((m = path.match(/^\/work\/([^/]+)/))) {
    nav = "";
    await renderWork(decodeURIComponent(m[1]), token);
  } else if ((m = path.match(/^\/search\/(.+)$/))) {
    nav = "";
    const q = decodeURIComponent(m[1]);
    $("#searchInput").value = q;
    await renderSearch(q, params, token);
  } else if (path === "/ranking") {
    nav = "ranking";
    renderRanking(params, token);
  } else if (path === "/status") {
    nav = "status";
    await renderStatus(token);
  } else if (path === "/queue") {
    nav = "queue";
    renderQueuePage();
  } else if (path === "/history") {
    nav = "history";
    renderHistory();
  } else {
    const order = params.get("order") || "create_date";
    nav = { dl_count: "popular", rate_average_2dp: "rated", random: "random" }[order] || "home";
    await renderHome(params, token);
  }
  document.querySelectorAll(".drawer a").forEach((a) => a.classList.toggle("active", a.dataset.nav === nav));
}

/* ============================================================
 * 作品一覧（asmr.one 風カード）
 * ============================================================ */
const ORDERS = [
  ["create_date", "登録日時"],
  ["release", "発売日"],
  ["dl_count", "売上"],
  ["price", "価格"],
  ["rate_average_2dp", "評価"],
  ["review_count", "レビュー数"],
  ["id", "RJ番号"],
  ["random", "ランダム"],
];

function workCard(w) {
  // 一覧では img_sam（小さい画像）は使わず img_main 相当を使う
  const cover = w.cover || dlsiteCover(w.rj);
  const age = w.age ? `<span class="badge age ${w.age}">${{ r18: "R18", r15: "R15", all: "全年齢" }[w.age]}</span>` : "";
  const sub = w.hasSubtitle ? `<span class="badge sub">字幕</span>` : "";
  const dur = w.duration ? `<span class="badge dur">${fmtTime(w.duration)}</span>` : "";
  const rating =
    w.rating != null
      ? `<span class="stars">${stars(w.rating)}</span><span>${w.rating.toFixed(2)}${w.rateCount ? ` (${w.rateCount})` : ""}</span>`
      : "";
  const price = w.price != null ? `<span class="price">${w.price.toLocaleString()} 円</span>` : "";
  const sales =
    (w.periodSales != null ? `<span class="period-sales">期間販売数: ${w.periodSales.toLocaleString()}</span>` : "") +
    (w.dlCount != null ? `<span>売上: ${w.dlCount.toLocaleString()}</span>` : "");
  const rank = w.rank ? `<span class="badge rank ${w.rank <= 3 ? `top${w.rank}` : ""}">${w.rank}位</span>` : "";
  const tags = (w.tags || []).slice(0, 10).map((t) => `<span class="chip" data-q="${esc(t)}">${esc(t)}</span>`).join("");
  const vas = (w.vas || []).map((v) => `<span class="chip va" data-q="${esc(v)}">${esc(v)}</span>`).join("");
  const srcs =
    (w.sources || []).map((s) => `<span class="src">${esc(SITES[s] || s)}</span>`).join("") +
    (w.translatedFrom || []).map((rj) => `<span class="src" title="翻訳版を日本語版にまとめました">翻訳版 ${esc(rj)}</span>`).join("");
  return `<article class="card">
    <a class="card-cover" href="#/work/${w.rj}">
      <img loading="lazy" src="${esc(cover)}" data-rj="${w.rj}" ${w.coverAlt ? `data-alt="${esc(w.coverAlt)}"` : ""} alt="" />
      ${rank}<span class="badge rj ${w.rank ? "with-rank" : ""}">${w.rj}</span>${age}${sub}${dur}
    </a>
    <div class="card-body">
      <a class="card-title" href="#/work/${w.rj}" title="${esc(w.title)}">${esc(w.title)}</a>
      ${w.circle ? `<span class="circle" data-q="${esc(w.circle)}">${esc(w.circle)}</span>` : ""}
      ${rating || price || sales ? `<div class="rating">${rating}${price}${sales}</div>` : ""}
      ${tags ? `<div class="chips">${tags}</div>` : ""}
      ${vas ? `<div class="chips">${vas}</div>` : ""}
      ${srcs ? `<div class="srcs">${srcs}</div>` : ""}
    </div>
  </article>`;
}

function pager(page, hasNext, totalPages) {
  const btn = (p, label = p, on = false, dis = false) =>
    `<button data-page="${p}" class="${on ? "on" : ""}" ${dis ? "disabled" : ""}>${label}</button>`;
  let html = btn(page - 1, '<span class="ms">chevron_left</span>', false, page <= 1);
  if (totalPages) {
    const pages = new Set([1, totalPages]);
    for (let p = page - 2; p <= page + 2; p++) if (p >= 1 && p <= totalPages) pages.add(p);
    let last = 0;
    for (const p of [...pages].sort((a, b) => a - b)) {
      if (p - last > 1) html += `<button disabled>…</button>`;
      html += btn(p, p, p === page);
      last = p;
    }
  } else {
    html += btn(page, page, true);
  }
  html += btn(page + 1, '<span class="ms">chevron_right</span>', false, !hasNext);
  return html;
}

/* ---------- 除外タグ ---------- */
const tagFilter = {
  get list() {
    return store.get("excludedTags", []);
  },
  set list(v) {
    store.set("excludedTags", [...new Set(v.map((t) => String(t).trim()).filter(Boolean))]);
  },
  add(tag) {
    this.list = [...this.list, tag];
  },
  remove(tag) {
    this.list = this.list.filter((t) => t !== tag);
  },
  /** 除外タグのどれかを持つ作品を除く */
  apply(works) {
    const ex = new Set(this.list);
    if (!ex.size) return { shown: works, hidden: 0 };
    const shown = works.filter((w) => !(w.tags || []).some((t) => ex.has(t)));
    return { shown, hidden: works.length - shown.length };
  },
};

function filterPanelHtml(works) {
  const ex = tagFilter.list;
  const freq = new Map();
  for (const w of works) for (const t of w.tags || []) freq.set(t, (freq.get(t) || 0) + 1);
  const common = [...freq.entries()]
    .filter(([t]) => !ex.includes(t))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 24);
  return `
    <div class="filter-row">
      <input class="select" id="filterInput" list="filterTags" placeholder="除外するタグを入力して Enter" />
      <datalist id="filterTags">${[...freq.keys()].map((t) => `<option value="${esc(t)}"></option>`).join("")}</datalist>
      <button class="btn" id="filterAdd"><span class="ms">add</span>追加</button>
      ${ex.length ? `<button class="btn" id="filterClear"><span class="ms">clear_all</span>すべて解除</button>` : ""}
    </div>
    <div class="filter-row"><span class="filter-label">除外中</span>
      ${ex.length ? ex.map((t) => `<span class="chip ex" data-unexclude="${esc(t)}" title="クリックで解除">${esc(t)}<span class="ms">close</span></span>`).join("") : `<span class="muted">なし</span>`}
    </div>
    ${common.length ? `<div class="filter-row"><span class="filter-label">このページのタグ</span>${common.map(([t, n]) => `<span class="chip add" data-exclude="${esc(t)}" title="クリックで除外"><span class="ms">remove</span>${esc(t)} <small>${n}</small></span>`).join("")}</div>` : ""}`;
}

function listToolbar(title, params, { subtitle = false, sortable = true } = {}) {
  const order = params.get("order") || "create_date";
  const sort = params.get("sort") || "desc";
  const view = store.get("viewMode", "grid");
  const n = tagFilter.list.length;
  return `<div class="toolbar">
    <h1>${title} <span class="count" id="listCount"></span></h1>
    ${sortable ? `<select class="select" id="order">${ORDERS.map(([v, l]) => `<option value="${v}" ${v === order ? "selected" : ""}>${l}</option>`).join("")}</select>
    <div class="seg">
      <button data-sort="desc" class="${sort === "desc" ? "on" : ""}" title="降順"><span class="ms">arrow_downward</span></button>
      <button data-sort="asc" class="${sort === "asc" ? "on" : ""}" title="昇順"><span class="ms">arrow_upward</span></button>
    </div>` : ""}
    ${subtitle ? `<button class="btn ${params.get("subtitle") === "1" ? "primary" : ""}" id="subtitleOnly"><span class="ms">subtitles</span>字幕あり</button>` : ""}
    <button class="btn ${n ? "primary" : ""}" id="filterBtn"><span class="ms">filter_alt</span>除外タグ${n ? ` (${n})` : ""}</button>
    <div class="seg">
      <button data-view="grid" class="${view === "grid" ? "on" : ""}" title="カード"><span class="ms">grid_view</span></button>
      <button data-view="list" class="${view === "list" ? "on" : ""}" title="リスト"><span class="ms">view_list</span></button>
    </div>
  </div>
  <div class="filter-panel" id="filterPanel" ${store.get("filterOpen", false) ? "" : "hidden"}></div>`;
}

function loadingHtml(msg = "読み込み中…") {
  return `<div class="loading"><div class="spinner"></div>${esc(msg)}</div>`;
}

function siteChips(sites, results, labels = {}) {
  return sites
    .map((site) => {
      const s = results[site];
      if (!s) return `<span class="site-chip"><span class="spinner sm"></span>${esc(labels[site] || SITES[site])} 取得中…</span>`;
      return `<span class="site-chip ${s.ok ? "" : "err"}" title="${esc(s.error || "")}">
        <i class="dot" style="background:var(${s.ok ? "--ok" : "--err"})"></i>${esc(s.label)}
        ${s.ok ? `${s.total != null ? s.total.toLocaleString() : s.works.length}件` : esc(s.error || "エラー")} · ${s.ms}ms</span>`;
    })
    .join("");
}

/** 同じ作品の情報をまとめる（asmr.one の情報があればタグ等はそちらを優先） */
function mergeWork(a, b) {
  const bOne = (b.sources || []).includes("asmrone") && !(a.sources || []).includes("asmrone");
  for (const k of ["title", "cover", "coverAlt", "thumb", "circle", "vas", "tags", "rating", "rateCount", "price", "dlCount", "release", "age", "duration", "hasSubtitle"]) {
    const v = b[k];
    if (v == null || (Array.isArray(v) && !v.length)) continue;
    const cur = a[k];
    if (bOne && k !== "title") a[k] = v;
    else if (cur == null || (Array.isArray(cur) && !cur.length)) a[k] = v;
  }
  a.sources = [...new Set([...(a.sources || []), ...(b.sources || [])])];
  a.translatedFrom = [...new Set([...(a.translatedFrom || []), ...(b.translatedFrom || [])])];
  a.links = { ...(b.links || {}), ...(a.links || {}) };
}

/** 各サイトの i 番目を優先順位順に交互に並べ、同じ作品はまとめる */
function combine(lists) {
  const map = new Map();
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i++) {
    for (const l of lists) {
      const w = l[i];
      if (!w) continue;
      const cur = map.get(w.rj);
      if (cur) mergeWork(cur, w);
      else map.set(w.rj, { ...w, vas: [...(w.vas || [])], tags: [...(w.tags || [])], sources: [...(w.sources || [])], links: { ...(w.links || {}) } });
    }
  }
  return [...map.values()];
}

let rerenderList = null;

/**
 * 各サイトへ並列に問い合わせ、届いた順に表示する一覧
 * @param fetchSite (site) => Promise<SiteList>
 */
function renderProgressive({ token, title, params, basePath, sites, fetchSite, subtitle = false, sortable = true, notice = "", emptyText = "見つかりませんでした", extraToolbar = "", siteLabels = {} }) {
  const page = Number(params.get("page")) || 1;
  const results = {};
  const view = store.get("viewMode", "grid");
  app.innerHTML = `<div class="${view === "list" ? "list-mode" : ""}" id="list">
    ${listToolbar(title, params, { subtitle, sortable })}
    ${extraToolbar}
    <div class="site-chips">${notice ? `<span class="site-chip err"><span class="ms">warning</span>${esc(notice)}</span>` : ""}<span id="siteChips" class="site-chips-inner"></span></div>
    <div id="filterInfo"></div>
    <div id="gridArea">${loadingHtml("各サイトに問い合わせ中…")}</div>
    <div class="pager" id="pager"></div>
  </div>`;
  const root = $("#list");

  const render = () => {
    if (token !== routeToken) return;
    const done = sites.filter((s) => results[s]);
    const lists = sites.filter((s) => results[s]?.ok).map((s) => results[s].works);
    const works = combine(lists);
    const { shown, hidden } = tagFilter.apply(works);
    $("#siteChips").innerHTML = siteChips(sites, results, siteLabels);
    const loading = done.length < sites.length;
    $("#listCount").textContent = `${shown.length} 作品${loading ? "（取得中）" : ""}`;
    $("#filterInfo").innerHTML = hidden
      ? `<div class="filter-info"><span class="ms">filter_alt</span>除外タグにより ${hidden} 作品を非表示</div>`
      : "";
    $("#gridArea").innerHTML = shown.length
      ? `<div class="grid">${shown.map(workCard).join("")}</div>${loading ? `<div class="loading" style="padding:20px"><span class="spinner sm"></span> 他のサイトを取得中…</div>` : ""}`
      : loading
        ? loadingHtml("各サイトに問い合わせ中…")
        : `<div class="empty">${hidden ? "すべて除外タグで非表示になっています" : emptyText}</div>`;
    const one = results.asmrone;
    const totalPages = one?.ok && one.total && sites.length === 1 ? Math.ceil(one.total / 20) : 0;
    const hasNext = sites.some((s) => results[s]?.hasNext);
    $("#pager").innerHTML = page === 1 && !hasNext && !loading ? "" : pager(page, hasNext, totalPages);
    const panel = $("#filterPanel");
    if (!panel.hidden) {
      const input = $("#filterInput");
      const keep = input && document.activeElement === input ? input.value : null;
      panel.innerHTML = filterPanelHtml(works);
      if (keep !== null) {
        const next = $("#filterInput");
        next.value = keep;
        next.focus();
      }
    }
  };
  rerenderList = render;

  for (const site of sites) {
    fetchSite(site)
      .catch((e) => ({ site, label: SITES[site], ok: false, works: [], hasNext: false, error: e.message, ms: 0 }))
      .then((r) => {
        if (token !== routeToken) return;
        results[site] = r;
        render();
      });
  }
  render();
  bindListEvents(root, params, basePath);
}

function bindListEvents(root, params, basePath) {
  const updateFilterBtn = () => {
    const n = tagFilter.list.length;
    const b = $("#filterBtn");
    b.classList.toggle("primary", n > 0);
    b.innerHTML = `<span class="ms">filter_alt</span>除外タグ${n ? ` (${n})` : ""}`;
  };
  const addExclude = (tag) => {
    if (!tag) return;
    tagFilter.add(tag);
    updateFilterBtn();
    rerenderList?.();
  };
  root.addEventListener("click", (e) => {
    const ex = e.target.closest("[data-exclude]");
    if (ex) return addExclude(ex.dataset.exclude);
    const unex = e.target.closest("[data-unexclude]");
    if (unex) {
      tagFilter.remove(unex.dataset.unexclude);
      updateFilterBtn();
      return rerenderList?.();
    }
    if (e.target.closest("#filterClear")) {
      tagFilter.list = [];
      updateFilterBtn();
      return rerenderList?.();
    }
    if (e.target.closest("#filterAdd")) return addExclude($("#filterInput").value.trim());
    if (e.target.closest("#filterBtn")) {
      const panel = $("#filterPanel");
      panel.hidden = !panel.hidden;
      store.set("filterOpen", !panel.hidden);
      return rerenderList?.();
    }
    const q = e.target.closest("[data-q]");
    if (q) {
      e.preventDefault();
      searchFor(q.dataset.q);
      return;
    }
    const p = e.target.closest("[data-page]");
    if (p && !p.disabled) {
      params.set("page", p.dataset.page);
      go(basePath, params);
      window.scrollTo(0, 0);
    }
  });
  root.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.id === "filterInput") {
      e.preventDefault();
      addExclude(e.target.value.trim());
    }
  });
  const order = root.querySelector("#order");
  if (order) {
    order.addEventListener("change", () => {
      params.set("order", order.value);
      params.delete("page");
      go(basePath, params);
    });
  }
  root.querySelectorAll("[data-sort]").forEach((b) =>
    b.addEventListener("click", () => {
      params.set("sort", b.dataset.sort);
      params.delete("page");
      go(basePath, params);
    }),
  );
  root.querySelectorAll("[data-view]").forEach((b) =>
    b.addEventListener("click", () => {
      store.set("viewMode", b.dataset.view);
      root.classList.toggle("list-mode", b.dataset.view === "list");
      root.querySelectorAll("[data-view]").forEach((x) => x.classList.toggle("on", x === b));
    }),
  );
  const sub = root.querySelector("#subtitleOnly");
  if (sub) {
    sub.addEventListener("click", () => {
      params.set("subtitle", params.get("subtitle") === "1" ? "0" : "1");
      params.delete("page");
      go(basePath, params);
    });
  }
}

async function renderHome(params, token) {
  const page = Number(params.get("page")) || 1;
  const order = params.get("order") || "create_date";
  const sort = params.get("sort") || "desc";
  const subtitle = params.get("subtitle") === "1";
  const isLatest = order === "create_date" && sort === "desc" && !subtitle;
  const title = { dl_count: "人気作品", rate_average_2dp: "高評価作品", random: "ランダム" }[order] || "新着作品";
  const hasOne = settings.enabledSites.includes("asmrone");
  const latest = (notice = "") =>
    renderProgressive({
      token,
      title: "新着作品",
      params,
      basePath: "/",
      sites: settings.enabledSites,
      fetchSite: (site) => api(`/api/latest?site=${site}&page=${page}`),
      subtitle: hasOne,
      notice,
      emptyText: "作品を取得できませんでした",
    });
  if (isLatest || !hasOne) return latest(isLatest ? "" : "並び替えは asmr.one でのみ可能です（asmr.one が無効になっています）");

  // 人気・評価などの並び替えは asmr.one のみ
  app.innerHTML = loadingHtml();
  const qs = new URLSearchParams({ page, order, sort, subtitle: subtitle ? "1" : "0" });
  const r = await api(`/api/works?${qs}`).catch((e) => ({ ok: false, error: e.message }));
  if (token !== routeToken) return;
  if (!r.ok) return latest(`並び替えは asmr.one でのみ可能ですが、接続できないため新着を表示しています（${r.error || ""}）`);
  renderProgressive({ token, title, params, basePath: "/", sites: ["asmrone"], fetchSite: async () => r, subtitle: true });
}

const RANKING_TERMS = [
  ["day", "24時間"],
  ["week", "7日間"],
  ["month", "30日間"],
  ["year", "年間"],
  ["total", "累計"],
];

/** DLsite の「ボイス・ASMR」ランキング（100件） */
function renderRanking(params, token) {
  const term = RANKING_TERMS.some(([v]) => v === params.get("term")) ? params.get("term") : "day";
  const sort = params.get("sort") === "sale" ? "sale" : "popular";
  const extraToolbar = `<div class="toolbar ranking-bar">
    <div class="seg">${RANKING_TERMS.map(([v, l]) => `<button data-term="${v}" class="${v === term ? "on" : ""}">${l}</button>`).join("")}</div>
    <div class="seg">
      <button data-rsort="popular" class="${sort === "popular" ? "on" : ""}">人気順</button>
      <button data-rsort="sale" class="${sort === "sale" ? "on" : ""}">販売数順</button>
    </div>
  </div>`;
  renderProgressive({
    token,
    title: "DLsite ランキング（ボイス・ASMR）",
    params,
    basePath: "/ranking",
    sites: ["dlsite"],
    siteLabels: { dlsite: "DLsite" },
    sortable: false,
    extraToolbar,
    emptyText: "ランキングを取得できませんでした",
    fetchSite: () => api(`/api/ranking?term=${term}&sort=${sort}`),
  });
  const root = $("#list");
  root.querySelectorAll("[data-term]").forEach((b) =>
    b.addEventListener("click", () => go("/ranking", new URLSearchParams({ term: b.dataset.term, sort }))),
  );
  root.querySelectorAll("[data-rsort]").forEach((b) =>
    b.addEventListener("click", () => go("/ranking", new URLSearchParams({ term, sort: b.dataset.rsort }))),
  );
}

function renderSearch(q, params, token) {
  const page = Number(params.get("page")) || 1;
  renderProgressive({
    token,
    title: `「${esc(q)}」の検索結果`,
    params,
    basePath: `/search/${encodeURIComponent(q)}`,
    sites: settings.enabledSites,
    fetchSite: (site) => {
      const qs = new URLSearchParams({ site, q, page, order: params.get("order") || "create_date", sort: params.get("sort") || "desc" });
      return api(`/api/search?${qs}`);
    },
  });
}

/* ============================================================
 * 作品詳細 + トラックツリー
 * ============================================================ */
const workState = {
  rj: null,
  meta: null,
  sources: {}, // site -> {status: 'loading'|'ok'|'notfound'|'error', data}
  selected: null,
  manual: false,
  path: [],
};

function nodeIcon(n) {
  if (n.type === "folder") return "folder";
  if (n.type === "audio") return "music_note";
  if (n.type === "image") return "image";
  if (n.type === "text") return /\.(lrc|vtt|srt|ass)$/i.test(n.title) ? "subtitles" : "description";
  return "draft";
}

function currentFolder() {
  const src = workState.sources[workState.selected];
  let nodes = src?.data?.tree || [];
  for (const name of workState.path) {
    const next = nodes.find((n) => n.type === "folder" && n.title === name);
    if (!next) {
      workState.path = [];
      return src?.data?.tree || [];
    }
    nodes = next.children || [];
  }
  return nodes;
}

function countAudios(nodes) {
  return nodes.reduce((n, x) => n + (x.type === "audio" ? 1 : 0) + countAudios(x.children || []), 0);
}

function toQueueItem(n) {
  const m = workState.meta || {};
  return {
    title: n.title,
    src: n.src,
    stream: n.stream || "file",
    start: n.start || 0,
    end: n.end ?? null,
    duration: n.duration ?? null,
    expectTotal: n.expectTotal ?? null,
    estimated: n.estimated || "",
    rj: workState.rj,
    workTitle: m.title || workState.rj,
    cover: m.cover || dlsiteCover(workState.rj),
    thumb: m.thumb || dlsiteCover(workState.rj, "sam"),
    site: workState.selected,
  };
}

function renderSources() {
  const el = $("#sources");
  if (!el) return;
  const sites = settings.enabledSites;
  el.innerHTML = sites
    .map((site) => {
      const s = workState.sources[site] || { status: "idle" };
      const sel = workState.selected === site ? "selected" : "";
      let icon = '<span class="ms">radio_button_unchecked</span>';
      let extra = "<small>未確認</small>";
      if (s.status === "loading") {
        icon = '<span class="spinner sm"></span>';
        extra = s.slow ? "<small>応答待ち（時間がかかっています）</small>" : "<small>確認中</small>";
      } else if (s.status === "ok") {
        icon = '<span class="ms">check_circle</span>';
        const noteLabel = s.data.note ? (/Cloudflare/.test(s.data.note) ? "・本編のみ" : "・別言語版") : "";
        extra = `<small>${s.data.audioCount}トラック${s.data.split ? "・分割" : ""}${noteLabel} · ${s.data.elapsedMs}ms</small>`;
      } else if (s.status === "notfound") {
        icon = '<span class="ms">block</span>';
        extra = "<small>未掲載</small>";
      } else if (s.status === "error") {
        icon = s.data?.challenge ? '<span class="ms">shield</span>' : '<span class="ms">error</span>';
        extra = s.data?.challenge ? "<small>Cloudflare認証で保護中</small>" : "<small>エラー</small>";
      }
      const title = s.status === "error" ? esc(s.data?.message || "") : s.status === "idle" ? "クリックで確認" : "";
      return `<button class="source ${s.status} ${sel}" data-site="${site}" title="${title}">${icon}${esc(SITES[site])}${extra}</button>`;
    })
    .join("");
  // Cloudflare 認証で取得できないサイトは、利用者がサイトで直接見られるようリンクを出す
  for (const x of sites) {
    const d = workState.sources[x]?.data;
    if (!d?.challenge) continue;
    el.insertAdjacentHTML(
      "beforeend",
      `<div class="challenge-note"><span class="ms">shield</span>${esc(SITES[x])} は Cloudflare の認証（ボット確認）で保護されているため、このアプリからは取得できません。${
        d.openUrl ? `<a href="${esc(d.openUrl)}" target="_blank" rel="noreferrer">${esc(SITES[x])} で直接開く<span class="ms">open_in_new</span></a>` : ""
      }</div>`,
    );
  }
  const idle = sites.filter((x) => !workState.sources[x]);
  const loading = sites.some((x) => workState.sources[x]?.status === "loading");
  if (idle.length && !loading) {
    el.insertAdjacentHTML("beforeend", `<button class="btn" id="checkRest"><span class="ms">travel_explore</span>残り${idle.length}サイトも確認</button>`);
  }
  const avail = sites.filter((x) => workState.sources[x]?.status === "ok");
  $("#sourceSummary").textContent = loading
    ? "優先順位順に確認中…"
    : `${avail.length}サイトで配信中${idle.length ? `（${idle.length}サイト未確認）` : ` / ${sites.length}サイト中`}`;
}

function renderTree() {
  const el = $("#treeArea");
  if (!el) return;
  const src = workState.sources[workState.selected];
  if (!src) {
    const loading = settings.enabledSites.some((s) => workState.sources[s]?.status === "loading");
    const idle = settings.enabledSites.some((s) => !workState.sources[s]);
    el.innerHTML = loading || (idle && !Object.keys(workState.sources).length)
      ? loadingHtml("配信元を探しています…")
      : `<div class="empty">${idle ? "確認したサイトには見つかりませんでした" : "どのサイトにも見つかりませんでした"}</div>`;
    return;
  }
  const data = src.data;
  const nodes = currentFolder();
  const crumbs = [`<a data-crumb="0"><span class="ms" style="font-size:18px;vertical-align:-4px">home</span></a>`]
    .concat(
      workState.path.map((p, i) =>
        i === workState.path.length - 1
          ? `<span class="sep">/</span><span class="cur">${esc(p)}</span>`
          : `<span class="sep">/</span><a data-crumb="${i + 1}">${esc(p)}</a>`,
      ),
    )
    .join("");
  const playing = player.current();
  const estimated = countAudios(data.tree) && JSON.stringify(data.tree).includes('"estimated"');
  const note = data.split
    ? `<div class="source-note"><span class="ms">content_cut</span>1つにまとめられた音声を${estimated ? "他サイトのトラック情報を元に" : "チャプター情報を元に"}トラックに分割しています。${estimated ? "位置が多少ずれる場合があります。" : ""}</div>`
    : "";
  const items = nodes
    .map((n, i) => {
      const isPlaying =
        playing && n.type === "audio" && playing.src === n.src && (playing.start || 0) === (n.start || 0) && playing.end === (n.end ?? null);
      const sub = [];
      if (n.type === "folder") sub.push(`${countAudios(n.children || [])} 音声`);
      if (n.duration) sub.push(fmtTime(n.duration));
      if (n.virtual) sub.push(`<span class="tag-virtual">${fmtTime(n.start)}〜${n.end != null ? fmtTime(n.end) : ""}</span>`);
      if (n.estimated) sub.push(`<span class="tag-est" title="${esc(n.estimated)}">推定</span>`);
      if (n.stream === "hls") sub.push("HLS");
      const action =
        n.type === "audio"
          ? `<button class="icon-btn" data-enqueue="${i}" title="キューに追加"><span class="ms">playlist_add</span></button>`
          : n.src
            ? `<a class="icon-btn" href="${esc(mediaUrl(n.src))}" target="_blank" rel="noreferrer" title="新しいタブで開く" data-stop><span class="ms">open_in_new</span></a>`
            : "";
      return `<li class="${n.type} ${isPlaying ? "playing" : ""}" data-i="${i}">
        <span class="ms t-icon ${n.type === "folder" ? "fill" : ""}">${isPlaying ? "graphic_eq" : nodeIcon(n)}</span>
        <div class="t-main"><div class="t-title">${esc(n.title)}</div>${sub.length ? `<div class="t-sub">${sub.join("<span>·</span>")}</div>` : ""}</div>
        ${action}
      </li>`;
    })
    .join("");
  const audios = nodes.filter((n) => n.type === "audio").length;
  const edition = data.note
    ? `<div class="source-note"><span class="ms">${/Cloudflare/.test(data.note) ? "shield" : "translate"}</span>${esc(data.note)}しています。</div>`
    : "";
  el.innerHTML = `
    ${edition}${note}
    <div class="crumbs">${crumbs}
      <span style="margin-left:auto;display:flex;gap:6px">
        ${audios ? `<button class="btn" id="playFolder"><span class="ms">play_arrow</span>このフォルダを再生</button>` : ""}
        <a class="btn" href="${esc(data.pageUrl || "#")}" target="_blank" rel="noreferrer"><span class="ms">open_in_new</span>${esc(SITES[data.site])}</a>
      </span>
    </div>
    <ul class="tree">${items || `<li class="empty">空のフォルダ</li>`}</ul>`;
}

function playFrom(nodes, startNode) {
  const audios = nodes.filter((n) => n.type === "audio" && n.src);
  const idx = Math.max(0, audios.indexOf(startNode));
  player.setQueue(audios.map(toQueueItem), idx);
}

/** 最初に再生すべきフォルダ（asmr.one のツリーならmp3のあるフォルダ） */
function firstAudioList(nodes) {
  if (nodes.some((n) => n.type === "audio")) return nodes;
  const prefer = nodes.filter((n) => n.type === "folder").sort((a, b) => {
    const score = (f) => (/mp3/i.test(f.title) ? -2 : 0) + (/wav|flac/i.test(f.title) ? 1 : 0) + (/extra|字幕|subtitle|イラスト|画像/i.test(f.title) ? 5 : 0);
    return score(a) - score(b);
  });
  for (const f of prefer) {
    const r = firstAudioList(f.children || []);
    if (r) return r;
  }
  return null;
}

function sourceUsable(site) {
  const s = workState.sources[site];
  return s?.status === "ok" && s.data.audioCount > 0;
}

/** 1サイト分を読み込む */
async function loadSource(site, token) {
  workState.sources[site] = { status: "loading" };
  renderSources();
  try {
    const qs = new URLSearchParams({ order: settings.enabledSites.join(",") });
    const data = await api(`/api/work/${workState.rj}/source/${site}?${qs}`);
    if (token !== routeToken) return;
    workState.sources[site] = { status: data.status, data };
    if (data.status === "ok" && data.pageUrl && workState.meta) {
      workState.meta.links = { ...workState.meta.links, [site]: data.pageUrl };
      renderWorkHead(workState.meta);
    }
  } catch (e) {
    if (token !== routeToken) return;
    workState.sources[site] = { status: "error", data: { message: e.message } };
  }
  if (!workState.selected && sourceUsable(site)) {
    workState.selected = site;
    workState.path = [];
  }
  renderSources();
  renderTree();
}

/** これ以上かかるサイトは待たずに、次のサイトの確認も並行して始める */
const SOURCE_PATIENCE_MS = 8000;

/**
 * 優先順位順に1サイトずつ調べ、再生できるサイトが見つかった時点で終了（相手サーバーへの負荷を抑える）。
 * 応答が遅いサイト（japaneseasmr の検索など）は裏で待ち続けつつ、次のサイトの確認に進む。
 */
async function autoFindSource(token) {
  const anyUsable = () => settings.enabledSites.some(sourceUsable);
  for (const site of settings.enabledSites) {
    if (token !== routeToken || anyUsable()) return;
    if (workState.sources[site]) continue;
    const done = loadSource(site, token);
    const finished = await Promise.race([done.then(() => true), new Promise((r) => setTimeout(() => r(false), SOURCE_PATIENCE_MS))]);
    if (!finished && token === routeToken) {
      workState.sources[site].slow = true;
      renderSources();
    }
  }
}

async function renderWork(input, token) {
  const rj = normalizeRJ(input);
  if (!rj) {
    app.innerHTML = `<div class="empty">RJコードが正しくありません: ${esc(input)}</div>`;
    return;
  }
  Object.assign(workState, { rj, meta: null, sources: {}, selected: null, manual: false, path: [] });
  app.innerHTML = `
    <div id="workHead">${loadingHtml()}</div>
    <section class="panel">
      <div class="panel-head"><h2>トラック</h2><span class="count" id="sourceSummary" style="color:var(--muted);font-size:13px"></span></div>
      <div class="sources" id="sources"></div>
      <div id="treeArea"></div>
    </section>`;
  renderSources();
  renderTree();
  bindWorkEvents(token);

  // 先に作品情報を取得（翻訳版なら日本語版へ移動）
  let meta;
  try {
    meta = await api(`/api/work/${rj}`);
  } catch (e) {
    if (token !== routeToken) return;
    $("#workHead").innerHTML = `<div class="empty">作品情報を取得できませんでした: ${esc(e.message)}</div>`;
  }
  if (token !== routeToken) return;
  if (meta?.redirect) {
    toast(`${rj} は翻訳版のため、日本語版 ${meta.redirect} を表示します`);
    location.replace(`#/work/${meta.redirect}`);
    return;
  }
  if (meta) {
    workState.meta = meta;
    renderWorkHead(meta);
  }
  await autoFindSource(token);
}

function renderWorkHead(w) {
  const tags = (w.tags || []).map((t) => `<span class="chip" data-q="${esc(t)}">${esc(t)}</span>`).join("");
  const vas = (w.vas || []).map((v) => `<span class="chip va" data-q="${esc(v)}">${esc(v)}</span>`).join("");
  const links = Object.entries(w.links || {})
    .map(([k, url]) => `<a href="${esc(url)}" target="_blank" rel="noreferrer"><span class="ms">open_in_new</span>${esc(k === "dlsite" ? "DLsite" : SITES[k] || k)}</a>`)
    .join("");
  const age = w.age ? { r18: "R18", r15: "R15", all: "全年齢" }[w.age] : "";
  $("#workHead").innerHTML = `<div class="work-head">
    <div class="work-cover">
      <img src="${esc(w.cover || dlsiteCover(w.rj))}" data-rj="${w.rj}" alt="" />
      <button class="play-fab" id="playAll" title="再生"><span class="ms fill">play_arrow</span></button>
    </div>
    <div class="work-info">
      <span class="rj">${w.rj}${age ? ` · ${age}` : ""}${w.release ? ` · 発売日 ${esc(w.release)}` : ""}${w.duration ? ` · ${fmtTime(w.duration)}` : ""}</span>
      <h1>${esc(w.title)}</h1>
      ${w.circle ? `<span class="circle" data-q="${esc(w.circle)}">${esc(w.circle)}</span>` : ""}
      <div class="info-row">
        ${w.rating != null ? `<span><span class="stars">${stars(w.rating)}</span> ${w.rating.toFixed(2)}${w.rateCount ? ` (${w.rateCount})` : ""}</span>` : ""}
        ${w.price != null ? `<span class="price">${w.price.toLocaleString()} 円</span>` : ""}
        ${w.dlCount != null ? `<span>売上: ${w.dlCount.toLocaleString()}</span>` : ""}
        ${w.hasSubtitle ? `<span class="chip" style="background:var(--primary);color:#fff;cursor:default">字幕あり</span>` : ""}
      </div>
      ${tags ? `<div class="chips">${tags}</div>` : ""}
      ${vas ? `<div class="chips">${vas}</div>` : ""}
      ${links ? `<div class="links">${links}</div>` : ""}
    </div>
  </div>`;
  document.title = `${w.title} - ASMR Aggregator`;
}

function bindWorkEvents(token) {
  app.onclick = (e) => {
    if (token !== routeToken) return;
    const q = e.target.closest("[data-q]");
    if (q) return searchFor(q.dataset.q);
    if (e.target.closest("[data-stop]")) return;

    if (e.target.closest("#playAll")) {
      const src = workState.sources[workState.selected];
      const list = src && firstAudioList(src.data.tree);
      if (!list) return toast("再生できる音声がまだ見つかっていません", "warn");
      return playFrom(list, list.find((n) => n.type === "audio"));
    }
    if (e.target.closest("#checkRest")) {
      for (const site of settings.enabledSites) if (!workState.sources[site]) loadSource(site, token);
      return;
    }
    const siteBtn = e.target.closest("[data-site]");
    if (siteBtn) {
      const site = siteBtn.dataset.site;
      const s = workState.sources[site];
      if (!s || s.status === "error") {
        workState.manual = true;
        loadSource(site, token).then(() => {
          if (token === routeToken && sourceUsable(site)) {
            workState.selected = site;
            workState.path = [];
            renderSources();
            renderTree();
          }
        });
        return;
      }
      if (s.status !== "ok") return;
      workState.selected = site;
      workState.manual = true;
      workState.path = [];
      renderSources();
      renderTree();
      return;
    }
    const crumb = e.target.closest("[data-crumb]");
    if (crumb) {
      workState.path = workState.path.slice(0, Number(crumb.dataset.crumb));
      return renderTree();
    }
    if (e.target.closest("#playFolder")) {
      const nodes = currentFolder();
      return playFrom(nodes, nodes.find((n) => n.type === "audio"));
    }
    const enq = e.target.closest("[data-enqueue]");
    if (enq) {
      const n = currentFolder()[Number(enq.dataset.enqueue)];
      player.enqueue(toQueueItem(n));
      return toast(`キューに追加: ${n.title}`);
    }
    const li = e.target.closest(".tree li[data-i]");
    if (li) {
      const nodes = currentFolder();
      const n = nodes[Number(li.dataset.i)];
      if (!n) return;
      if (n.type === "folder") {
        workState.path.push(n.title);
        renderTree();
      } else if (n.type === "audio") {
        playFrom(nodes, n);
      } else if (n.type === "image" && n.src) {
        $("#lightboxImg").src = mediaUrl(n.src);
        $("#lightbox").hidden = false;
      } else if (n.src) {
        window.open(mediaUrl(n.src), "_blank", "noreferrer");
      }
    }
  };
}

/* ============================================================
 * サーバー状況・設定
 * ============================================================ */
async function renderStatus(token, force = false) {
  app.innerHTML = `
    <div class="toolbar"><h1>サーバー状況</h1><button class="btn" id="reload"><span class="ms">refresh</span>再確認</button></div>
    <section class="panel" style="margin-top:0"><div id="statusBody">${loadingHtml("各サイトに接続しています…")}</div></section>
    <section class="panel">
      <div class="panel-head"><h2>API サーバー</h2></div>
      <div class="api-row">
        <input class="select" id="apiBaseInput" type="url" placeholder="${STATIC_MODE ? "https://asmr-aggregator.xxxx.workers.dev" : "（空欄: この画面と同じサーバー）"}" value="${esc(store.get("apiBase", ""))}" />
        <button class="btn primary" id="apiSave"><span class="ms">save</span>保存</button>
      </div>
      <div class="note">現在の接続先: <b>${esc(API_BASE || location.origin)}</b>${
        STATIC_MODE && window.ASMR_CONFIG.apiBase ? `（ビルド時の既定: ${esc(window.ASMR_CONFIG.apiBase)}）` : ""
      }<br>
      GitHub Pages などに置いた静的な画面から使う場合は、Cloudflare Worker で動かした API のURLを入力してください。空欄で保存すると既定の接続先に戻ります。設定はこのブラウザに保存されます。</div>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>サイトの優先順位</h2><button class="btn" id="resetPrio"><span class="ms">restart_alt</span>初期状態に戻す</button></div>
      <ul class="prio" id="prio"></ul>
      <div class="note">作品ページでは上から順に1サイトずつ確認し、配信されているサイトが見つかった時点で確認を終えます（「残りのサイトも確認」で他も確認できます）。新着・検索は有効な全サイトに1リクエストずつ送ります。チェックを外したサイトは検索・作品ページで使いません。<br>
      japaneseasmr.com の音声は配信元が Referer を要求するため、本サーバーが保存せずにそのまま中継します。それ以外は各サイトのCDNからブラウザが直接再生します。</div>
    </section>`;
  renderPrio();
  $("#apiSave").onclick = () => {
    const v = $("#apiBaseInput").value.trim().replace(/\/+$/, "");
    if (v && !/^https?:\/\//.test(v)) return toast("http:// または https:// で始まるURLを入力してください", "warn");
    store.set("apiBase", v);
    location.reload();
  };
  if (STATIC_MODE && !API_BASE) {
    $("#statusBody").innerHTML = `<div class="empty">API サーバーのURLを下で設定してください</div>`;
    return;
  }
  $("#resetPrio").onclick = () => {
    settings.order = DEFAULT_ORDER;
    settings.disabled = [];
    renderPrio();
  };
  $("#reload").onclick = () => renderStatus(token, true);
  try {
    const data = await api(`/api/status${force ? "?force=1" : ""}`);
    if (token !== routeToken) return;
    updateStatusDot(data);
    const roles = { api: "API", mirror: "ミラー", site: "サイト", cdn: "CDN" };
    $("#statusBody").innerHTML = `<div class="table-scroll"><table class="status-table">
      <thead><tr><th>サイト</th><th>ホスト</th><th>種別</th><th>状態</th><th>応答時間</th></tr></thead>
      <tbody>${data.checks
        .map((c) => {
          const color = !c.ok ? "--err" : c.ms > 3000 ? "--warn" : "--ok";
          return `<tr>
            <td><i class="dot" style="background:var(${color})"></i>${esc(c.label)}</td>
            <td>${esc(c.host)}</td><td>${roles[c.role] || c.role}</td>
            <td>${c.ok ? `正常 (${c.status})` : `<span style="color:var(--err)">${esc(c.error || `HTTP ${c.status}`)}</span>`}</td>
            <td>${c.ms != null ? `${c.ms} ms` : "-"}</td></tr>`;
        })
        .join("")}</tbody></table></div>
      <div class="note">最終確認: ${new Date(data.checkedAt).toLocaleString()}（結果は1分間キャッシュされます）。asmr.one は応答の速いミラーから順に使用します。</div>`;
  } catch (e) {
    if (token !== routeToken) return;
    $("#statusBody").innerHTML = `<div class="empty">取得できませんでした: ${esc(e.message)}</div>`;
  }
}

function renderPrio() {
  const order = settings.order;
  const off = settings.disabled;
  const el = $("#prio");
  el.innerHTML = order
    .map(
      (s, i) => `<li>
      <span class="n">${i + 1}</span>
      <input type="checkbox" data-toggle="${s}" ${off.includes(s) ? "" : "checked"} />
      <span class="name">${esc(SITES[s])}</span>
      <button class="icon-btn" data-up="${i}" ${i === 0 ? "disabled" : ""}><span class="ms">arrow_upward</span></button>
      <button class="icon-btn" data-down="${i}" ${i === order.length - 1 ? "disabled" : ""}><span class="ms">arrow_downward</span></button>
    </li>`,
    )
    .join("");
  el.onclick = (e) => {
    const up = e.target.closest("[data-up]");
    const down = e.target.closest("[data-down]");
    const o = settings.order;
    if (up) {
      const i = Number(up.dataset.up);
      [o[i - 1], o[i]] = [o[i], o[i - 1]];
    } else if (down) {
      const i = Number(down.dataset.down);
      [o[i + 1], o[i]] = [o[i], o[i + 1]];
    } else return;
    settings.order = o;
    renderPrio();
  };
  el.onchange = (e) => {
    const t = e.target.closest("[data-toggle]");
    if (!t) return;
    const set = new Set(settings.disabled);
    if (t.checked) set.delete(t.dataset.toggle);
    else set.add(t.dataset.toggle);
    if (set.size >= DEFAULT_ORDER.length) {
      t.checked = true;
      return toast("少なくとも1つのサイトを有効にしてください", "warn");
    }
    settings.disabled = [...set];
  };
}

function updateStatusDot(data) {
  const dot = $("#statusDot");
  const bySite = {};
  for (const c of data.checks) if (c.role !== "cdn") bySite[c.site] = (bySite[c.site] || false) || c.ok;
  const down = Object.values(bySite).filter((v) => !v).length;
  dot.className = `dot ${down === 0 ? "ok" : down < Object.keys(bySite).length ? "warn" : "err"}`;
  dot.parentElement.title = down ? `${down} サイトに接続できません` : "すべてのサイトが正常です";
}

/* ============================================================
 * キュー / 履歴ページ
 * ============================================================ */
function queueItemHtml(t, i, on) {
  return `<div class="q-item ${on ? "on" : ""}" data-qi="${i}">
    <span class="n">${on ? '<span class="ms" style="font-size:16px">graphic_eq</span>' : i + 1}</span>
    <div class="q-main"><div class="q-t">${esc(t.title)}</div><div class="q-s">${esc(t.rj)} · ${esc(t.workTitle)} · ${esc(SITES[t.site] || "")}</div></div>
    <button class="icon-btn" data-qremove="${i}" title="削除"><span class="ms">close</span></button>
  </div>`;
}

function renderQueuePage() {
  const q = player.queue;
  app.innerHTML = `<div class="toolbar"><h1>再生キュー <span class="count">${q.length} トラック</span></h1>
    ${q.length ? `<button class="btn" id="clearQueue"><span class="ms">delete_sweep</span>クリア</button>` : ""}</div>
    <section class="panel" style="margin-top:0" id="queuePanel">${q.length ? q.map((t, i) => queueItemHtml(t, i, i === player.index)).join("") : `<div class="empty">キューは空です</div>`}</section>`;
  const clear = $("#clearQueue");
  if (clear) clear.onclick = () => (player.clear(), renderQueuePage());
  $("#queuePanel").onclick = (e) => handleQueueClick(e, renderQueuePage);
}

function handleQueueClick(e, rerender) {
  const rm = e.target.closest("[data-qremove]");
  if (rm) {
    e.stopPropagation();
    player.remove(Number(rm.dataset.qremove));
    return rerender();
  }
  const it = e.target.closest("[data-qi]");
  if (it) player.play(Number(it.dataset.qi));
}

function renderHistory() {
  const h = store.get("history", []);
  app.innerHTML = `<div class="toolbar"><h1>再生履歴</h1>
    ${h.length ? `<button class="btn" id="clearHist"><span class="ms">delete</span>履歴を消去</button>` : ""}</div>
    ${h.length ? `<div class="grid">${h.map((w) => workCard({ ...w, vas: [], tags: [] })).join("")}</div>` : `<div class="empty">まだ履歴がありません</div>`}`;
  const c = $("#clearHist");
  if (c) c.onclick = () => (store.set("history", []), renderHistory());
}

function addHistory(t) {
  const h = store.get("history", []).filter((x) => x.rj !== t.rj);
  h.unshift({ rj: t.rj, title: t.workTitle, cover: t.cover, sources: [t.site] });
  store.set("history", h.slice(0, 60));
}

/* ============================================================
 * プレイヤー（仮想トラック対応）
 * ============================================================ */
const audio = $("#audio");

/**
 * サイトごとの再生設定。japaneseasmr.com は音声配信サーバーの応答が極端に遅いことがあるため、
 * 再生しながら1分先までバッファリングし、応答が止まったら3回まで再接続する。
 */
const PLAYBACK_PROFILES = {
  japaneseasmr: { bufferSec: 60, retries: 3, stallMs: 15000 },
};
const profileOf = (t) => (t && PLAYBACK_PROFILES[t.site]) || null;

function hlsRetryPolicy(ttfbMs, loadMs, retries) {
  const retry = { maxNumRetry: retries, retryDelayMs: 1000, maxRetryDelayMs: 8000 };
  return { default: { maxTimeToFirstByteMs: ttfbMs, maxLoadTimeMs: loadMs, timeoutRetry: retry, errorRetry: retry } };
}

const player = {
  queue: [],
  playAfterSeek: false,
  retryCount: 0,
  retryAt: 0,
  stallTimer: null,
  index: -1,
  mode: "none", // none | all | one | shuffle
  hls: null,
  loadedSrc: null,
  pendingSeek: null,
  checkedTotal: null,
  sleepAt: null,
  sleepAfterTrack: false,

  current() {
    return this.queue[this.index] || null;
  },

  setQueue(items, index = 0) {
    this.queue = items;
    this.play(index);
  },

  enqueue(item) {
    this.queue.push(item);
    if (this.index < 0) this.play(this.queue.length - 1);
    else this.updateUI();
    this.save();
  },

  remove(i) {
    if (i === this.index) {
      this.queue.splice(i, 1);
      if (!this.queue.length) return this.clear();
      this.play(Math.min(i, this.queue.length - 1));
    } else {
      this.queue.splice(i, 1);
      if (i < this.index) this.index--;
      this.updateUI();
      this.save();
    }
  },

  clear() {
    audio.pause();
    this.detach();
    audio.removeAttribute("src");
    audio.load();
    this.queue = [];
    this.index = -1;
    this.updateUI();
    this.save();
  },

  detach() {
    this.clearStall();
    this.playAfterSeek = false;
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    this.loadedSrc = null;
  },

  /** ソースを読み込む（同じファイルならシークだけ） */
  load(t, autoplay, seekTo) {
    const start = seekTo ?? t.start ?? 0;
    if (this.loadedSrc === t.src) {
      if (Math.abs(audio.currentTime - start) > 0.5) audio.currentTime = start;
      this.beginPlayback(autoplay);
      return;
    }
    const prof = profileOf(t);
    this.detach();
    this.loadedSrc = t.src;
    this.pendingSeek = start > 0 ? start : null;
    this.checkedTotal = null;
    audio.preload = prof ? "auto" : "metadata";
    // HLS は hls.js を優先する。新しい Chrome はネイティブ HLS にも対応したが、読み込み済み範囲を
    // 「全体」と報告してしまい、バッファリング秒数や再試行の設定も効かないため。
    // hls.js が使えない環境（iPhone の Safari など）だけネイティブで再生する。
    if (t.stream === "hls" && window.Hls && Hls.isSupported()) {
      const cfg = { startPosition: start, maxBufferLength: 60 };
      if (prof) {
        // 1分先まで常に読み込み、読み込みが遅い・失敗したときは3回まで再試行
        Object.assign(cfg, {
          maxBufferLength: prof.bufferSec,
          maxMaxBufferLength: prof.bufferSec * 2,
          fragLoadPolicy: hlsRetryPolicy(20000, 120000, prof.retries),
          playlistLoadPolicy: hlsRetryPolicy(20000, 30000, prof.retries),
          manifestLoadPolicy: hlsRetryPolicy(20000, 30000, prof.retries),
        });
      }
      this.hls = new Hls(cfg);
      this.hls.on(Hls.Events.ERROR, (_, d) => {
        if (!d.fatal) return;
        if (prof && d.type === Hls.ErrorTypes.NETWORK_ERROR) this.retryLoad(`HLS: ${d.details}`);
        else toast(`HLSの再生エラー: ${d.details}`, "err");
      });
      this.hls.loadSource(mediaUrl(t.src));
      this.hls.attachMedia(audio);
      this.pendingSeek = null;
    } else {
      audio.src = mediaUrl(t.src);
    }
    this.beginPlayback(autoplay);
  },

  /** 再生開始（待たずにすぐ再生し、再生しながらバッファリングする） */
  beginPlayback(autoplay) {
    if (!autoplay) return;
    // 途中から始めるトラックは、先に開始位置へ移動してから再生する
    // （移動前に play() するとブラウザが自分で一時停止して先頭に戻ることがある）
    if (this.pendingSeek != null) {
      this.playAfterSeek = true;
      return;
    }
    audio.play().catch(() => {});
  },

  /** 現在位置から先に読み込み済みの秒数 */
  bufferedAhead() {
    const at = this.pendingSeek ?? audio.currentTime;
    const b = audio.buffered;
    for (let i = 0; i < b.length; i++) {
      if (b.start(i) <= at + 0.5 && b.end(i) > at) return b.end(i) - at;
    }
    return 0;
  },

  /** 再生バーの背景（再生済み・読み込み済み・未読み込み）。YouTube の灰色の読み込みバーと同じ考え方 */
  seekBackground(playedFrac) {
    const t = this.current();
    const d = this.trackDuration();
    const s0 = t?.start || 0;
    const segs = [];
    if (t && d) {
      const b = audio.buffered;
      for (let i = 0; i < b.length; i++) {
        const from = Math.max(0, (b.start(i) - s0) / d);
        const to = Math.min(1, (b.end(i) - s0) / d);
        if (to > from) segs.push([from, to]);
      }
    }
    const pts = [...new Set([0, 1, playedFrac, ...segs.flat()].map((x) => Math.min(1, Math.max(0, x))))].sort((x, y) => x - y);
    const stops = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [x, y] = [pts[i], pts[i + 1]];
      const mid = (x + y) / 2;
      const color = mid < playedFrac ? "var(--primary)" : segs.some(([f, e]) => mid >= f && mid <= e) ? "var(--seek-buffer)" : "var(--seek-track)";
      stops.push(`${color} ${(x * 100).toFixed(2)}%`, `${color} ${(y * 100).toFixed(2)}%`);
    }
    return `linear-gradient(to right, ${stops.join(", ")})`;
  },

  /** 応答が止まった・失敗したときに現在位置から読み込み直す（プロファイルの回数まで） */
  retryLoad(reason) {
    const t = this.current();
    const prof = profileOf(t);
    if (!t || !prof) return;
    if (this.retryCount >= prof.retries) {
      this.clearStall();
      audio.pause();
      toast(`音声を読み込めませんでした（${prof.retries}回再試行しました: ${reason}）。別のサイトを選んでください。`, "err", 8000);
      return;
    }
    const count = this.retryCount + 1;
    const pos = this.pendingSeek ?? audio.currentTime;
    toast(`配信サーバーの応答が遅いため再接続します（${count}/${prof.retries}）`, "warn");
    this.detach();
    this.load(t, true, pos);
    this.retryCount = count;
    this.retryAt = pos;
  },

  /** 再生中に読み込みが止まったら一定時間後に再接続 */
  armStall() {
    const prof = profileOf(this.current());
    if (!prof || this.hls || this.stallTimer || audio.paused) return;
    this.stallTimer = setTimeout(() => {
      this.stallTimer = null;
      if (!audio.paused) this.retryLoad("応答なし");
    }, prof.stallMs);
  },

  clearStall() {
    if (this.stallTimer) clearTimeout(this.stallTimer);
    this.stallTimer = null;
  },

  play(i, { autoplay = true, seekTo } = {}) {
    if (i < 0 || i >= this.queue.length) return;
    if (this.queue[i]?.src !== this.loadedSrc) this.retryCount = 0;
    this.index = i;
    const t = this.current();
    this.load(t, autoplay, seekTo);
    this.updateUI();
    this.updateMediaSession();
    this.save();
    addHistory(t);
  },

  toggle() {
    if (!this.current()) return;
    if (!this.loadedSrc) return this.play(this.index, { seekTo: store.get("playerPos", null) ?? undefined });
    if (audio.paused) audio.play().catch((e) => toast(`再生できません: ${e.message}`, "err"));
    else audio.pause();
  },

  /** 現在トラック内での位置（仮想トラックの開始位置を0とする） */
  pos() {
    const t = this.current();
    return t ? audio.currentTime - (t.start || 0) : 0;
  },

  trackDuration() {
    const t = this.current();
    if (!t) return 0;
    const end = t.end ?? (Number.isFinite(audio.duration) ? audio.duration : t.duration != null ? (t.start || 0) + t.duration : 0);
    return Math.max(0, end - (t.start || 0));
  },

  seekTrack(sec) {
    const t = this.current();
    if (!t) return;
    const d = this.trackDuration();
    audio.currentTime = (t.start || 0) + Math.max(0, Math.min(sec, d ? d - 0.2 : sec));
  },

  prev() {
    if (this.pos() > 3 || this.index <= 0) return this.seekTrack(0);
    this.play(this.index - 1);
  },

  next(auto = false) {
    const t = this.current();
    if (!t) return;
    if (auto && this.sleepAfterTrack) {
      this.sleepAfterTrack = false;
      $("#pSleep").value = "0";
      audio.pause();
      return toast("スリープタイマーで停止しました");
    }
    if (auto && this.mode === "one") return this.seekTrack(0);
    let n;
    if (this.mode === "shuffle" && this.queue.length > 1) {
      do n = Math.floor(Math.random() * this.queue.length);
      while (n === this.index);
    } else {
      n = this.index + 1;
      if (n >= this.queue.length) {
        if (this.mode === "all" || !auto) n = 0;
        else {
          audio.pause();
          if (t.end != null) audio.currentTime = t.end - 0.01;
          return;
        }
      }
    }
    const nt = this.queue[n];
    // 同じファイルの続きのトラックならシークせずにそのまま再生を続ける
    if (auto && nt.src === t.src && t.end != null && Math.abs((nt.start || 0) - t.end) < 1.5) {
      this.index = n;
      this.updateUI();
      this.updateMediaSession();
      this.save();
      return;
    }
    this.play(n);
  },

  onTime() {
    const t = this.current();
    if (!t) return;
    if (this.retryCount && audio.currentTime - this.retryAt > 60) this.retryCount = 0;
    if (t.end != null && audio.currentTime >= t.end - 0.05 && !audio.paused) this.next(true);
    if (this.sleepAt && Date.now() >= this.sleepAt) {
      this.sleepAt = null;
      $("#pSleep").value = "0";
      audio.pause();
      toast("スリープタイマーで停止しました");
    }
    this.updateProgress();
  },

  onMeta() {
    if (this.pendingSeek != null) {
      audio.currentTime = this.pendingSeek;
      this.pendingSeek = null;
      if (this.playAfterSeek) {
        this.playAfterSeek = false;
        audio.addEventListener("seeked", () => audio.play().catch(() => {}), { once: true });
      }
    }
    const t = this.current();
    // 総時間未確認で分割したトラックは、実際の長さと照合して警告
    if (t?.expectTotal && Number.isFinite(audio.duration) && this.checkedTotal !== t.src) {
      this.checkedTotal = t.src;
      const diff = Math.abs(audio.duration - t.expectTotal);
      if (diff > Math.max(20, t.expectTotal * 0.015)) {
        toast(`分割位置がずれている可能性があります（想定 ${fmtTime(t.expectTotal)} / 実際 ${fmtTime(audio.duration)}）。「通し再生」もお試しください。`, "warn", 8000);
      }
    }
    this.updateProgress();
  },

  updateProgress() {
    const d = this.trackDuration();
    const p = Math.max(0, this.pos());
    const frac = d ? Math.min(1, p / d) : 0;
    $("#miniBar").style.width = `${frac * 100}%`;
    if (!seeking) {
      $("#pSeek").value = String(Math.round(frac * 1000));
      this.updateBuffered(frac);
    }
    $("#pCur").textContent = fmtTime(p);
    $("#pDur").textContent = fmtTime(d);
    if ("mediaSession" in navigator && d && navigator.mediaSession.setPositionState) {
      try {
        navigator.mediaSession.setPositionState({ duration: d, position: Math.min(p, d), playbackRate: audio.playbackRate });
      } catch {
        /* 一部ブラウザは未対応 */
      }
    }
  },

  /** バッファ済み部分（灰色）とバッファ秒数を表示 */
  updateBuffered(playedFrac) {
    const bg = this.seekBackground(playedFrac);
    $("#pSeek").style.setProperty("--seek-bg", bg);
    $(".mini-progress").style.background = bg;
    const ahead = this.current() && this.loadedSrc ? this.bufferedAhead() : 0;
    const d = this.trackDuration();
    const left = d ? d - Math.max(0, this.pos()) : Infinity;
    const el = $("#pBuf");
    if (ahead >= 1) {
      el.textContent = ahead >= left - 1 ? "最後までバッファ済み" : `バッファ ${Math.floor(ahead)}秒`;
      el.classList.toggle("low", ahead < 10 && left > 10);
    } else {
      const loading = !!this.loadedSrc && (!audio.paused || this.playAfterSeek);
      el.textContent = loading ? "バッファリング中…" : "";
      el.classList.toggle("low", loading);
    }
  },

  updateUI() {
    const t = this.current();
    document.body.classList.toggle("has-player", !!t);
    $("#mini").hidden = !t;
    if (!t) {
      closePlayer();
      return;
    }
    // ミニプレイヤーは小さい img_sam、フルプレイヤーは img_main
    const setImg = (img, src, alt) => {
      if (img.dataset.src === src) return;
      img.dataset.src = src;
      img.dataset.rj = t.rj;
      img.dataset.alt = alt;
      delete img.dataset.fallen;
      delete img.dataset.altTried;
      img.src = src;
    };
    setImg($("#miniCover"), t.thumb || dlsiteCover(t.rj, "sam"), t.cover);
    setImg($("#pCover"), t.cover, dlsiteCover(t.rj));
    $("#miniTitle").textContent = t.title;
    $("#miniSub").textContent = t.workTitle;
    $("#pTitle").textContent = t.title;
    $("#pWork").textContent = `${t.rj} ${t.workTitle}`;
    $("#pWork").href = `#/work/${t.rj}`;
    $("#pMeta").innerHTML = [
      `<span>${esc(SITES[t.site] || "")}</span>`,
      t.end != null || t.start ? `<span class="tag-virtual">分割トラック ${fmtTime(t.start)}〜${t.end != null ? fmtTime(t.end) : ""}</span>` : "",
      t.estimated ? `<span class="tag-est">${esc(t.estimated)}</span>` : "",
      `<span>${this.index + 1} / ${this.queue.length}</span>`,
    ].join("");
    const modeIcon = { none: "repeat", all: "repeat", one: "repeat_one", shuffle: "shuffle" }[this.mode];
    const modeTitle = { none: "リピートなし", all: "全曲リピート", one: "1曲リピート", shuffle: "シャッフル" }[this.mode];
    $("#pMode").innerHTML = `<span class="ms">${modeIcon}</span>`;
    $("#pMode").title = modeTitle;
    $("#pMode").classList.toggle("on", this.mode !== "none");
    this.updatePlayIcon();
    this.renderQueuePanel();
    if (parseHash().path.startsWith("/work/")) renderTree();
    if (parseHash().path === "/queue") renderQueuePage();
    this.updateProgress();
  },

  updatePlayIcon() {
    const icon = audio.paused ? "play_arrow" : "pause";
    $("#miniPlayIcon").textContent = icon;
    $("#pPlayIcon").textContent = icon;
  },

  renderQueuePanel() {
    $("#pQueue").innerHTML = `<h3><span>再生キュー（${this.queue.length}）</span>
      <button class="icon-btn" id="pClear" title="クリア"><span class="ms">delete_sweep</span></button></h3>
      ${this.queue.map((t, i) => queueItemHtml(t, i, i === this.index)).join("")}`;
  },

  updateMediaSession() {
    const t = this.current();
    if (!t || !("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title,
      artist: t.workTitle,
      album: t.rj,
      artwork: [
        { src: t.thumb || dlsiteCover(t.rj, "sam"), sizes: "100x100", type: "image/jpeg" },
        { src: t.cover, sizes: "560x420", type: "image/jpeg" },
      ],
    });
  },

  save() {
    store.set("playerQueue", { queue: this.queue, index: this.index, mode: this.mode });
  },

  restore() {
    const s = store.get("playerQueue", null);
    if (!s || !Array.isArray(s.queue) || !s.queue.length) return;
    this.queue = s.queue;
    this.index = Math.min(Math.max(0, s.index), s.queue.length - 1);
    this.mode = s.mode || "none";
    this.updateUI();
  },
};

let seeking = false;
audio.addEventListener("timeupdate", () => player.onTime());
audio.addEventListener("loadedmetadata", () => player.onMeta());
audio.addEventListener("durationchange", () => player.updateProgress());
audio.addEventListener("progress", () => player.updateProgress());
audio.addEventListener("ended", () => player.next(true));
audio.addEventListener("play", () => player.updatePlayIcon());
audio.addEventListener("pause", () => {
  player.updatePlayIcon();
  store.set("playerPos", audio.currentTime);
});
audio.addEventListener("error", () => {
  const t = player.current();
  if (!t || player.hls || !audio.error) return;
  if (profileOf(t)) return player.retryLoad(`読み込みエラー (${audio.error.code})`);
  toast(`音声を読み込めませんでした（${SITES[t.site] || ""}）。別のサイトを選んでください。`, "err", 6000);
});
// 再生中にデータが来なくなったら再接続の準備、データが来たら解除
audio.addEventListener("waiting", () => player.armStall());
audio.addEventListener("stalled", () => player.armStall());
for (const ev of ["playing", "progress", "pause", "seeking"]) audio.addEventListener(ev, () => player.clearStall());
setInterval(() => {
  if (!audio.paused) store.set("playerPos", audio.currentTime);
}, 5000);

if ("mediaSession" in navigator) {
  const ms = navigator.mediaSession;
  ms.setActionHandler("play", () => player.toggle());
  ms.setActionHandler("pause", () => audio.pause());
  ms.setActionHandler("previoustrack", () => player.prev());
  ms.setActionHandler("nexttrack", () => player.next());
  ms.setActionHandler("seekbackward", () => player.seekTrack(player.pos() - 30));
  ms.setActionHandler("seekforward", () => player.seekTrack(player.pos() + 30));
  try {
    ms.setActionHandler("seekto", (d) => player.seekTrack(d.seekTime));
  } catch {
    /* 未対応 */
  }
}

function playerAction(act) {
  if (act === "toggle") player.toggle();
  else if (act === "prev") player.prev();
  else if (act === "next") player.next();
  else if (act === "back") player.seekTrack(player.pos() - 30);
  else if (act === "fwd") player.seekTrack(player.pos() + 30);
}

document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-act]");
  if (b) playerAction(b.dataset.act);
});

const openPlayer = () => {
  if (!player.current()) return;
  const el = $("#player");
  el.classList.remove("closing");
  el.hidden = false;
};

/** フルプレイヤーを閉じる（開くときと同じ動きを逆再生してから非表示） */
function closePlayer() {
  const el = $("#player");
  if (el.hidden || el.classList.contains("closing")) return;
  el.classList.add("closing");
  const done = () => {
    if (!el.classList.contains("closing")) return;
    el.classList.remove("closing");
    el.hidden = true;
  };
  el.addEventListener("animationend", done, { once: true });
  setTimeout(done, 400); // アニメーション無効環境の保険
}
$("#miniOpen").onclick = openPlayer;
$("#miniCover").onclick = openPlayer;
$("#miniExpand").onclick = openPlayer;
$("#playerClose").onclick = closePlayer;
$("#playerQueueBtn").onclick = () => $("#player").classList.toggle("show-queue");
$("#pWork").onclick = closePlayer;
$("#pMode").onclick = () => {
  const order = ["none", "all", "one", "shuffle"];
  player.mode = order[(order.indexOf(player.mode) + 1) % order.length];
  player.updateUI();
  player.save();
};
$("#pSeek").addEventListener("input", () => {
  seeking = true;
  const d = player.trackDuration();
  const frac = Number($("#pSeek").value) / 1000;
  $("#pCur").textContent = fmtTime(frac * d);
  player.updateBuffered(frac);
});
$("#pSeek").addEventListener("change", () => {
  seeking = false;
  player.seekTrack((Number($("#pSeek").value) / 1000) * player.trackDuration());
});
$("#pRate").onchange = () => {
  audio.playbackRate = Number($("#pRate").value);
  audio.preservesPitch = true;
};
$("#pVol").value = String(store.get("volume", 1));
audio.volume = Number($("#pVol").value);
$("#pVol").oninput = () => {
  audio.volume = Number($("#pVol").value);
  store.set("volume", audio.volume);
};
$("#pSleep").onchange = () => {
  const v = $("#pSleep").value;
  player.sleepAt = null;
  player.sleepAfterTrack = false;
  if (v === "track") player.sleepAfterTrack = true;
  else if (v !== "0") player.sleepAt = Date.now() + Number(v) * 60_000;
  if (v !== "0") toast("スリープタイマーを設定しました");
};
$("#pQueue").onclick = (e) => {
  if (e.target.closest("#pClear")) {
    player.clear();
    return;
  }
  handleQueueClick(e, () => player.renderQueuePanel());
};
$("#lightbox").onclick = () => ($("#lightbox").hidden = true);

document.addEventListener("keydown", (e) => {
  if (e.target.closest("input, select, textarea") || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === " ") {
    e.preventDefault();
    player.toggle();
  } else if (e.key === "ArrowLeft") player.seekTrack(player.pos() - 10);
  else if (e.key === "ArrowRight") player.seekTrack(player.pos() + 10);
  else if (e.key === "Escape") {
    closePlayer();
    $("#lightbox").hidden = true;
  }
});

/* ============================================================
 * ヘッダー / ドロワー / テーマ
 * ============================================================ */
$("#searchForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = $("#searchInput").value.trim();
  if (q) searchFor(q);
});

const wide = () => window.matchMedia("(min-width: 1100px)").matches;
if (store.get("drawerPinned", true)) document.body.classList.add("drawer-pinned");
$("#menuBtn").onclick = () => {
  if (wide()) {
    document.body.classList.toggle("drawer-pinned");
    store.set("drawerPinned", document.body.classList.contains("drawer-pinned"));
  } else {
    document.body.classList.toggle("drawer-open");
  }
};
$("#scrim").onclick = () => document.body.classList.remove("drawer-open");

function applyTheme(t) {
  document.documentElement.dataset.theme = t;
  $("#themeBtn").innerHTML = `<span class="ms">${t === "dark" ? "light_mode" : "dark_mode"}</span>`;
}
applyTheme(store.get("theme", "dark"));
$("#themeBtn").onclick = () => {
  const t = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  store.set("theme", t);
  applyTheme(t);
};

window.addEventListener("hashchange", route);
player.restore();
route();
// サーバー状況はサーバー状況ページを開いたときだけ確認する（ヘッダーの点はその結果を表示）
