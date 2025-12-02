<script lang="ts">
  import { onMount } from "svelte";
  import * as d3 from "d3";

  // --- DATA FILES -----------------------------------------------------------
  const CSV_WORKS = "/works_with_authors.csv"; // work_id, author_id, countries, topic_field_display_name, pub_year
  const CSV_AUTHORS = "/authors.csv"; // should have at least id + display_name (OpenAlex author dump)

  // --- TYPES ----------------------------------------------------------------
  type Row = {
    work_id: string;
    author_id: string; // OpenAlex author URL
    countries: string;
    field: string;
    pub_year: number;
  };

  type Node = {
    id: number;
    authorId: string; // full OpenAlex URL
    name: string; // human readable display name
    strength: number;
    degree: number;
    pr: number;
    x?: number;
    y?: number;
    vx?: number;
    vy?: number;
    fx?: number | null;
    fy?: number | null;
    pinned?: boolean;
  };

  type Link = { source: number; target: number; w: number };

  // --- YEAR RANGE UI --------------------------------------------------------
  let years: number[] = [];
  let yearMin = 1970;
  let yearMax = 2025;
  let y0 = 2015;
  let y1 = 2025;

  // --- GRAPH FILTERS --------------------------------------------------------
  let nodeLimit = 500; // keep top-N authors by metric
  let minLinkWeight = 1; // min co-auth count
  let sizeMetric: "strength" | "degree" | "pagerank" = "strength";

  let search = "";
  let showLabels = true;

  // --- DATA HOLDERS ---------------------------------------------------------
  let rows: Row[] = [];
  let authorNameById = new Map<string, string>(); // "https://openalex.org/A..." -> "F. Albert"

  let nodes: Node[] = [];
  let links: Link[] = [];

  // --- CANVAS / D3 STATE ----------------------------------------------------
  let canvasEl: HTMLCanvasElement;
  let tooltipEl: HTMLDivElement;
  let legendEl: HTMLDivElement;
  let sideEl: HTMLDivElement;

  let ctx: CanvasRenderingContext2D;
  let sim: d3.Simulation<Node, Link>;
  let zoomBehavior: d3.ZoomBehavior<HTMLCanvasElement, unknown>;
  let transform = d3.zoomIdentity;

  let colorMetric = d3.scaleSequential(d3.interpolateTurbo).domain([0, 1]);

  // Hover / focus
  let hoverId: number | null = null;
  let focusId: number | null = null;

  // --- HELPERS --------------------------------------------------------------
  const splitSemi = (s: string) =>
    s
      ? s
          .split(";")
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

  // Get a nice display name for an author URL
  function prettyAuthorName(authorUrl: string): string {
    const trimmed = authorUrl.trim();
    const full = authorNameById.get(trimmed);
    if (full) return full;

    const short = trimmed.split("/").at(-1) ?? trimmed;
    const alt = authorNameById.get(short);
    if (alt) return alt;

    return short; // fall back to A123… if no name
  }

  function mval(n: Node) {
    return sizeMetric === "strength"
      ? n.strength
      : sizeMetric === "degree"
        ? n.degree
        : n.pr;
  }

  // Simple PageRank on an undirected graph
  function pagerank(Nodes: Node[], Links: Link[], d = 0.85, iters = 30) {
    const n = Nodes.length;
    if (!n) return;

    const id2idx = new Map(Nodes.map((n, i) => [n.id, i]));
    const out = new Array(n).fill(0);
    const adj: number[][] = Array.from({ length: n }, () => []);
    Links.forEach((l) => {
      const a = id2idx.get(l.source as any)!;
      const b = id2idx.get(l.target as any)!;
      out[a]++;
      out[b]++;
      adj[a].push(b);
      adj[b].push(a);
    });

    let pr = new Float64Array(n).fill(1 / n);
    let next = new Float64Array(n);

    for (let t = 0; t < iters; t++) {
      next.fill((1 - d) / n);
      for (let i = 0; i < n; i++) {
        const share = out[i] ? (d * pr[i]) / out[i] : 0;
        for (const j of adj[i]) next[j] += share;
      }
      pr = next;
      next = new Float64Array(n);
    }

    Nodes.forEach((nd, i) => (nd.pr = pr[i]));
  }

  // Node radius based on metric
  function nodeRadius(n: Node) {
    const v = mval(n) || 1;
    return 2 + Math.sqrt(v);
  }

  // --- BUILD GRAPH FROM works_with_authors.csv ------------------------------
  function rebuild() {
    const idOf = new Map<string, number>(); // authorUrl -> node index
    const edges = new Map<string, number>(); // "i|j" -> weight
    const authorsByWork = new Map<string, string[]>(); // work_id -> [author_id, ...]

    // 1) group authors by work for the selected year range
    for (const r of rows) {
      if (r.pub_year < y0 || r.pub_year > y1) continue;
      const arr =
        authorsByWork.get(r.work_id) ??
        (authorsByWork.set(r.work_id, []), authorsByWork.get(r.work_id)!);
      arr.push(r.author_id);
    }

    // 2) accumulate co-authorship edges
    for (const [, authorsRaw] of authorsByWork) {
      const authors = Array.from(new Set(authorsRaw)); // de-dupe within a work
      const m = authors.length;
      if (m < 2) continue;

      for (let i = 0; i < m; i++) {
        const ai = authors[i];
        if (!idOf.has(ai)) idOf.set(ai, idOf.size);

        for (let j = i + 1; j < m; j++) {
          const aj = authors[j];
          if (!idOf.has(aj)) idOf.set(aj, idOf.size);

          const a = idOf.get(ai)!;
          const b = idOf.get(aj)!;
          const k = a < b ? `${a}|${b}` : `${b}|${a}`;
          edges.set(k, (edges.get(k) ?? 0) + 1);
        }
      }
    }

    // 3) build node/link arrays
    let allNodes: Node[] = Array.from(idOf.entries()).map(
      ([authorUrl, id]) => ({
        id,
        authorId: authorUrl,
        name: prettyAuthorName(authorUrl),
        strength: 0,
        degree: 0,
        pr: 0,
      }),
    );
    let allLinks: Link[] = Array.from(edges.entries()).map(([k, w]) => {
      const [a, b] = k.split("|").map(Number);
      return { source: a, target: b, w };
    });

    // 4) filter weak links
    if (minLinkWeight > 1) {
      allLinks = allLinks.filter((l) => l.w >= minLinkWeight);
    }

    // recompute degree / strength based on remaining links
    const deg = new Map<number, number>();
    const str = new Map<number, number>();
    for (const l of allLinks) {
      deg.set(l.source, (deg.get(l.source) ?? 0) + 1);
      deg.set(l.target, (deg.get(l.target) ?? 0) + 1);
      str.set(l.source, (str.get(l.source) ?? 0) + l.w);
      str.set(l.target, (str.get(l.target) ?? 0) + l.w);
    }
    allNodes.forEach((n) => {
      n.degree = deg.get(n.id) ?? 0;
      n.strength = str.get(n.id) ?? 0;
    });

    // drop isolates (no remaining edges)
    allNodes = allNodes.filter((n) => n.degree > 0);
    const keep = new Set(allNodes.map((n) => n.id));
    allLinks = allLinks.filter((l) => keep.has(l.source) && keep.has(l.target));

    // 5) keep top-N authors by metric
    allNodes.sort((a, b) => mval(b) - mval(a) || b.degree - a.degree);
    const keepTop = new Set(allNodes.slice(0, nodeLimit).map((n) => n.id));
    allNodes = allNodes.filter((n) => keepTop.has(n.id));
    allLinks = allLinks.filter(
      (l) => keepTop.has(l.source) && keepTop.has(l.target),
    );

    // re-index densely
    const newIndex = new Map<number, number>();
    allNodes.forEach((n, i) => newIndex.set(n.id, i));
    nodes = allNodes.map((n, i) => ({ ...n, id: i }));
    links = allLinks.map((l) => ({
      source: newIndex.get(l.source)!,
      target: newIndex.get(l.target)!,
      w: l.w,
    }));

    // recompute metrics after reindex
    const d2 = new Array(nodes.length).fill(0);
    const s2 = new Array(nodes.length).fill(0);
    for (const l of links) {
      d2[l.source]++;
      d2[l.target]++;
      s2[l.source] += l.w;
      s2[l.target] += l.w;
    }
    nodes.forEach((n, i) => {
      n.degree = d2[i];
      n.strength = s2[i];
    });

    pagerank(nodes, links);

    // color scale for chosen metric
    const vals = nodes.map(mval);
    const lo = d3.min(vals) ?? 0;
    const hi = d3.max(vals) ?? 1;
    colorMetric = d3.scaleSequential(d3.interpolateTurbo).domain([lo, hi || 1]);

    restartSim();
    drawLegend();
    updateSide();
  }

  // --- SIMULATION / DRAWING -------------------------------------------------
  function paint() {
    // Clear full pixel buffer
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    ctx.restore();

    ctx.save();
    ctx.scale(devicePixelRatio, devicePixelRatio);
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.k, transform.k);

    // Links
    ctx.lineWidth = 0.7 / transform.k;
    ctx.strokeStyle = "rgba(60,64,67,0.20)";
    for (const l of links) {
      const a = nodes[l.source as any];
      const b = nodes[l.target as any];
      if (!a || !b || a.x == null || b.x == null) continue;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // Ego highlight
    if (focusId != null) {
      ctx.lineWidth = 1.5 / transform.k;
      ctx.strokeStyle = "rgba(0,0,0,0.30)";
      for (const l of links) {
        const s = l.source as any,
          t = l.target as any;
        if (s === focusId || t === focusId) {
          const a = nodes[s],
            b = nodes[t];
          if (!a || !b) continue;
          ctx.beginPath();
          ctx.moveTo(a.x!, a.y!);
          ctx.lineTo(b.x!, b.y!);
          ctx.stroke();
        }
      }
    }

    // Nodes
    for (const n of nodes) {
      if (n.x == null || n.y == null) continue;
      ctx.beginPath();
      ctx.fillStyle = colorMetric(mval(n));
      ctx.arc(n.x, n.y, nodeRadius(n), 0, Math.PI * 2);
      ctx.fill();
      if (hoverId === n.id || focusId === n.id) {
        ctx.lineWidth = 2 / transform.k;
        ctx.strokeStyle = "#111";
        ctx.stroke();
      }
    }

    // Labels
    if (showLabels) {
      ctx.font = `${
        12 / transform.k
      }px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(17,24,39,.95)";
      const pad = 3 / transform.k;

      const top = nodes
        .slice()
        .sort((a, b) => b.strength - a.strength)
        .slice(0, 30);

      const drawLabel = (n: Node) => {
        if (n.x != null && n.y != null)
          ctx.fillText(n.name, n.x + nodeRadius(n) + pad, n.y);
      };

      for (const n of top) drawLabel(n);
      if (hoverId != null) {
        const n = nodes[hoverId];
        if (n) drawLabel(n);
      }
      if (focusId != null) {
        const n = nodes[focusId];
        if (n) drawLabel(n);
      }
    }

    ctx.restore();
  }

  function restartSim() {
    const cssW = canvasEl.width / devicePixelRatio;
    const cssH = canvasEl.height / devicePixelRatio;

    if (sim) sim.stop();

    sim = d3
      .forceSimulation(nodes)
      .force(
        "link",
        d3
          .forceLink(links)
          .id((d: any) => d.id)
          .distance((l) => 10 + 80 / Math.sqrt((l as any).w))
          .strength((l) => Math.min(1, (l as any).w / 3)),
      )
      .force("charge", d3.forceManyBody().strength(-40))
      .force("center", d3.forceCenter(cssW / 2, cssH / 2))
      .force(
        "collide",
        d3
          .forceCollide()
          .radius((d: any) => nodeRadius(d) + 2)
          .strength(0.7),
      )
      .alpha(1)
      .alphaTarget(0)
      .on("tick", paint);

    // seed positions
    for (const n of nodes) {
      if (n.x == null || isNaN(n.x)) n.x = Math.random() * cssW;
      if (n.y == null || isNaN(n.y)) n.y = Math.random() * cssH;
    }

    // pre-tick for initial layout
    for (let i = 0; i < 80; i++) sim.tick();
    paint();

    sim.alpha(0.3).restart();
  }

  // --- ZOOM / PAN -----------------------------------------------------------
  function setupZoom() {
    zoomBehavior = d3
      .zoom<HTMLCanvasElement, unknown>()
      .scaleExtent([0.2, 6])
      .on("zoom", (ev) => {
        transform = ev.transform;
        paint();
      });
    d3.select(canvasEl).call(zoomBehavior);
  }

  // convert mouse position to nearest node
  function pickNode(px: number, py: number) {
    const x = (px / devicePixelRatio - transform.x) / transform.k;
    const y = (py / devicePixelRatio - transform.y) / transform.k;
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      const dx = x - (n.x ?? 0);
      const dy = y - (n.y ?? 0);
      const r = nodeRadius(n) + 5;
      const d2 = dx * dx + dy * dy;
      if (d2 < r * r && d2 < bestD) {
        best = i;
        bestD = d2;
      }
    }
    return best >= 0 ? nodes[best] : null;
  }

  function onMouseMove(ev: MouseEvent) {
    const n = pickNode(ev.offsetX, ev.offsetY);
    hoverId = n?.id ?? null;
    paint();

    if (n) {
      d3
        .select(tooltipEl)
        .style("opacity", 1)
        .style("left", `${ev.pageX + 12}px`)
        .style("top", `${ev.pageY + 12}px`).html(`
          <div style="font-weight:800;margin-bottom:4px">${n.name}</div>
          <div style="font-size:13px;opacity:.8">Degree: <b>${n.degree}</b> — Strength: <b>${n.strength}</b></div>
          <div style="font-size:13px;opacity:.8">PageRank: <b>${n.pr.toFixed(4)}</b></div>
        `);
    } else {
      d3.select(tooltipEl).style("opacity", 0);
    }
  }

  function onMouseDown(ev: MouseEvent) {
    const n = pickNode(ev.offsetX, ev.offsetY);
    if (n) {
      focusId = n.id;
      n.fx = n.x ?? 0;
      n.fy = n.y ?? 0;
      n.pinned = true;
      sim.alphaTarget(0.3).restart();
      paint();
      updateSide();
    }
  }

  function onMouseUp() {
    if (sim) sim.alphaTarget(0);
  }

  function onDblClick(ev: MouseEvent) {
    const n = pickNode(ev.offsetX, ev.offsetY);
    if (n) {
      n.fx = null;
      n.fy = null;
      n.pinned = false;
    } else {
      focusId = null;
      updateSide();
    }
    paint();
  }

  // --- LEGEND & SIDE PANEL --------------------------------------------------
  function drawLegend() {
    if (!legendEl) return;
    const el = d3.select(legendEl);
    el.html("");

    const W = 220;
    const H = 12;

    const svg = el
      .append("svg")
      .attr("width", W + 40)
      .attr("height", 38);
    const defs = svg.append("defs");
    const grad = defs
      .append("linearGradient")
      .attr("id", "grad")
      .attr("x1", "0%")
      .attr("x2", "100%");
    for (let i = 0; i <= 100; i += 5) {
      const t = i / 100;
      grad
        .append("stop")
        .attr("offset", `${i}%`)
        .attr(
          "stop-color",
          colorMetric(
            colorMetric.domain()[0] +
              t * (colorMetric.domain()[1] - colorMetric.domain()[0]),
          ),
        );
    }

    svg
      .append("rect")
      .attr("x", 10)
      .attr("y", 8)
      .attr("width", W)
      .attr("height", H)
      .attr("rx", 4)
      .attr("fill", "url(#grad)");

    const x = d3
      .scaleLinear()
      .domain(colorMetric.domain() as [number, number])
      .range([10, 10 + W]);
    svg
      .append("g")
      .attr("transform", `translate(0,${8 + H})`)
      .call(d3.axisBottom(x).ticks(4).tickSize(4).tickPadding(6) as any)
      .selectAll("text")
      .style("font-size", "11px");

    svg
      .append("text")
      .attr("x", 10)
      .attr("y", 6)
      .style("font-size", "12px")
      .style("font-weight", 700)
      .text(`${sizeMetric} color scale`);
  }

  function jumpToAuthor(name: string) {
    const lower = name.toLowerCase();
    const n =
      nodes.find((n) => n.name.toLowerCase() === lower) ??
      nodes.find((n) => n.name.toLowerCase().includes(lower));
    if (!n) return;

    focusId = n.id;

    const rect = canvasEl.getBoundingClientRect();
    const cssW = rect.width;
    const cssH = rect.height;
    const x = (n.x ?? 0) * transform.k + transform.x;
    const y = (n.y ?? 0) * transform.k + transform.y;
    const tx = cssW / 2 - x;
    const ty = cssH / 2 - y;
    const next = d3.zoomIdentity.translate(tx, ty).scale(transform.k);
    d3.select(canvasEl).call(zoomBehavior.transform, next);
    paint();
    updateSide();
  }

  function updateSide() {
    if (!sideEl) return;
    const el = d3.select(sideEl);
    el.html("");

    el.append("div").attr("class", "sideTitle").text("Key authors");
    el.append("div")
      .attr("class", "muted")
      .style("margin-bottom", "8px")
      .text(`Top by ${sizeMetric} in ${y0}–${y1}`);

    const order =
      sizeMetric === "strength"
        ? (a: Node, b: Node) => b.strength - a.strength
        : sizeMetric === "degree"
          ? (a: Node, b: Node) => b.degree - a.degree
          : (a: Node, b: Node) => b.pr - a.pr;

    const top = nodes.slice().sort(order).slice(0, 20);
    const list = el.append("div").attr("class", "list");

    top.forEach((n, i) => {
      const row = list.append("div").attr("class", "row");
      row
        .append("span")
        .attr("class", "rank")
        .text(`${i + 1}.`);
      row.append("span").attr("class", "name").text(n.name);
      row
        .append("span")
        .attr("class", "val")
        .text(
          sizeMetric === "strength"
            ? n.strength
            : sizeMetric === "degree"
              ? n.degree
              : n.pr.toFixed(4),
        );
      row.on("click", () => jumpToAuthor(n.name));
    });

    if (focusId != null) {
      const me = nodes[focusId];
      const neigh = new Map<number, number>();
      for (const l of links) {
        const s = l.source as any;
        const t = l.target as any;
        if (s === focusId) neigh.set(t, (neigh.get(t) ?? 0) + l.w);
        if (t === focusId) neigh.set(s, (neigh.get(s) ?? 0) + l.w);
      }
      const collab = Array.from(neigh.entries())
        .map(([id, w]) => ({ node: nodes[id], w }))
        .sort((a, b) => b.w - a.w)
        .slice(0, 10);

      el.append("div")
        .attr("class", "sideTitle")
        .style("margin-top", "10px")
        .text(me.name);
      el.append("div").attr("class", "muted").text("Top collaborators");

      const cList = el.append("div").attr("class", "list");
      collab.forEach(({ node, w }) => {
        const r = cList.append("div").attr("class", "row");
        r.append("span").attr("class", "name").text(node.name);
        r.append("span").attr("class", "val").text(w);
        r.on("click", () => jumpToAuthor(node.name));
      });
    }
  }

  // --- RESIZE ---------------------------------------------------------------
  function onResize() {
    if (!canvasEl) return;
    const rect = canvasEl.getBoundingClientRect();
    canvasEl.width = Math.max(1, rect.width * devicePixelRatio);
    canvasEl.height = Math.max(1, rect.height * devicePixelRatio);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(devicePixelRatio, devicePixelRatio);
    paint();
  }

  // --- UI HELPERS -----------------------------------------------------------
  function onPresetYears(range: [number, number]) {
    y0 = range[0];
    y1 = range[1];
    rebuild();
  }
  function updateAll() {
    rebuild();
  }

  function onMetricChange() {
    rebuild();
  }

  // --- MOUNT ----------------------------------------------------------------
  onMount(async () => {
    ctx = canvasEl.getContext("2d") as CanvasRenderingContext2D;
    onResize();
    window.addEventListener("resize", onResize);

    const [txtWorks, txtAuthors] = await Promise.all([
      fetch(CSV_WORKS).then((r) => r.text()),
      fetch(CSV_AUTHORS).then((r) => r.text()),
    ]);

    const rawWorks = d3.csvParse(txtWorks) as any[];
    rows = rawWorks
      .map((r) => ({
        work_id: String(r.work_id ?? r.work ?? ""),
        author_id: String(r.author_id ?? r.author ?? ""),
        countries: String(r.countries ?? ""),
        field: String(r.topic_field_display_name ?? r.field ?? ""),
        pub_year: +r.pub_year,
      }))
      .filter((r) => r.work_id && r.author_id && !Number.isNaN(r.pub_year));

    const rawAuthors = d3.csvParse(txtAuthors) as any[];
    authorNameById = new Map(
      rawAuthors.map((r) => {
        const id = String(r.id ?? r.author_id ?? "").trim();
        const name = String(r.display_name ?? r.name ?? id);
        return [id, name];
      }),
    );

    years = Array.from(new Set(rows.map((r) => r.pub_year))).sort(
      (a, b) => a - b,
    );
    yearMin = years[0] ?? 1970;
    yearMax = years.at(-1) ?? 2025;
    y0 = Math.max(yearMin, yearMax - 10);
    y1 = yearMax;

    setupZoom();
    rebuild();
  });
</script>

<h2>Who are the key contributors in AI research collaborations?</h2>

<!-- Controls -->
<div class="toolbar">
  <div class="group">
    <label>Years</label>
    <input
      type="range"
      min={yearMin}
      max={yearMax}
      bind:value={y0}
      on:input={() => {
        if (y0 > y1) y0 = y1;
        updateAll();
      }}
    />
    <span class="muted">{y0}</span>
    <input
      type="range"
      min={yearMin}
      max={yearMax}
      bind:value={y1}
      on:input={() => {
        if (y1 < y0) y1 = y0;
        updateAll();
      }}
    />
    <span class="muted">{y1}</span>
    <button class="pill" on:click={() => onPresetYears([yearMin, yearMax])}>
      All
    </button>
    <button class="pill" on:click={() => onPresetYears([2015, yearMax])}>
      2015+
    </button>
  </div>

  <div class="group">
    <label>Size/Color metric</label>
    <select bind:value={sizeMetric} on:change={onMetricChange}>
      <option value="strength">Weighted degree</option>
      <option value="degree">Degree</option>
      <option value="pagerank">PageRank</option>
    </select>
  </div>

  <div class="group">
    <label>Top authors</label>
    <input
      type="range"
      min="100"
      max="1500"
      step="50"
      bind:value={nodeLimit}
      on:input={updateAll}
    />
    <span class="muted">{nodeLimit}</span>
  </div>

  <div class="group">
    <label>Min link</label>
    <input
      type="range"
      min="1"
      max="5"
      step="1"
      bind:value={minLinkWeight}
      on:input={updateAll}
    />
    <span class="muted">{minLinkWeight}</span>
  </div>

  <div class="group">
    <label>Find</label>
    <input
      class="find"
      placeholder="Author name…"
      bind:value={search}
      on:keydown={(e) => {
        if (e.key === "Enter" && search.trim()) jumpToAuthor(search.trim());
      }}
    />
    <button class="pill" on:click={() => search && jumpToAuthor(search.trim())}
      >Go</button
    >
  </div>

  <div class="group">
    <label
      ><input
        type="checkbox"
        bind:checked={showLabels}
        on:change={() => paint()}
      />
      Labels</label
    >
  </div>
</div>

<div class="layout">
  <div class="stage">
    <canvas
      bind:this={canvasEl}
      on:mousemove={onMouseMove}
      on:mousedown={onMouseDown}
      on:mouseup={onMouseUp}
      on:dblclick={onDblClick}
    ></canvas>
    <div class="legend" bind:this={legendEl}></div>
  </div>
  <div class="side" bind:this={sideEl}></div>
</div>

<div class="tooltip" bind:this={tooltipEl}></div>

<style>
  :root {
    --line: #e5e7eb;
    --ink: #0f172a;
    --muted: #6b7280;
  }
  .toolbar {
    display: flex;
    gap: 14px;
    align-items: center;
    flex-wrap: wrap;
    margin-bottom: 8px;
    font-size: 14px;
  }
  .group {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  label {
    font-weight: 600;
    color: #111;
  }
  .muted {
    color: #6b7280;
  }
  .pill {
    padding: 6px 10px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: #fff;
    cursor: pointer;
  }
  .find {
    width: 200px;
    padding: 6px 10px;
    border: 1px solid var(--line);
    border-radius: 10px;
  }

  .layout {
    display: grid;
    grid-template-columns: minmax(620px, 1fr) 320px;
    gap: 12px;
  }
  @media (max-width: 1100px) {
    .layout {
      grid-template-columns: 1fr;
    }
  }

  .stage {
    position: relative;
    border: 1px solid var(--line);
    border-radius: 16px;
    background: linear-gradient(180deg, #fff, #fafafa);
    height: 70vh;
    min-height: 520px;
    overflow: hidden;
  }
  canvas {
    width: 100%;
    height: 100%;
    display: block;
    cursor: grab;
  }
  canvas:active {
    cursor: grabbing;
  }

  .legend {
    position: absolute;
    left: 10px;
    bottom: 8px;
    background: #fff;
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 6px 8px;
    max-width: 60%;
    box-shadow: 0 10px 24px rgba(0, 0, 0, 0.06);
    font-size: 12px;
  }

  .side {
    border: 1px solid var(--line);
    border-radius: 16px;
    padding: 12px;
    background: #fff;
  }
  .sideTitle {
    font-weight: 900;
    margin-bottom: 4px;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .row {
    display: flex;
    justify-content: space-between;
    gap: 10px;
  }
  .row .rank {
    width: 24px;
    color: #6b7280;
  }
  .row .name {
    flex: 1;
    cursor: pointer;
  }
  .row .val {
    color: #111;
    min-width: 64px;
    text-align: right;
  }

  .tooltip {
    position: absolute;
    pointer-events: none;
    opacity: 0;
    background: rgba(255, 255, 255, 0.98);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 10px 12px;
    font-size: 13px;
    box-shadow: 0 10px 24px rgba(0, 0, 0, 0.08);
  }
</style>
