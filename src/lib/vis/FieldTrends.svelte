<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import * as d3 from "d3";
  import {
    loadWorks,
    yearsFrom,
    splitFieldString,
    type WorkRow,
  } from "$lib/vis/worksData";

  // -------------------- STATE --------------------
  let metric: "unique" | "authorships" = "authorships";
  let showTotal = true;

  let rows: WorkRow[] = [];
  let years: number[] = [];
  let yearMin = 1970;
  let yearMax = 2025;
  let rangeStart: number;
  let rangeEnd: number;

  // per-field series: Map<FieldName, Array<[year, value]>>
  const seriesUnique = new Map<string, Array<[number, number]>>();
  const seriesAuth = new Map<string, Array<[number, number]>>();
  let totalUnique: Array<[number, number]> = [];
  let totalAuth: Array<[number, number]> = [];
  let allFields: string[] = [];

  let sel1 = "";
  let sel2 = "";

  // hover state (for tooltip)
  type HoverRow = {
    name: string;
    value: number;
    color: string;
    isTotal?: boolean;
  };
  let hoverYear: number | null = null;
  let hoverValues: HoverRow[] = [];

  // -------------------- DOM / D3 REFS --------------------
  let wrap: HTMLDivElement;
  let mainSvg: SVGSVGElement;
  let miniSvg: SVGSVGElement;

  let width = 900;
  const mainHeight = 360;
  const miniHeight = 80;

  const margin = { top: 30, right: 24, bottom: 40, left: 60 };

  let xScale: d3.ScaleLinear<number, number>;
  let yScale: d3.ScaleLinear<number, number>;
  let xMiniScale: d3.ScaleLinear<number, number>;
  let yMiniScale: d3.ScaleLinear<number, number>;
  let colorScale: d3.ScaleOrdinal<string, string>;

  const fmt = d3.format(",");

  const fieldColor = (f: string) =>
    colorScale ? (colorScale(f) as string) : "#6366f1";

  // -------------------- LIFECYCLE --------------------
  onMount(async () => {
    rows = await loadWorks();
    if (!rows.length) {
      console.warn("FieldTrends: loadWorks() returned no rows.");
      return;
    }

    years = yearsFrom(rows);
    years.sort((a, b) => a - b);
    yearMin = years[0];
    yearMax = years[years.length - 1];

    aggregate();

    rangeStart = yearMin;
    rangeEnd = yearMax;

    if (wrap) {
      width = wrap.clientWidth || 900;
    }

    redrawBoth();

    window.addEventListener("resize", handleResize);
  });

  onDestroy(() => {
    window.removeEventListener("resize", handleResize);
  });

  function handleResize() {
    if (!wrap) return;
    const w = wrap.clientWidth;
    if (!w || w === width) return;
    width = w;
    redrawBoth();
  }

  // -------------------- AGGREGATION --------------------
  function aggregate() {
    seriesUnique.clear();
    seriesAuth.clear();

    const byFU = new Map<string, Map<number, Set<string>>>();
    const byFA = new Map<string, Map<number, number>>();
    const uniqByYear = new Map<number, Set<string>>();
    const authByYear = new Map<number, number>();

    for (const r of rows) {
      const y = r.year;
      if (Number.isNaN(y)) continue;

      const aid = r.authorId;
      const fields = splitFieldString(r.field);
      if (!fields.length) continue;

      // overall unique authors per year
      let uy = uniqByYear.get(y);
      if (!uy) {
        uy = new Set<string>();
        uniqByYear.set(y, uy);
      }
      uy.add(aid);

      // overall authorships per year
      authByYear.set(y, (authByYear.get(y) ?? 0) + 1);

      // per-field
      for (const f of fields) {
        // unique authors
        let uMap = byFU.get(f);
        if (!uMap) {
          uMap = new Map<number, Set<string>>();
          byFU.set(f, uMap);
        }
        let uSet = uMap.get(y);
        if (!uSet) {
          uSet = new Set<string>();
          uMap.set(y, uSet);
        }
        uSet.add(aid);

        // authorships
        let aMap = byFA.get(f);
        if (!aMap) {
          aMap = new Map<number, number>();
          byFA.set(f, aMap);
        }
        aMap.set(y, (aMap.get(y) ?? 0) + 1);
      }
    }

    // build time series arrays (ensure every year is present)
    for (const f of byFA.keys()) {
      seriesUnique.set(
        f,
        years.map((y) => [y, byFU.get(f)?.get(y)?.size ?? 0]),
      );
      seriesAuth.set(
        f,
        years.map((y) => [y, byFA.get(f)?.get(y) ?? 0]),
      );
    }

    totalUnique = years.map((y) => [y, uniqByYear.get(y)?.size ?? 0]);
    totalAuth = years.map((y) => [y, authByYear.get(y) ?? 0]);

    allFields = Array.from(
      new Set<string>([...seriesUnique.keys(), ...seriesAuth.keys()]),
    ).sort();

    const pal = d3.quantize(
      d3.interpolateRainbow,
      Math.max(12, allFields.length),
    );
    colorScale = d3.scaleOrdinal<string, string>().domain(allFields).range(pal);

    if (!sel1 && allFields.length > 0) {
      sel1 = allFields[0];
    }
    if (!sel2) {
      sel2 = "";
    }
  }

  // -------------------- HELPERS --------------------
  function currentSeriesMap() {
    return metric === "unique" ? seriesUnique : seriesAuth;
  }

  function totalSeries() {
    return metric === "unique" ? totalUnique : totalAuth;
  }

  function metricLabel() {
    return metric === "unique"
      ? "Unique authors per year"
      : "Total authorships per year";
  }

  function redrawMain() {
    if (!rows.length || !mainSvg) return;
    drawMainChart();
  }

  function redrawBoth() {
    if (!rows.length || !mainSvg || !miniSvg) return;
    drawMiniChart();
    drawMainChart();
  }

  function setMetric(m: "unique" | "authorships") {
    metric = m;
    redrawBoth();
  }

  function onSel1Change(e: Event) {
    sel1 = (e.target as HTMLSelectElement).value;
    redrawMain();
  }

  function onSel2Change(e: Event) {
    sel2 = (e.target as HTMLSelectElement).value;
    redrawMain();
  }

  function onToggleTotal() {
    showTotal = !showTotal;
    redrawMain();
  }

  // -------------------- MAIN CHART --------------------
  function drawMainChart() {
    const svg = d3.select(mainSvg);
    svg.selectAll("*").remove();

    const w = width;
    const h = mainHeight;

    svg.attr("viewBox", `0 0 ${w} ${h}`);

    // x-scale based on current brush range
    xScale = d3
      .scaleLinear()
      .domain([rangeStart, rangeEnd])
      .range([margin.left, w - margin.right]);

    const map = currentSeriesMap();

    const slice = (series: [number, number][]) =>
      series.filter(([yr]) => yr >= rangeStart && yr <= rangeEnd);

    const lines: {
      name: string;
      data: [number, number][];
      color: string;
      dashed?: boolean;
      isTotal?: boolean;
    }[] = [];

    if (sel1 && map.get(sel1)) {
      lines.push({
        name: sel1,
        data: slice(map.get(sel1)!),
        color: fieldColor(sel1),
      });
    }

    if (sel2 && map.get(sel2)) {
      lines.push({
        name: sel2,
        data: slice(map.get(sel2)!),
        color: fieldColor(sel2),
        dashed: true,
      });
    }

    if (showTotal) {
      lines.push({
        name: "Total",
        data: slice(totalSeries()),
        color: "#111827",
        isTotal: true,
      });
    }

    const allVals = lines.flatMap((s) => s.data.map((d) => d[1]));
    const yMax = (d3.max(allVals) ?? 1) * 1.05;

    yScale = d3
      .scaleLinear()
      .domain([0, yMax])
      .nice()
      .range([h - margin.bottom, margin.top]);

    const xAxis = d3
      .axisBottom<number>(xScale)
      .tickFormat(d3.format("d") as (d: number) => string);
    const yAxis = d3.axisLeft<number>(yScale).ticks(6);

    // grid
    svg
      .append("g")
      .attr("class", "grid")
      .attr("transform", `translate(${margin.left},0)`)
      .call(
        d3
          .axisLeft(yScale)
          .ticks(6)
          .tickSize(-(w - margin.left - margin.right))
          .tickFormat(() => ""),
      );

    // axes
    svg
      .append("g")
      .attr("transform", `translate(0,${h - margin.bottom})`)
      .attr("class", "axis axis-x")
      .call(xAxis);

    svg
      .append("g")
      .attr("transform", `translate(${margin.left},0)`)
      .attr("class", "axis axis-y")
      .call(yAxis);

    // line generator
    const lineGen = d3
      .line<[number, number]>()
      .x(([year]) => xScale(year))
      .y(([, v]) => yScale(v))
      .curve(d3.curveMonotoneX);

    // draw series
    for (const s of lines) {
      svg
        .append("path")
        .datum(s.data)
        .attr("fill", "none")
        .attr("stroke", s.color)
        .attr("stroke-width", s.isTotal ? 2.4 : 2.2)
        .attr("stroke-linecap", "round")
        .attr("stroke-linejoin", "round")
        .attr("stroke-dasharray", s.dashed ? "4 3" : null)
        .attr("d", lineGen);
    }

    // y-axis label
    svg
      .append("text")
      .attr("transform", "rotate(-90)")
      .attr("x", -h / 2)
      .attr("y", 18)
      .attr("text-anchor", "middle")
      .attr("font-size", 10)
      .text(metric === "unique" ? "Unique authors" : "Authorships");

    // cursor line for hover
    svg
      .append("line")
      .attr("class", "cursor-line")
      .attr("y1", margin.top)
      .attr("y2", h - margin.bottom)
      .attr("stroke", "#9ca3af")
      .attr("stroke-width", 1.2)
      .attr("stroke-dasharray", "3,3")
      .style("opacity", 0);

    // overlay for pointer events
    svg
      .append("rect")
      .attr("class", "overlay")
      .attr("x", margin.left)
      .attr("y", margin.top)
      .attr("width", w - margin.left - margin.right)
      .attr("height", h - margin.top - margin.bottom)
      .attr("fill", "transparent")
      .style("cursor", "crosshair")
      .on("pointermove", (event: any) => handleMove(event, xScale))
      .on("pointerleave", () => handleLeave());
  }

  // -------------------- MINI CHART + BRUSH --------------------
  function drawMiniChart() {
    const svg = d3.select(miniSvg);
    svg.selectAll("*").remove();

    const w = width;
    const h = miniHeight;

    svg.attr("viewBox", `0 0 ${w} ${h}`);

    const marginMini = { top: 6, right: 24, bottom: 18, left: 60 };

    xMiniScale = d3
      .scaleLinear()
      .domain([yearMin, yearMax])
      .range([marginMini.left, w - marginMini.right]);

    const data = totalSeries();
    const yMax = (d3.max(data, (d) => d[1]) ?? 1) * 1.05;

    yMiniScale = d3
      .scaleLinear()
      .domain([0, yMax])
      .range([h - marginMini.bottom, marginMini.top]);

    const area = d3
      .area<[number, number]>()
      .x(([year]) => xMiniScale(year))
      .y0(h - marginMini.bottom)
      .y1(([, v]) => yMiniScale(v))
      .curve(d3.curveMonotoneX);

    svg
      .append("path")
      .datum(data)
      .attr("fill", "rgba(59,130,246,0.25)")
      .attr("stroke", "rgba(59,130,246,0.9)")
      .attr("stroke-width", 1.2)
      .attr("d", area);

    // simple baseline
    svg
      .append("line")
      .attr("x1", marginMini.left)
      .attr("x2", w - marginMini.right)
      .attr("y1", h - marginMini.bottom + 0.5)
      .attr("y2", h - marginMini.bottom + 0.5)
      .attr("stroke", "#d1d5db");

    const brush = d3
      .brushX()
      .extent([
        [marginMini.left, marginMini.top],
        [w - marginMini.right, h - marginMini.bottom],
      ])
      .on("brush end", (event: any) => brushed(event, xMiniScale));

    const gBrush = svg
      .append("g")
      .attr("class", "brush")
      .call(brush as any);

    // initial selection: full range
    const initialSel: [number, number] = [
      xMiniScale(rangeStart),
      xMiniScale(rangeEnd),
    ];
    gBrush.call((brush as any).move, initialSel);
  }

  function brushed(event: any, xMini: d3.ScaleLinear<number, number>) {
    if (!event.selection) return;
    const [x0, x1] = event.selection;

    let sYear = xMini.invert(x0);
    let eYear = xMini.invert(x1);

    rangeStart = Math.max(yearMin, Math.round(sYear));
    rangeEnd = Math.min(yearMax, Math.round(eYear));

    if (rangeEnd <= rangeStart) {
      rangeStart = yearMin;
      rangeEnd = yearMax;
    }

    redrawMain();
  }

  // -------------------- HOVER HANDLERS --------------------
  function handleMove(event: any, x: d3.ScaleLinear<number, number>) {
    if (!years.length) return;

    const svg = d3.select(mainSvg);
    const [mx] = d3.pointer(event, svg.node() as any);
    const xVal = x.invert(mx);

    // find the nearest existing year within current range
    let bestYear = years[0];
    let bestDist = Infinity;
    for (const yr of years) {
      if (yr < rangeStart || yr > rangeEnd) continue;
      const d = Math.abs(yr - xVal);
      if (d < bestDist) {
        bestDist = d;
        bestYear = yr;
      }
    }

    const xPos = x(bestYear);
    svg
      .select<SVGLineElement>(".cursor-line")
      .attr("x1", xPos)
      .attr("x2", xPos)
      .style("opacity", 1);

    hoverYear = bestYear;

    const idx = years.indexOf(bestYear);
    if (idx === -1) {
      hoverValues = [];
      return;
    }

    const map = currentSeriesMap();
    const vals: HoverRow[] = [];

    if (sel1 && map.get(sel1)) {
      const v = map.get(sel1)![idx]?.[1] ?? 0;
      vals.push({ name: sel1, value: v, color: fieldColor(sel1) });
    }

    if (sel2 && map.get(sel2)) {
      const v = map.get(sel2)![idx]?.[1] ?? 0;
      vals.push({ name: sel2, value: v, color: fieldColor(sel2) });
    }

    if (showTotal) {
      const v = totalSeries()[idx]?.[1] ?? 0;
      vals.push({ name: "Total", value: v, color: "#111827", isTotal: true });
    }

    hoverValues = vals;
  }

  function handleLeave() {
    const svg = d3.select(mainSvg);
    svg.select(".cursor-line").style("opacity", 0);
    hoverYear = null;
    hoverValues = [];
  }
</script>

<div class="field-trends">
  <header class="ft-header">
    <h2 class="ft-title">
      How has the number of AI researchers changed over time and across fields?
    </h2>
  </header>

  <div class="ft-controls-row">
    <div class="metric-group">
      <span class="label">Metric</span>
      <div class="pill-toggle">
        <button
          type="button"
          class:selected={metric === "unique"}
          on:click={() => setMetric("unique")}
        >
          Unique
        </button>
        <button
          type="button"
          class:selected={metric === "authorships"}
          on:click={() => setMetric("authorships")}
        >
          Authorships
        </button>
      </div>
    </div>

    <label class="select-group">
      <span class="label">Field A</span>
      <select bind:value={sel1} on:change={onSel1Change}>
        {#if !allFields.length}
          <option value="">(loading...)</option>
        {:else}
          {#each allFields as f}
            <option value={f}>{f}</option>
          {/each}
        {/if}
      </select>
    </label>

    <label class="select-group">
      <span class="label">Field B</span>
      <select bind:value={sel2} on:change={onSel2Change}>
        <option value="">(none)</option>
        {#each allFields as f}
          <option value={f}>{f}</option>
        {/each}
      </select>
    </label>

    <label class="toggle-total">
      <input
        type="checkbox"
        bind:checked={showTotal}
        on:change={onToggleTotal}
      />
      <span>Show Total</span>
    </label>

    <div
      class="hover-card {hoverYear === null || !hoverValues.length
        ? 'hidden'
        : ''}"
    >
      {#if hoverYear !== null}
        <div class="hover-year">{hoverYear}</div>
        {#each hoverValues as v}
          <div class="hover-row">
            <span class="dot" style={`background:${v.color}`}></span>
            <span class="name">{v.name}</span>
            <span class="value">{fmt(v.value)}</span>
          </div>
        {/each}
      {/if}
    </div>
  </div>

  <div class="ft-chart-card" bind:this={wrap}>
    <svg class="ft-main-svg" bind:this={mainSvg}></svg>
    <svg class="ft-mini-svg" bind:this={miniSvg}></svg>
  </div>
</div>

<style>
  .field-trends {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    background: #ffffff;
    border-radius: 1.25rem;
    padding: 1.1rem 1.4rem 1.3rem;
    box-shadow: 0 10px 25px rgba(15, 23, 42, 0.06);
  }

  .ft-header {
    margin-bottom: 0.2rem;
  }

  .ft-title {
    font-size: 1.4rem;
    font-weight: 700;
    letter-spacing: 0.01em;
    margin: 0;
  }

  .ft-controls-row {
    position: relative;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.9rem;
    font-size: 0.85rem;
    margin-bottom: 0.35rem;
  }

  .metric-group {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .label {
    font-weight: 500;
    color: #4b5563;
  }

  .pill-toggle {
    display: inline-flex;
    padding: 0.1rem;
    border-radius: 999px;
    background: #f3f4f6;
  }

  .pill-toggle button {
    border: none;
    background: transparent;
    padding: 0.25rem 0.7rem;
    border-radius: 999px;
    font-size: 0.8rem;
    cursor: pointer;
    color: #4b5563;
  }

  .pill-toggle button.selected {
    background: #111827;
    color: #f9fafb;
  }

  .select-group {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }

  .select-group select {
    font-size: 0.8rem;
    padding: 0.15rem 0.45rem;
    border-radius: 0.4rem;
    border: 1px solid #d1d5db;
    background: #ffffff;
  }

  .toggle-total {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    cursor: pointer;
    font-size: 0.8rem;
    color: #374151;
  }

  .toggle-total input {
    accent-color: #111827;
  }

  .hover-card {
    position: absolute;
    right: 0.2rem;
    top: 0.05rem;
    background: #ffffff;
    border-radius: 0.75rem;
    padding: 0.4rem 0.7rem;
    box-shadow: 0 8px 18px rgba(15, 23, 42, 0.12);
    min-width: 110px;
  }

  .hover-card.hidden {
    opacity: 0;
    pointer-events: none;
  }

  .hover-year {
    font-weight: 600;
    font-size: 0.85rem;
    margin-bottom: 0.2rem;
  }

  .hover-row {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.78rem;
    line-height: 1.3;
  }

  .hover-row .name {
    flex: 1;
  }

  .hover-row .value {
    font-variant-numeric: tabular-nums;
    font-weight: 500;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 999px;
    display: inline-block;
  }

  .ft-chart-card {
    position: relative;
    width: 100%;
    border-radius: 0.9rem;
    border: 1px solid #e5e7eb;
    background: #f9fafb;
    padding: 0.3rem 0.4rem 0.5rem;
  }

  .ft-main-svg {
    width: 100%;
    height: 360px;
    display: block;
  }

  .ft-mini-svg {
    width: 100%;
    height: 80px;
    display: block;
    margin-top: 0.25rem;
  }

  .axis text {
    font-size: 10px;
    fill: #6b7280;
  }

  .axis path,
  .axis line {
    stroke: #9ca3af;
    stroke-width: 0.7;
  }

  .grid line {
    stroke: #e5e7eb;
    stroke-width: 0.6;
  }

  .grid path {
    display: none;
  }
</style>
