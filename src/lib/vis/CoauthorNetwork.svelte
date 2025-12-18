<script lang="ts">
  import { onMount } from "svelte";
  import * as d3 from "d3";

  // --- DATA FILE ------------------------------------------------------------
  // CSV columns: work_id, author_id, countries, topic_field_display_name, pub_year
  const CSV_WORKS = "./authors_mingyang.csv";

  // --- CONSTANTS ------------------------------------------------------------
  const FIELD_COLORS = [
    "#1f77b4",
    "#ff7f0e",
    "#2ca02c",
    "#d62728",
    "#9467bd",
    "#8c564b",
    "#e377c2",
    "#7f7f7f",
    "#bcbd22",
    "#17becf",
    "#6366f1",
    "#0ea5e9",
    "#22c55e",
    "#f97316",
    "#e11d48",
  ];

  const ALL_FIELDS = "__ALL__";

  // --- TYPES ----------------------------------------------------------------
  type Row = {
    work_id: string;
    author_id: string; // author name
    countries: string;
    field: string;
    pub_year: number;
  };

  type Node = {
    id: number;
    authorId: string; // author name
    name: string;
    field: string; // dominant topic field
    strength: number;
    degree: number;
    pr: number;
    crossField?: boolean; // collaborates with at least one other field
    x?: number;
    y?: number;
    vx?: number;
    vy?: number;
    fx?: number | null;
    fy?: number | null;
    pinned?: boolean;
  };

  type Link = { source: number; target: number; w: number };
  type FieldPair = { a: string; b: string; w: number };

  // --- YEAR RANGE UI --------------------------------------------------------
  let years: number[] = [];
  let yearMin = 1970;
  let yearMax = 2025;
  let y0 = 2015;
  let y1 = 2025;

  // --- GRAPH FILTERS --------------------------------------------------------
  let nodeLimit = 300;
  let minLinkWeight = 1;
  let sizeMetric: "strength" | "degree" | "pagerank" = "strength";
  let colorMode: "field" | "metric" = "field";

  let search = "";
  let showLabels = true;

  // field selector
  let selectedField: string = ALL_FIELDS;
  let availableFields: string[] = [];

  // --- DATA HOLDERS ---------------------------------------------------------
  let rows: Row[] = [];
  let nodes: Node[] = [];
  let links: Link[] = [];
  let fieldPairs: FieldPair[] = [];

  // global collaboration info (from full graph, before field filter)
  let neighborAuthorsByAuthor = new Map<string, Map<string, number>>(); // author -> (coauthor -> w)
  let neighborFieldsByAuthor = new Map<string, Map<string, number>>(); // author -> (field -> w)
  let authorField = new Map<string, string>(); // author -> dominant field

  // --- CANVAS / D3 STATE ----------------------------------------------------
  let canvasEl: HTMLCanvasElement;
  let tooltipEl: HTMLDivElement;
  let legendEl: HTMLDivElement;
  let sideEl: HTMLDivElement;

  let ctx: CanvasRenderingContext2D;
  let sim: d3.Simulation<Node, Link> | null = null;
  let zoomBehavior: d3.ZoomBehavior<HTMLCanvasElement, unknown>;
  let transform = d3.zoomIdentity;

  let colorMetric = d3.scaleSequential(d3.interpolateTurbo).domain([0, 1]);
  let colorField = d3.scaleOrdinal<string, string>();

  // Hover / focus
  let hoverId: number | null = null;
  let focusId: number | null = null;

  // --- HELPERS --------------------------------------------------------------
  function mval(n: Node) {
    return sizeMetric === "strength"
      ? n.strength
      : sizeMetric === "degree"
        ? n.degree
        : n.pr;
  }

  function metricLabel() {
    if (sizeMetric === "strength") return "strength (weighted degree)";
    if (sizeMetric === "degree") return "degree";
    return "PageRank";
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

  function nodeRadius(n: Node) {
    const v = mval(n) || 1;
    return 2.5 + Math.sqrt(v);
  }

  // --- BUILD GRAPH ----------------------------------------------------------
  function rebuild() {
    hoverId = null;
    focusId = null;

    neighborAuthorsByAuthor = new Map();
    neighborFieldsByAuthor = new Map();
    authorField = new Map();

    const idOf = new Map<string, number>();
    const edges = new Map<string, number>();
    const authorsByWork = new Map<string, string[]>();
    const fieldCounts = new Map<string, Map<string, number>>();

    // 1) build authors-by-work and field counts in year range
    for (const r of rows) {
      if (r.pub_year < y0 || r.pub_year > y1) continue;

      const arr =
        authorsByWork.get(r.work_id) ??
        (authorsByWork.set(r.work_id, []), authorsByWork.get(r.work_id)!);
      arr.push(r.author_id);

      const fMap =
        fieldCounts.get(r.author_id) ??
        (fieldCounts.set(r.author_id, new Map()),
        fieldCounts.get(r.author_id)!);
      const prev = fMap.get(r.field) ?? 0;
      fMap.set(r.field, prev + 1);
    }

    // 2) co-auth edges
    for (const [, authorsRaw] of authorsByWork) {
      const authors = Array.from(new Set(authorsRaw));
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

    // 3) full node/link arrays with dominant field
    let allNodes: Node[] = Array.from(idOf.entries()).map(
      ([authorName, id]) => {
        const fMap = fieldCounts.get(authorName);
        let field = "Unknown";
        if (fMap && fMap.size) {
          field = Array.from(fMap.entries()).sort((a, b) => b[1] - a[1])[0][0];
        }
        authorField.set(authorName, field);
        return {
          id,
          authorId: authorName,
          name: authorName,
          field,
          strength: 0,
          degree: 0,
          pr: 0,
          crossField: false,
        };
      },
    );

    let allLinks: Link[] = Array.from(edges.entries()).map(([k, w]) => {
      const [a, b] = k.split("|").map(Number);
      return { source: a, target: b, w };
    });

    if (minLinkWeight > 1) {
      allLinks = allLinks.filter((l) => l.w >= minLinkWeight);
    }

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

    allNodes = allNodes.filter((n) => n.degree > 0);
    const keepIds = new Set(allNodes.map((n) => n.id));
    allLinks = allLinks.filter(
      (l) => keepIds.has(l.source) && keepIds.has(l.target),
    );

    if (!allNodes.length) {
      nodes = [];
      links = [];
      fieldPairs = [];
      updateSide();
      drawLegend();
      paint();
      return;
    }

    // --- global neighbor info BEFORE field filter / nodeLimit ---------------
    const idToNode = new Map<number, Node>();
    allNodes.forEach((n) => idToNode.set(n.id, n));

    for (const l of allLinks) {
      const a = idToNode.get(l.source as number);
      const b = idToNode.get(l.target as number);
      if (!a || !b) continue;

      let neighA = neighborAuthorsByAuthor.get(a.authorId);
      if (!neighA) {
        neighA = new Map();
        neighborAuthorsByAuthor.set(a.authorId, neighA);
      }
      neighA.set(b.authorId, (neighA.get(b.authorId) ?? 0) + l.w);

      let neighB = neighborAuthorsByAuthor.get(b.authorId);
      if (!neighB) {
        neighB = new Map();
        neighborAuthorsByAuthor.set(b.authorId, neighB);
      }
      neighB.set(a.authorId, (neighB.get(a.authorId) ?? 0) + l.w);

      let fA = neighborFieldsByAuthor.get(a.authorId);
      if (!fA) {
        fA = new Map();
        neighborFieldsByAuthor.set(a.authorId, fA);
      }
      fA.set(b.field, (fA.get(b.field) ?? 0) + l.w);

      let fB = neighborFieldsByAuthor.get(b.authorId);
      if (!fB) {
        fB = new Map();
        neighborFieldsByAuthor.set(b.authorId, fB);
      }
      fB.set(a.field, (fB.get(a.field) ?? 0) + l.w);
    }

    allNodes.forEach((n) => {
      const f0 = n.field;
      const fMap = neighborFieldsByAuthor.get(n.authorId);
      let cross = false;
      if (fMap) {
        for (const [f] of fMap) {
          if (f !== f0) {
            cross = true;
            break;
          }
        }
      }
      n.crossField = cross;
    });

    // 4) filter by selected field (subnetwork view)
    if (selectedField !== ALL_FIELDS) {
      allNodes = allNodes.filter((n) => n.field === selectedField);
      const fieldIds = new Set(allNodes.map((n) => n.id));
      allLinks = allLinks.filter(
        (l) => fieldIds.has(l.source) && fieldIds.has(l.target),
      );
    }

    if (!allNodes.length) {
      nodes = [];
      links = [];
      fieldPairs = [];
      updateSide();
      drawLegend();
      paint();
      return;
    }

    // 5) keep top-N by metric
    allNodes.sort((a, b) => mval(b) - mval(a) || b.degree - a.degree);
    const keepTop = new Set(allNodes.slice(0, nodeLimit).map((n) => n.id));
    allNodes = allNodes.filter((n) => keepTop.has(n.id));
    allLinks = allLinks.filter(
      (l) => keepTop.has(l.source) && keepTop.has(l.target),
    );

    const newIndex = new Map<number, number>();
    allNodes.forEach((n, i) => newIndex.set(n.id, i));
    nodes = allNodes.map((n, i) => ({ ...n, id: i }));
    links = allLinks.map((l) => ({
      source: newIndex.get(l.source)!,
      target: newIndex.get(l.target)!,
      w: l.w,
    }));

    if (!nodes.length) {
      fieldPairs = [];
      updateSide();
      drawLegend();
      paint();
      return;
    }

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

    const vals = nodes.map(mval);
    const lo = d3.min(vals) ?? 0;
    const hi = d3.max(vals) ?? 1;
    colorMetric = d3.scaleSequential(d3.interpolateTurbo).domain([lo, hi || 1]);

    const uniqueFields = Array.from(new Set(nodes.map((n) => n.field))).sort();
    colorField = d3
      .scaleOrdinal<string, string>()
      .domain(uniqueFields)
      .range(FIELD_COLORS.slice(0, uniqueFields.length));

    const pairMap = new Map<string, number>();
    for (const l of links) {
      const s = nodes[l.source as any];
      const t = nodes[l.target as any];
      if (!s || !t) continue;
      const f1 = s.field;
      const f2 = t.field;
      const key = f1 <= f2 ? `${f1}|||${f2}` : `${f2}|||${f1}`;
      pairMap.set(key, (pairMap.get(key) ?? 0) + l.w);
    }
    fieldPairs = Array.from(pairMap.entries())
      .map(([key, w]) => {
        const [a, b] = key.split("|||");
        return { a, b, w };
      })
      .sort((x, y) => y.w - x.w)
      .slice(0, 8);

    restartSim();
    drawLegend();
    updateSide();
  }

  // --- SIMULATION / DRAWING -------------------------------------------------
  function paint() {
    if (!ctx || !canvasEl) return;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    ctx.restore();

    ctx.save();
    ctx.scale(devicePixelRatio, devicePixelRatio);
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.k, transform.k);

    // links
    ctx.lineWidth = 0.6 / transform.k;
    ctx.strokeStyle = "rgba(60,64,67,0.18)";
    for (const l of links) {
      const a = nodes[l.source as any];
      const b = nodes[l.target as any];
      if (!a || !b || a.x == null || b.x == null) continue;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // ego highlight
    if (focusId != null) {
      ctx.lineWidth = 1.4 / transform.k;
      ctx.strokeStyle = "rgba(15,23,42,0.45)";
      for (const l of links) {
        const s = l.source as any;
        const t = l.target as any;
        if (s === focusId || t === focusId) {
          const a = nodes[s];
          const b = nodes[t];
          if (!a || !b) continue;
          ctx.beginPath();
          ctx.moveTo(a.x!, a.y!);
          ctx.lineTo(b.x!, b.y!);
          ctx.stroke();
        }
      }
    }

    // nodes
    for (const n of nodes) {
      if (n.x == null || n.y == null) continue;
      const r = nodeRadius(n);

      ctx.beginPath();
      const fill =
        colorMode === "metric"
          ? colorMetric(mval(n))
          : (colorField(n.field) as string);
      ctx.fillStyle = fill;
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fill();

      // cross-field outline
      if (n.crossField) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 2 / transform.k, 0, Math.PI * 2);
        ctx.lineWidth = 1.5 / transform.k;
        ctx.strokeStyle = "rgba(5,150,105,0.9)";
        ctx.stroke();
      }

      if (hoverId === n.id || focusId === n.id) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 3 / transform.k, 0, Math.PI * 2);
        ctx.lineWidth = 2 / transform.k;
        ctx.strokeStyle = "#111827";
        ctx.stroke();
      }
    }

    // labels
    if (showLabels) {
      ctx.font = `${
        11 / transform.k
      }px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(15,23,42,.95)";
      const pad = 3 / transform.k;

      const top = nodes
        .slice()
        .sort((a, b) => mval(b) - mval(a))
        .slice(0, 20);

      const drawLabel = (n: Node) => {
        if (n.x != null && n.y != null)
          ctx.fillText(n.name, n.x + nodeRadius(n) + pad, n.y);
      };

      for (const n of top) drawLabel(n);
      if (hoverId != null && nodes[hoverId]) drawLabel(nodes[hoverId]);
      if (focusId != null && nodes[focusId]) drawLabel(nodes[focusId]);
    }

    ctx.restore();
  }

  function restartSim() {
    if (!canvasEl || !ctx) return;

    const cssW = canvasEl.width / devicePixelRatio;
    const cssH = canvasEl.height / devicePixelRatio;

    if (sim) sim.stop();

    const radius = Math.min(cssW, cssH) * 0.25;
    nodes.forEach((n, i) => {
      const angle = (2 * Math.PI * i) / nodes.length;
      n.x = cssW / 2 + radius * Math.cos(angle);
      n.y = cssH / 2 + radius * Math.sin(angle);
    });

    sim = d3
      .forceSimulation(nodes)
      .force(
        "link",
        d3
          .forceLink(links)
          .id((d: any) => d.id)
          .distance((l) => 40 + 70 / Math.sqrt((l as any).w))
          .strength(0.6),
      )
      .force(
        "charge",
        d3.forceManyBody().strength(-120).distanceMax(Math.max(cssW, cssH)),
      )
      .force("center", d3.forceCenter(cssW / 2, cssH / 2))
      .force(
        "collide",
        d3
          .forceCollide()
          .radius((d: any) => nodeRadius(d) + 4)
          .strength(0.9),
      )
      .alpha(0.9)
      .alphaDecay(0.04)
      .on("tick", paint)
      .on("end", () => {
        if (sim) sim.alphaTarget(0);
        paint();
      });

    paint();
  }

  // --- ZOOM / PICKING -------------------------------------------------------
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
          <div style="font-weight:700;margin-bottom:4px">${n.name}</div>
          <div style="font-size:13px;opacity:.85;margin-bottom:2px">
            Field: <b>${n.field}</b>
          </div>
          <div style="font-size:12px;opacity:.7">
            Degree: <b>${n.degree}</b> ·
            Strength: <b>${n.strength}</b> ·
            PageRank: <b>${n.pr.toFixed(4)}</b>
          </div>
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
      if (sim) sim.alphaTarget(0.3).restart();
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

    if (colorMode === "metric") {
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
    } else {
      el.append("div")
        .attr("class", "legendTitle")
        .text("Node color = main research field");

      const fields = colorField.domain().slice(0, 10);
      const list = el.append("div").attr("class", "fieldLegendList");
      fields.forEach((f) => {
        const row = list.append("div").attr("class", "fieldRow");
        row
          .append("span")
          .attr("class", "fieldSwatch")
          .style("background", colorField(f) as string);
        row.append("span").attr("class", "fieldName").text(f);
      });
    }

    el.append("div")
      .attr("class", "legendNote")
      .text("Outline = authors collaborating across fields");
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

    const fieldLabel =
      selectedField === ALL_FIELDS ? "all fields" : selectedField;

    // -----------------------------------------------------------------------
    // 1) TOP AUTHORS IN SELECTED FIELD
    // -----------------------------------------------------------------------
    el.append("div")
      .attr("class", "sideTitle")
      .text("Top authors in selected field");

    el.append("div")
      .attr("class", "sideSub")
      .style("margin-bottom", "8px")
      .text(`Top by ${metricLabel()} in ${y0}–${y1} (${fieldLabel})`);

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

    // if no author selected, stop after part 1
    if (focusId == null || !nodes[focusId]) return;

    const me = nodes[focusId];

    el.append("div").attr("class", "sideDivider");

    el.append("div").attr("class", "sideAuthor").text(me.name);
    el.append("div")
      .attr("class", "sideSub")
      .text(
        me.crossField
          ? `${me.field} · collaborates with other fields`
          : me.field,
      );

    const neighAuthors = neighborAuthorsByAuthor.get(me.authorId);
    let allCollab: { name: string; field: string; w: number }[] = [];
    if (neighAuthors) {
      allCollab = Array.from(neighAuthors.entries())
        .map(([name, w]) => ({
          name,
          field: authorField.get(name) ?? "Unknown",
          w,
        }))
        .sort((a, b) => b.w - a.w);
    }

    const inField = allCollab.filter((c) => c.field === me.field).slice(0, 8);
    const outField = allCollab.filter((c) => c.field !== me.field).slice(0, 8);

    // -----------------------------------------------------------------------
    // 2) WITHIN-FIELD COLLABORATORS (NO FIELD LABELS NEEDED)
    // -----------------------------------------------------------------------
    el.append("div")
      .attr("class", "sideTitle")
      .style("margin-top", "8px")
      .text("Within-field collaborators");

    if (inField.length) {
      el.append("div")
        .attr("class", "sideNote")
        .text(`Co-authors whose main field is ${me.field}.`);

      const cList = el.append("div").attr("class", "collabList");
      inField.forEach((c) => {
        const row = cList.append("div").attr("class", "collabRow");
        const nameEl = row.append("div").attr("class", "collabName");
        nameEl.text(c.name);
        nameEl.on("click", () => jumpToAuthor(c.name));

        row
          .append("div")
          .attr("class", "collabMeta")
          .text(`${c.w} co-authored papers`);
      });
    } else {
      el.append("div")
        .attr("class", "sideNote")
        .text("None in the current filters.");
    }

    // -----------------------------------------------------------------------
    // 3) CROSS-FIELD COLLABORATORS (SHOW FIELD NAMES)
    // -----------------------------------------------------------------------
    el.append("div")
      .attr("class", "sideTitle")
      .style("margin-top", "10px")
      .text("Cross-field collaborators");

    if (outField.length) {
      el.append("div")
        .attr("class", "sideNote")
        .text(`Co-authors whose main field is not ${me.field}.`);

      const cList2 = el.append("div").attr("class", "collabList");
      outField.forEach((c) => {
        const row = cList2.append("div").attr("class", "collabRow");
        const nameEl = row.append("div").attr("class", "collabName");
        nameEl.text(c.name);
        nameEl.on("click", () => jumpToAuthor(c.name));

        row
          .append("div")
          .attr("class", "collabMeta")
          .text(`${c.field} · ${c.w} co-authored papers`);
      });
    } else {
      el.append("div")
        .attr("class", "sideNote")
        .text("None in the current filters.");
    }
  }

  // --- RESIZE & UI HELPERS --------------------------------------------------
  function onResize() {
    if (!canvasEl || !ctx) return;
    const rect = canvasEl.getBoundingClientRect();
    canvasEl.width = Math.max(1, rect.width * devicePixelRatio);
    canvasEl.height = Math.max(1, rect.height * devicePixelRatio);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.scale(devicePixelRatio, devicePixelRatio);
    paint();
  }

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

  function onColorModeChange() {
    drawLegend();
    paint();
  }

  // --- MOUNT ----------------------------------------------------------------
  onMount(async () => {
    ctx = canvasEl.getContext("2d") as CanvasRenderingContext2D;
    onResize();
    window.addEventListener("resize", onResize);

    const txtWorks = await fetch(CSV_WORKS).then((r) => r.text());
    const rawWorks = d3.csvParse(txtWorks) as any[];

    rows = rawWorks
      .map((r) => ({
        work_id: String(r.work_id ?? r.work ?? ""),
        author_id: String(r.author_id ?? r.author ?? ""),
        countries: String(r.countries ?? ""),
        field: String(r.topic_field_display_name ?? r.field ?? "Unknown"),
        pub_year: +r.pub_year,
      }))
      .filter((r) => r.work_id && r.author_id && !Number.isNaN(r.pub_year));

    years = Array.from(new Set(rows.map((r) => r.pub_year))).sort(
      (a, b) => a - b,
    );
    yearMin = years[0] ?? 1970;
    yearMax = years.at(-1) ?? 2025;
    y0 = Math.max(yearMin, yearMax - 10);
    y1 = yearMax;

    availableFields = Array.from(new Set(rows.map((r) => r.field))).sort();

    setupZoom();
    rebuild();
  });
</script>

<h2>How do AI research fields connect through co-authorship?</h2>

<p class="hint">
  Each circle is an author. Use the <b>Field view</b> menu to focus on one
  research field; rings mark authors who also collaborate with other fields.
  Click an author on the right to see their closest collaborators <b>inside</b>
  and <b>outside</b> that field.
</p>

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
    <label>Size metric</label>
    <select bind:value={sizeMetric} on:change={onMetricChange}>
      <option value="strength">Weighted degree</option>
      <option value="degree">Degree</option>
      <option value="pagerank">PageRank</option>
    </select>
  </div>

  <div class="group">
    <label>Color by</label>
    <select bind:value={colorMode} on:change={onColorModeChange}>
      <option value="field">Field</option>
      <option value="metric">Metric</option>
    </select>
  </div>

  <div class="group">
    <label>Field view</label>
    <select bind:value={selectedField} on:change={updateAll}>
      <option value={ALL_FIELDS}>All fields</option>
      {#each availableFields as f}
        <option value={f}>{f}</option>
      {/each}
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
    --bg: #f9fafb;
  }

  h2 {
    margin-bottom: 4px;
  }

  .hint {
    margin-top: 0;
    margin-bottom: 10px;
    font-size: 13px;
    color: var(--muted);
    max-width: 720px;
  }

  .toolbar {
    display: flex;
    gap: 14px;
    align-items: center;
    flex-wrap: wrap;
    margin-bottom: 10px;
    font-size: 14px;
  }
  .group {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  label {
    font-weight: 600;
    color: #111827;
  }
  .muted {
    color: var(--muted);
  }
  .pill {
    padding: 6px 10px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: #fff;
    cursor: pointer;
    font-size: 13px;
  }
  .pill:hover {
    background: #f3f4f6;
  }
  .find {
    width: 200px;
    padding: 6px 10px;
    border: 1px solid var(--line);
    border-radius: 10px;
    font-size: 13px;
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
    background: linear-gradient(180deg, #fff, #f9fafb);
    height: 70vh;
    min-height: 520px;
    overflow: hidden;
    box-shadow: 0 18px 40px rgba(15, 23, 42, 0.06);
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
  .legendTitle {
    font-weight: 600;
    font-size: 12px;
    margin-bottom: 4px;
  }
  .legendNote {
    margin-top: 4px;
    font-size: 11px;
    color: var(--muted);
  }
  .fieldLegendList {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 10px;
  }
  .fieldRow {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
  }
  .fieldSwatch {
    width: 10px;
    height: 10px;
    border-radius: 999px;
    display: inline-block;
  }
  .fieldName {
    white-space: nowrap;
  }

  .side {
    border: 1px solid var(--line);
    border-radius: 16px;
    padding: 12px;
    background: #fff;
    box-shadow: 0 18px 40px rgba(15, 23, 42, 0.04);
    max-height: 70vh;
    overflow: auto;
    font-size: 13px;
  }
  .sideTitle {
    font-weight: 800;
    margin-bottom: 4px;
  }
  .sideSub {
    font-size: 12px;
    color: #6b7280;
  }
  .sideAuthor {
    font-weight: 600;
    font-size: 13px;
    color: #111827;
    margin-bottom: 2px;
  }
  .sideNote {
    font-size: 11px;
    color: #9ca3af;
    margin-bottom: 4px;
  }
  .sideDivider {
    border-top: 1px solid #e5e7eb;
    margin: 10px 0;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .row {
    display: grid;
    grid-template-columns: 24px minmax(0, 1.5fr) auto;
    column-gap: 6px;
    align-items: baseline;
    padding: 2px 0;
    font-size: 13px;
  }
  .row .rank {
    color: #9ca3af;
  }
  .row .name {
    cursor: pointer;
    color: #111827;
  }
  .row .name:hover {
    text-decoration: underline;
  }
  .row .val {
    color: #111827;
    text-align: right;
    min-width: 44px;
    font-variant-numeric: tabular-nums;
  }

  .collabList {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 13px;
  }
  .collabRow {
    display: flex;
    justify-content: space-between;
    gap: 6px;
  }
  .collabName {
    cursor: pointer;
    color: #111827;
  }
  .collabName:hover {
    text-decoration: underline;
  }
  .collabMeta {
    font-size: 12px;
    color: #6b7280;
    font-variant-numeric: tabular-nums;
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
