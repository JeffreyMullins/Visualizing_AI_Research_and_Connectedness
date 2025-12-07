<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { browser } from "$app/environment";
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
  let yearMin = 0;
  let yearMax = 0;
  let rangeStart = 0;
  let rangeEnd = 0;

  // per-field series: Map<FieldName, Array<[year, value]>>
  const seriesUnique = new Map<string, Array<[number, number]>>();
  const seriesAuth = new Map<string, Array<[number, number]>>();
  let totalUnique: Array<[number, number]> = [];
  let totalAuth: Array<[number, number]> = [];
  let allFields: string[] = [];

  let sel1 = "";
  let sel2 = "";

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
    if (!browser) return;

    rows = await loadWorks();
    if (!rows.length) {
      console.warn("FieldTrends: loadWorks() returned no rows.");
      return;
    }

    years = yearsFrom(rows).sort((a, b) => a - b);
    yearMin = years[0];
    yearMax = years[years.length - 1];

    aggregate();

    rangeStart = yearMin;
    rangeEnd = yearMax;

    if (wrap) width = wrap.clientWidth || 900;

    redrawBoth();

    window.addEventListener("resize", handleResize);
  });

  onDestroy(() => {
    if (!browser) return;
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
        // unique
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

    if (!sel1 && allFields.length > 0) sel1 = allFields[0];
    if (!sel2) sel2 = "";
  }

  // -------------------- HELPERS --------------------
  function currentSeriesMap() {
    return metric === "unique" ? seriesUnique : seriesAuth;
  }

  function totalSeries() {
    return metric === "unique" ? totalUnique : totalAuth;
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

  function onToggleTotal(e: Event) {
    const input = e.target as HTMLInputElement;
    showTotal = input.checked;
    redrawMain();
  }

  function valueForYear(series: [number, number][], y: number): number {
    const found = series.find(([yr]) => yr === y);
    return found ? found[1] : 0;
  }

  // -------------------- MAIN CHART --------------------
  function drawMainChart() {
    const svg = d3.select(mainSvg);
    svg.selectAll("*").remove();

    const w = width;
    const h = mainHeight;

    svg.attr("viewBox", `0 0 ${w} ${h}`);

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

    if (showTotal) {
      lines.push({
        name: "Total",
        data: slice(totalSeries()),
        color: "#111827",
        isTotal: true,
      });
    }

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

    const allVals = lines.flatMap((s) => s.data.map((d) => d[1]));
    const yMax = ((d3.max(allVals) ?? 1) || 1) * 1.05;

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

    const lineGen = d3
      .line<[number, number]>()
      .x(([year]) => xScale(year))
      .y(([, v]) => yScale(v))
      .curve(d3.curveMonotoneX);

    function drawAnimatedLine(
      data: [number, number][],
      color: string,
      dashed: boolean,
      isTotal: boolean,
    ) {
      const path = svg
        .append("path")
        .datum(data)
        .attr("fill", "none")
        .attr("stroke", color)
        .attr("stroke-width", isTotal ? 2.6 : 2.2)
        .attr("stroke-linecap", "round")
        .attr("stroke-linejoin", "round")
        .attr("stroke-dasharray", dashed ? "4 3" : null)
        .attr("d", lineGen);

      const node = path.node() as SVGPathElement | null;
      if (!node) return;
      const len = node.getTotalLength();
      path
        .attr("stroke-dasharray", `${len} ${len}`)
        .attr("stroke-dashoffset", len)
        .transition()
        .duration(900)
        .ease(d3.easeCubicOut)
        .attr("stroke-dashoffset", 0);
    }

    for (const s of lines) {
      drawAnimatedLine(s.data, s.color, !!s.dashed, !!s.isTotal);
    }

    // y-axis label
    svg
      .append("text")
      .attr("transform", "rotate(-90)")
      .attr("x", -h / 2)
      .attr("y", 18)
      .attr("text-anchor", "middle")
      .attr("font-size", 10)
      .text(metric === "unique" ? "Unique researchers" : "Total authorships");

    // shadow filter for note
    const defs = svg.append("defs");
    const shadow = defs
      .append("filter")
      .attr("id", "hoverNoteShadow")
      .attr("height", "150%");
    shadow
      .append("feDropShadow")
      .attr("dx", "0")
      .attr("dy", "2")
      .attr("stdDeviation", "3")
      .attr("flood-color", "#0f172a")
      .attr("flood-opacity", "0.16");

    // vertical cursor line
    svg
      .append("line")
      .attr("class", "cursor-line")
      .attr("y1", margin.top)
      .attr("y2", h - margin.bottom)
      .attr("stroke", "#9ca3af")
      .attr("stroke-width", 1.2)
      .attr("stroke-dasharray", "3,3")
      .style("opacity", 0);

    // hover note group
    const noteGroup = svg
      .append("g")
      .attr("class", "hover-note")
      .attr("filter", "url(#hoverNoteShadow)")
      .style("opacity", 0);

    const noteBg = noteGroup
      .append("rect")
      .attr("rx", 12)
      .attr("ry", 12)
      .attr("fill", "#ffffff")
      .attr("stroke", "#e5e7eb")
      .attr("stroke-width", 1);

    const yearText = noteGroup
      .append("text")
      .attr("class", "hn-year")
      .attr("font-size", 13)
      .attr("font-weight", 600)
      .attr("fill", "#111827");

    const rowsGroup = noteGroup.append("g").attr("class", "hn-rows");

    // pointer overlay
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
      .append("rect")
      .attr("x", marginMini.left)
      .attr("y", marginMini.top)
      .attr("width", w - marginMini.left - marginMini.right)
      .attr("height", h - marginMini.top - marginMini.bottom)
      .attr("fill", "#e5e7eb");

    svg
      .append("path")
      .datum(data)
      .attr("fill", "rgba(37,99,235,0.25)")
      .attr("stroke", "rgba(37,99,235,0.9)")
      .attr("stroke-width", 1.1)
      .attr("d", area);

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

    const initialSel: [number, number] = [
      xMiniScale(rangeStart),
      xMiniScale(rangeEnd),
    ];
    gBrush.call((brush as any).move, initialSel);

    gBrush
      .selectAll<SVGRectElement, unknown>(".selection")
      .attr("fill", "rgba(59,130,246,0.45)")
      .attr("stroke", "#1d4ed8")
      .attr("stroke-width", 1.2)
      .attr("rx", 4);
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

  // -------------------- HOVER --------------------
  function handleMove(event: any, x: d3.ScaleLinear<number, number>) {
    if (!years.length) return;

    const svg = d3.select(mainSvg);
    const [mx] = d3.pointer(event, svg.node() as any);
    const xVal = x.invert(mx);

    // nearest year within range
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

    // vertical line
    svg
      .select<SVGLineElement>(".cursor-line")
      .attr("x1", xPos)
      .attr("x2", xPos)
      .style("opacity", 1);

    const map = currentSeriesMap();

    // Build rows for note
    const rows: { label: string; value: number; color: string }[] = [];

    if (showTotal) {
      rows.push({
        label: "Total",
        value: valueForYear(totalSeries(), bestYear),
        color: "#111827",
      });
    }

    if (sel1 && map.get(sel1)) {
      rows.push({
        label: sel1,
        value: valueForYear(map.get(sel1)!, bestYear),
        color: fieldColor(sel1),
      });
    }

    if (sel2 && map.get(sel2)) {
      rows.push({
        label: sel2,
        value: valueForYear(map.get(sel2)!, bestYear),
        color: fieldColor(sel2),
      });
    }

    const noteGroup = svg.select<SVGGElement>(".hover-note");
    const noteBg = noteGroup.select<SVGRectElement>("rect");
    const yearText = noteGroup.select<SVGTextElement>("text.hn-year");
    const rowsGroup = noteGroup.select<SVGGElement>("g.hn-rows");

    yearText.text(String(bestYear)).attr("x", 16).attr("y", 18);

    rowsGroup.selectAll("*").remove();

    const lineHeight = 18;
    rows.forEach((r, i) => {
      const g = rowsGroup
        .append("g")
        .attr("transform", `translate(16,${30 + i * lineHeight})`);

      g.append("circle")
        .attr("r", 4)
        .attr("cx", 0)
        .attr("cy", -6)
        .attr("fill", r.color);

      g.append("text")
        .attr("x", 10)
        .attr("y", 0)
        .attr("font-size", 12)
        .attr("fill", "#111827")
        .text(`${r.label}: ${fmt(r.value)}`);
    });

    // compute background size
    const yearBox = yearText.node()!.getBBox();
    const rowsBox = rowsGroup.node()!.getBBox();
    const paddingX = 14;
    const paddingY = 10;

    const bgWidth = Math.max(
      yearBox.width + paddingX * 2,
      rowsBox.width + paddingX * 2,
    );
    const bgHeight = rows.length
      ? rowsBox.y + rowsBox.height - yearBox.y + paddingY * 1.4
      : yearBox.height + paddingY * 2;

    noteBg
      .attr("width", bgWidth)
      .attr("height", bgHeight)
      .attr("x", 0)
      .attr("y", 0);

    // position note
    let noteX = xPos + 10;
    const maxX = width - margin.right - bgWidth - 4;
    if (noteX > maxX) noteX = maxX;
    if (noteX < margin.left) noteX = margin.left;

    const noteY = margin.top + 4;

    noteGroup
      .attr("transform", `translate(${noteX},${noteY})`)
      .style("opacity", 1);
  }

  function handleLeave() {
    const svg = d3.select(mainSvg);
    svg.select(".cursor-line").style("opacity", 0);
    svg.select(".hover-note").style("opacity", 0);
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
      <div class="metric-pills">
        <button
          type="button"
          class:active={metric === "unique"}
          title="Counts distinct people who have authored at least one AI paper—each person is counted once, no matter how many papers they wrote."
          on:click={() => setMetric("unique")}
        >
          Unique Researchers
        </button>
        <button
          type="button"
          class:active={metric === "authorships"}
          title="Counts every author–paper combination on AI papers—people are counted multiple times if they appear on multiple papers."
          on:click={() => setMetric("authorships")}
        >
          Total Authorships
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
      <input type="checkbox" checked={showTotal} on:change={onToggleTotal} />
      <span>Show Total</span>
    </label>
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
    gap: 0.55rem;
  }

  .label {
    font-weight: 500;
    color: #4b5563;
  }

  .metric-pills {
    display: inline-flex;
    gap: 0.4rem;
    padding: 0.12rem;
    border-radius: 999px;
    background: #e5e7eb;
  }

  .metric-pills button {
    border: 1px solid transparent;
    background: #f9fafb;
    padding: 0.32rem 0.95rem;
    border-radius: 999px;
    font-size: 0.8rem;
    font-weight: 500;
    cursor: pointer;
    color: #111827;
    transition:
      background 0.15s ease,
      color 0.15s ease,
      box-shadow 0.15s ease,
      transform 0.1s ease;
    white-space: nowrap;
  }

  .metric-pills button:hover {
    transform: translateY(-0.5px);
    box-shadow: 0 3px 6px rgba(15, 23, 42, 0.16);
  }

  .metric-pills button.active {
    background: #111827;
    color: #f9fafb;
    box-shadow: 0 6px 14px rgba(15, 23, 42, 0.35);
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
