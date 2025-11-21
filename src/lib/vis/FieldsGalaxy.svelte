<script lang="ts">
  import { onMount } from "svelte";
  import * as d3 from "d3";
  import {
    loadWorks,
    yearsFrom,
    splitFieldString,
    shortAuthorId,
    type WorkRow,
  } from "$lib/vis/worksData";

  // state
  let metric: "unique" | "authorships" = "authorships";
  let years: number[] = [];
  let yearMin = 1970;
  let yearMax = 2025;
  let year = 1970;
  let topN = 12;
  let duration = 650;
  let playing = false;
  let timer: any = null;

  let selectedField: string | null = null;
  let topAuthors: Array<{ name: string; n: number }> = [];

  // dom
  let barsWrap: HTMLDivElement;
  let galaxyWrap: HTMLDivElement;
  let tooltipEl: HTMLDivElement;

  // svg
  let barsSvg: any, barsG: any, barsAxisX: any, barsAxisY: any;
  let galaxySvg: any, galaxyG: any;

  // data
  let rows: WorkRow[] = [];
  const seriesUnique = new Map<string, Array<[number, number]>>();
  const seriesAuth = new Map<string, Array<[number, number]>>();

  let allFields: string[] = [];
  let colorScale: d3.ScaleOrdinal<string, string>;
  const fieldColor = (f: string) =>
    colorScale ? (colorScale(f) as string) : "#555";

  const topOptions: number[] = Array.from({ length: 20 }, (_, i) => i + 1);

  onMount(async () => {
    rows = await loadWorks();
    years = yearsFrom(rows);
    yearMin = years[0];
    yearMax = years.at(-1)!;
    year = yearMax;

    aggregate();
    initBars();
    initGalaxy();
    updateAll();

    window.addEventListener("resize", () => {
      initBars(true);
      initGalaxy(true);
      updateAll();
    });
  });

  // ---------- aggregate by field/year ----------
  function aggregate() {
    seriesUnique.clear();
    seriesAuth.clear();

    const byFU = new Map<string, Map<number, Set<string>>>();
    const byFA = new Map<string, Map<number, number>>();

    for (const r of rows) {
      const fields = splitFieldString(r.field);
      if (!fields.length) continue;
      const y = r.year;
      const aid = r.authorId;

      for (const f of fields) {
        const u =
          byFU.get(f) ?? (byFU.set(f, new Map()), byFU.get(f)!);
        (u.get(y) ?? u.set(y, new Set()).get(y)!).add(aid);

        const a =
          byFA.get(f) ?? (byFA.set(f, new Map()), byFA.get(f)!);
        a.set(y, (a.get(y) ?? 0) + 1);
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

    allFields = Array.from(
      new Set<string>([...seriesUnique.keys(), ...seriesAuth.keys()]),
    ).sort();
    const palette = d3.quantize(
      d3.interpolateRainbow,
      Math.max(12, allFields.length),
    );
    colorScale = d3
      .scaleOrdinal<string, string>()
      .domain(allFields)
      .range(palette);
  }

  const currentSeries = () => (metric === "unique" ? seriesUnique : seriesAuth);

  function valueFor(field: string, y: number) {
    return (
      currentSeries()
        .get(field)
        ?.find((d) => d[0] === y)?.[1] ?? 0
    );
  }

  function topFieldsCumTo(y: number, N: number) {
    return Array.from(currentSeries().entries())
      .map(([f, s]) => ({
        field: f,
        value: s.reduce(
          (acc, [yr, v]) => acc + (yr <= y ? v || 0 : 0),
          0,
        ),
      }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, N);
  }

  function topFieldsAtYear(y: number, N: number) {
    return Array.from(currentSeries().entries())
      .map(([f, s]) => ({
        field: f,
        value: s.find((d) => d[0] === y)?.[1] ?? 0,
      }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, N);
  }

  function computeTopAuthors(field: string, yr: number) {
    const counts = new Map<string, number>();
    rows.forEach((r) => {
      if (r.year !== yr) return;
      if (!splitFieldString(r.field).includes(field)) return;
      const key = shortAuthorId(r.authorId);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    topAuthors = Array.from(counts.entries())
      .map(([name, n]) => ({ name, n }))
      .sort((a, b) => b.n - a.n)
      .slice(0, 10);
  }

  // ---------- Bars ----------
  function initBars(reinit = false) {
    if (!barsWrap) return;
    const W = barsWrap.clientWidth || 720,
      H = 560;
    if (!barsSvg || reinit) {
      barsWrap.innerHTML = "";
      barsSvg = d3
        .select(barsWrap)
        .append("svg")
        .attr("width", W)
        .attr("height", H);
      barsG = barsSvg.append("g").attr("transform", "translate(210,36)");
      barsAxisY = barsG.append("g").attr("class", "ax-y");
      barsAxisX = barsG.append("g").attr("class", "ax-x");
      barsSvg
        .append("text")
        .attr("class", "title")
        .attr("x", 210)
        .attr("y", 26)
        .attr("font-weight", 700)
        .style("font-size", "18px");
    } else {
      barsSvg.attr("width", W).attr("height", H);
    }
  }

  function updateBars() {
    if (!barsSvg) return;
    const W = barsWrap.clientWidth || 720,
      H = 560;
    const margin = { top: 36, right: 28, bottom: 40, left: 210 };
    const iw = W - margin.left - margin.right,
      ih = H - margin.top - margin.bottom;

    const data = topFieldsCumTo(year, topN);

    const x = d3
      .scaleLinear()
      .domain([0, (d3.max(data, (d) => d.value) || 1) * 1.15])
      .range([0, iw]);

    const y = d3
      .scaleBand()
      .domain(data.map((d) => d.field))
      .range([0, ih])
      .padding(0.12);

    barsSvg
      .select(".title")
      .text(
        `Top ${topN} fields — ${
          metric === "unique" ? "Unique authors" : "Authorships"
        } (cumulative up to ${year})`,
      );

    barsAxisY
      .attr("transform", `translate(0,0)`)
      .transition()
      .duration(duration)
      .call(d3.axisLeft(y).tickSize(0) as any)
      .selection()
      .selectAll("text")
      .style("font-size", "14px");

    barsAxisX
      .attr("transform", `translate(0,${ih})`)
      .transition()
      .duration(duration)
      .call(d3.axisBottom(x).ticks(6) as any)
      .selection()
      .selectAll("text")
      .style("font-size", "13px");

    const rowsSel = barsG
      .selectAll("g.row")
      .data(data, (d: any) => d.field);

    const enter = rowsSel
      .enter()
      .append("g")
      .attr("class", "row")
      .attr("transform", (d: any) => `translate(0,${y(d.field)!})`)
      .style("cursor", "pointer")
      .on("click", (_ev: any, d: any) => {
        selectedField = d.field;
        computeTopAuthors(d.field, year);
        updateGalaxy();
      });

    enter
      .append("rect")
      .attr("height", y.bandwidth())
      .attr("rx", 10)
      .attr("width", 0)
      .attr("fill", (d: any) => fieldColor(d.field))
      .transition()
      .duration(duration)
      .attr("width", (d: any) => x(d.value));

    enter
      .append("text")
      .attr("class", "val")
      .style("font-size", "14px")
      .attr("x", (d: any) => x(d.value) + 10)
      .attr("y", y.bandwidth() / 2 + 5)
      .text((d: any) => Math.round(d.value).toLocaleString());

    const merge = enter.merge(rowsSel as any);
    merge
      .transition()
      .duration(duration)
      .attr("transform", (d: any) => `translate(0,${y(d.field)!})`);
    merge
      .select("rect")
      .transition()
      .duration(duration)
      .attr("height", y.bandwidth())
      .attr("width", (d: any) => x(d.value));
    merge
      .select("text.val")
      .transition()
      .duration(duration)
      .attr("x", (d: any) => x(d.value) + 10)
      .text((d: any) => Math.round(d.value).toLocaleString());

    rowsSel.exit().transition().duration(250).style("opacity", 0).remove();
  }

  // ---------- Galaxy ----------
  function initGalaxy(reinit = false) {
    if (!galaxyWrap) return;
    const W = galaxyWrap.clientWidth || 720,
      H = 560;
    if (!galaxySvg || reinit) {
      galaxyWrap.innerHTML = "";
      galaxySvg = d3
        .select(galaxyWrap)
        .append("svg")
        .attr("width", W)
        .attr("height", H);
      galaxyG = galaxySvg
        .append("g")
        .attr("transform", "translate(20,20)");
      const defs = galaxySvg.append("defs");
      const glow = defs.append("filter").attr("id", "glow");
      glow.append("feGaussianBlur")
        .attr("stdDeviation", "4")
        .attr("result", "blur");
      glow.append("feMerge")
        .selectAll("feMergeNode")
        .data(["blur", "SourceGraphic"])
        .enter()
        .append("feMergeNode")
        .attr("in", (d) => d);
      galaxySvg
        .append("text")
        .attr("class", "title")
        .attr("x", 16)
        .attr("y", 26)
        .attr("font-weight", 700)
        .style("font-size", "18px");
    } else {
      galaxySvg.attr("width", W).attr("height", H);
    }
  }

  const acronym = (s: string) =>
    s
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .slice(0, 4)
      .toUpperCase();
  const safeId = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_");

  function updateGalaxy() {
    if (!galaxySvg) return;
    const W = galaxyWrap.clientWidth || 720,
      H = 560;
    const innerW = W - 40,
      innerH = H - 40;

    const items = topFieldsAtYear(year, topN);
    if (selectedField && !items.find((d) => d.field === selectedField)) {
      const v = valueFor(selectedField, year);
      if (v > 0) items.push({ field: selectedField, value: v });
    }

    galaxySvg
      .select(".title")
      .text(
        `Galaxy — ${
          metric === "unique" ? "Unique authors" : "Authorships"
        } in ${year} (Top ${topN})`,
      );

    const root = d3
      .hierarchy({
        children: items.map((d) => ({
          name: d.field,
          value: Math.max(1, d.value),
        })),
      } as any)
      .sum((d: any) => d.value);
    const pack = d3.pack().size([innerW, innerH]).padding(6);
    const nodes = pack(root).leaves() as any[];

    const sel = galaxyG
      .selectAll("g.node")
      .data(nodes, (d: any) => d.data.name);

    const enter = sel
      .enter()
      .append("g")
      .attr("class", "node")
      .attr("transform", (d: any) => `translate(${d.x},${d.y})`)
      .style("cursor", "pointer")
      .on("mousemove", (ev: any, d: any) => {
        const field = d.data.name;
        const val = Math.round(valueFor(field, year)).toLocaleString();
        showSpark(field, ev.pageX, ev.pageY, val, fieldColor(field));
      })
      .on("mouseleave", () => d3.select(tooltipEl).style("opacity", 0))
      .on("click", (_ev: any, d: any) => {
        selectedField = d.data.name;
        computeTopAuthors(selectedField, year);
        drawAuthorPanel();
        highlight();
      });

    enter
      .append("clipPath")
      .attr("id", (d: any) => `clip_${safeId(d.data.name)}`)
      .append("circle")
      .attr("r", (d: any) => d.r);

    enter
      .append("circle")
      .attr("r", 0)
      .attr("fill", (d: any) => fieldColor(d.data.name))
      .attr("opacity", 0.95)
      .transition()
      .duration(duration)
      .attr("r", (d: any) => d.r);

    enter
      .append("text")
      .attr("class", "label")
      .attr("clip-path", (d: any) => `url(#clip_${safeId(d.data.name)})`)
      .attr("text-anchor", "middle")
      .attr("dy", "0.35em")
      .style("pointer-events", "none")
      .style("font-weight", "700")
      .style("fill", "#fff")
      .style("font-size", "14px")
      .style("filter", "drop-shadow(0 1px 2px rgba(0,0,0,.35))")
      .text((d: any) => d.data.name);

    const merge = enter.merge(sel as any);
    merge
      .transition()
      .duration(duration)
      .attr("transform", (d: any) => `translate(${d.x},${d.y})`)
      .on("end", (_: any, i: number, nodesEls: any) => {
        const node = d3.select(nodesEls[i]);
        const d: any = node.datum() as any;
        node.select("clipPath circle").attr("r", d.r);
        const lbl = node.select("text.label");
        const max = d.r * 1.8;
        if (d.r < 18) lbl.text(acronym(d.data.name));
        else {
          lbl.text(d.data.name);
          let t = d.data.name;
          while (
            lbl.node().getComputedTextLength() > max &&
            t.length > 3
          ) {
            t = t.slice(0, t.length - 1);
            lbl.text(t + "…");
          }
        }
      });

    sel.exit().transition().duration(250).style("opacity", 0).remove();

    highlight();
    drawAuthorPanel();
  }

  function highlight() {
    const hasSel = !!selectedField;
    galaxyG
      .selectAll("g.node")
      .select("circle")
      .attr("filter", (d: any) =>
        hasSel && d.data.name === selectedField ? "url(#glow)" : null,
      )
      .attr("stroke", (d: any) =>
        d.data.name === selectedField ? "#111" : "#fff",
      )
      .attr("stroke-width", (d: any) =>
        d.data.name === selectedField ? 2.5 : 1,
      )
      .attr("opacity", (d: any) =>
        hasSel && d.data.name !== selectedField ? 0.25 : 0.95,
      );
  }

  function drawAuthorPanel() {
    d3.select(galaxyWrap).selectAll(".author-panel").remove();
    if (!selectedField || !topAuthors.length) return;
    const panel = d3
      .select(galaxyWrap)
      .append("div")
      .attr("class", "author-panel")
      .style("position", "absolute")
      .style("right", "12px")
      .style("top", "12px")
      .style("background", "#fff")
      .style("border", "1px solid #e5e7eb")
      .style("border-radius", "12px")
      .style("padding", "12px 14px")
      .style("width", "300px")
      .style("box-shadow", "0 10px 24px rgba(0,0,0,.08)")
      .style("font-size", "14px");
    panel
      .append("div")
      .style("font-weight", "700")
      .style("margin-bottom", "8px")
      .text(`Top authors — ${selectedField} (${year})`);
    topAuthors.forEach((a, i) => {
      panel
        .append("div")
        .style("display", "flex")
        .style("justify-content", "space-between")
        .html(`<span>${i + 1}. ${a.name}</span><span>${a.n}</span>`);
    });
  }

  function showSpark(
    field: string,
    pageX: number,
    pageY: number,
    labelValue: string,
    color: string,
  ) {
    const el = d3.select(tooltipEl);
    el.style("opacity", 1)
      .style("left", `${pageX + 12}px`)
      .style("top", `${pageY + 12}px`);
    el.html(`
      <div style="font-weight:700;margin-bottom:4px">${field}</div>
      <div style="font-size:13px;color:#4b5563;margin-bottom:4px">
        ${metric === "unique" ? "Unique authors" : "Authorships"}:
        <b>${labelValue}</b>
      </div>
      <svg width="240" height="70"></svg>
    `);
    const svg = el.select("svg");
    const data = currentSeries().get(field) ?? [];
    const x = d3
      .scaleLinear()
      .domain(d3.extent(data, (d) => d[0]) as [number, number])
      .range([8, 232]);
    const y = d3
      .scaleLinear()
      .domain([0, d3.max(data, (d) => d[1]) || 1])
      .range([60, 10]);
    const line = d3
      .line<[number, number]>()
      .x((d) => x(d[0]))
      .y((d) => y(d[1]));
    svg
      .append("path")
      .datum(data)
      .attr("fill", "none")
      .attr("stroke", color)
      .attr("stroke-width", 2)
      .attr("d", line as any);
    svg
      .append("line")
      .attr("x1", x(year))
      .attr("x2", x(year))
      .attr("y1", 10)
      .attr("y2", 60)
      .attr("stroke", "#999")
      .attr("stroke-dasharray", "3,3");
  }

  function togglePlay() {
    playing = !playing;
    if (playing)
      timer = setInterval(() => {
        year = year >= yearMax ? yearMin : year + 1;
        selectedField = null;
        updateAll();
      }, duration);
    else clearInterval(timer);
  }

  function updateAll() {
    updateBars();
    updateGalaxy();
  }
</script>

<h2>How many researchers are conducting AI research over time and across fields?</h2>

<div class="toolbar">
  <span><b>Top:</b></span>
  <select
    bind:value={topN}
    on:change={() => {
      topN = +topN;
      selectedField = null;
      updateAll();
    }}
  >
    {#each topOptions as n}
      <option value={n}>{n}</option>
    {/each}
  </select>

  <span
    class="pill {metric === 'unique' ? 'active' : ''}"
    on:click={() => {
      metric = "unique";
      selectedField = null;
      updateAll();
    }}>Unique</span
  >
  <span
    class="pill {metric === 'authorships' ? 'active' : ''}"
    on:click={() => {
      metric = "authorships";
      selectedField = null;
      updateAll();
    }}>Authorships</span
  >
</div>

<div class="two-col">
  <div class="panel" bind:this={barsWrap}></div>
  <div class="panel" bind:this={galaxyWrap}></div>
</div>

<div class="tooltip" bind:this={tooltipEl}></div>

<div
  style="display:flex; gap:12px; align-items:center; margin-top:10px; font-size:14px;"
>
  <span class="pill {playing ? 'active' : ''}" on:click={togglePlay}>
    {playing ? "Pause" : "Play"}
  </span>
  <span>Year:</span>
  <input
    type="range"
    min={yearMin}
    max={yearMax}
    bind:value={year}
    on:input={() => {
      selectedField = null;
      updateAll();
    }}
  />
  <span>{year}</span>
</div>

<style>
  :root {
    --text: #0f172a;
  }
  .two-col {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  @media (max-width: 1100px) {
    .two-col {
      grid-template-columns: 1fr;
    }
  }
  .panel {
    padding: 12px;
    border: 1px solid #e5e7eb;
    border-radius: 16px;
    background: #fff;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
    position: relative;
    min-height: 560px;
  }
  .toolbar {
    display: flex;
    gap: 10px;
    align-items: center;
    flex-wrap: wrap;
    margin-bottom: 8px;
    font-size: 14px;
  }
  .pill {
    padding: 6px 12px;
    border: 1px solid #ddd;
    border-radius: 999px;
    cursor: pointer;
    user-select: none;
  }
  .pill.active {
    background: #111;
    color: #fff;
    border-color: #111;
  }
  .tooltip {
    position: absolute;
    pointer-events: none;
    opacity: 0;
    background: rgba(255, 255, 255, 0.96);
    border: 1px solid #e5e7eb;
    border-radius: 12px;
    padding: 10px 12px;
    box-shadow: 0 10px 24px rgba(0, 0, 0, 0.08);
    font-size: 13px;
  }
  svg text {
    fill: var(--text);
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto,
      Helvetica, Arial;
  }
</style>
