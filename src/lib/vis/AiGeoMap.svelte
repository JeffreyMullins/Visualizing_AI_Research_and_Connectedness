<script lang="ts">
  import { onMount } from "svelte";
  import * as d3 from "d3";
  import {
    loadWorks,
    yearsFrom,
    splitFieldString,
    type WorkRow,
  } from "$lib/vis/worksData";

  const WORLD_LOCAL = "/world.geojson";
  const WORLD_REMOTE =
    "https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world.geojson";

  let metric: "unique" | "authorships" = "authorships";
  let playing = false;
  let timer: any = null;

  let years: number[] = [];
  let yearMin = 1970;
  let yearMax = 2025;
  let year = 1970;

  let continentFilter:
    | "All"
    | "Africa"
    | "Americas"
    | "Asia"
    | "Europe"
    | "Oceania" = "All";

  let focusName: string | null = null;

  let rows: WorkRow[] = [];

  const perYearUniqueSet = new Map<string, Map<number, Set<string>>>();
  const perYearAuth = new Map<string, Map<number, number>>();
  const perYearField = new Map<string, Map<number, Map<string, number>>>();

  const seriesUniqueCum = new Map<string, Array<[number, number]>>();
  const seriesAuthCum = new Map<string, Array<[number, number]>>();

  let world: any = null;
  let features: any[] = [];
  let nameProp = "name";
  const country2Continent = new Map<string, string>();

  let wrap: HTMLDivElement;
  let svg: any, gMap: any, gLegend: any, gGraticule: any;
  let tooltipEl: HTMLDivElement;
  let sideEl: HTMLDivElement;

  let projection: d3.GeoProjection;
  let path: d3.GeoPath<any, any>;
  let zoom: d3.ZoomBehavior<Element, unknown>;

  let color = d3.scaleSequential(d3.interpolateYlOrRd).domain([0, 1]);

  const seriesFor = (c: string) =>
    metric === "unique"
      ? (seriesUniqueCum.get(c) ?? [])
      : (seriesAuthCum.get(c) ?? []);

  function valueFor(c: string, y: number) {
    const s = seriesFor(c);
    return s.find((d) => d[0] === y)?.[1] ?? 0;
  }

  const splitSemi = (s: string) =>
    s
      ? s
          .split(";")
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

  onMount(async () => {
    rows = await loadWorks();
    years = yearsFrom(rows);
    yearMin = years[0];
    yearMax = years.at(-1)!;
    year = yearMin;

    preprocess();
    await loadWorld();
    initMap();
    updateAll();

    window.addEventListener("resize", () => {
      initMap(true);
      updateAll();
    });
  });

  function preprocess() {
    perYearUniqueSet.clear();
    perYearAuth.clear();
    perYearField.clear();
    seriesUniqueCum.clear();
    seriesAuthCum.clear();

    for (const r of rows) {
      const ctry = r.country;
      if (!ctry) continue;

      const y = r.year;
      const aid = r.authorId;

      const ya =
        perYearAuth.get(ctry) ??
        (perYearAuth.set(ctry, new Map()), perYearAuth.get(ctry)!);
      ya.set(y, (ya.get(y) ?? 0) + 1);

      const ys =
        perYearUniqueSet.get(ctry) ??
        (perYearUniqueSet.set(ctry, new Map()), perYearUniqueSet.get(ctry)!);
      (ys.get(y) ?? ys.set(y, new Set()).get(y)!).add(aid);

      const yF =
        perYearField.get(ctry) ??
        (perYearField.set(ctry, new Map()), perYearField.get(ctry)!);
      const fy = yF.get(y) ?? (yF.set(y, new Map()), yF.get(y)!);
      for (const f of splitFieldString(r.field))
        fy.set(f, (fy.get(f) ?? 0) + 1);
    }

    const buildCum = (
      srcU: Map<string, Map<number, Set<string>>>,
      srcA: Map<string, Map<number, number>>,
      outU: Map<string, Array<[number, number]>>,
      outA: Map<string, Array<[number, number]>>,
    ) => {
      srcU.forEach((ymap, c) => {
        const seen = new Set<string>();
        const arr: [number, number][] = [];
        years.forEach((y) => {
          for (const v of ymap.get(y) ?? []) seen.add(v);
          arr.push([y, seen.size]);
        });
        outU.set(c, arr);
      });
      srcA.forEach((ymap, c) => {
        let run = 0;
        const arr: [number, number][] = [];
        years.forEach((y) => {
          run += ymap.get(y) ?? 0;
          arr.push([y, run]);
        });
        outA.set(c, arr);
      });
    };
    buildCum(perYearUniqueSet, perYearAuth, seriesUniqueCum, seriesAuthCum);
  }

  async function loadWorld() {
    async function tryFetch(url: string) {
      try {
        const r = await fetch(url);
        if (r.ok) return r.json();
      } catch {
        return null;
      }
    }
    world = (await tryFetch(WORLD_LOCAL)) ?? (await tryFetch(WORLD_REMOTE));
    if (!world || !world.features?.length)
      throw new Error("Failed to load world geojson");

    features = world.features;
    nameProp = features[0]?.properties?.name
      ? "name"
      : features[0]?.properties?.ADMIN
        ? "ADMIN"
        : Object.keys(features[0]?.properties ?? {})[0] || "name";

    const contKey =
      [
        "continent",
        "CONTINENT",
        "region_un",
        "REGION_UN",
        "subregion",
        "SUBREGION",
      ].find((k) => k in (features[0]?.properties ?? {})) || "continent";

    country2Continent.clear();
    for (const f of features) {
      const nm = f.properties[nameProp];
      const cont = f.properties[contKey] || "Other";
      country2Continent.set(nm, cont);
    }
  }

  function initMap(reinit = false) {
    if (!wrap) return;
    if (!features.length) return;

    const W = wrap.clientWidth || 1100;
    const H = Math.max(520, Math.round(W * 0.52));

    if (!svg || reinit) {
      wrap.innerHTML = "";
      svg = d3.select(wrap).append("svg").attr("width", W).attr("height", H);
      gGraticule = svg.append("g").attr("class", "grat");
      gMap = svg.append("g").attr("class", "map");
      gLegend = svg
        .append("g")
        .attr("class", "legend")
        .attr("transform", `translate(16,${H - 64})`);

      projection = d3.geoNaturalEarth1().fitSize([W, H], world as any);
      path = d3.geoPath(projection);

      const grat = d3.geoGraticule10();
      gGraticule
        .append("path")
        .attr("d", path(grat)!)
        .attr("fill", "none")
        .attr("stroke", "#e5e7eb");

      gMap
        .selectAll("path.country")
        .data(features)
        .join("path")
        .attr("class", "country")
        .attr("d", path as any)
        .attr("stroke", "#cbd5e1")
        .attr("stroke-width", 0.8)
        .style("cursor", "pointer")
        .on("mousemove", (ev: any, d: any) => {
          const nm = d.properties[nameProp];
          if (continentFilter !== "All") {
            const cont = country2Continent.get(nm);
            if (cont && !cont.startsWith(continentFilter)) {
              d3.select(tooltipEl).style("opacity", 0);
              return;
            }
          }
          const v = valueFor(nm, year);
          d3.select(tooltipEl)
            .style("opacity", 1)
            .style("left", `${ev.pageX + 12}px`)
            .style("top", `${ev.pageY + 12}px`)
            .html(
              `<div style="font-weight:800">${nm}</div>
               <div style="font-size:13px;color:#64748b">
                 Cumulative ${
                   metric === "unique" ? "unique authors" : "authorships"
                 } to ${year}: <b>${d3.format(",")(v)}</b>
               </div>`,
            );
        })
        .on("mouseleave", () => d3.select(tooltipEl).style("opacity", 0))
        .on("click", (_: any, d: any) => zoomTo(d))
        .on("dblclick", () => resetZoom());

      zoom = d3
        .zoom()
        .scaleExtent([1, 10])
        .translateExtent([
          [0, 0],
          [W, H],
        ])
        .on("zoom", (ev) => {
          gMap.attr("transform", ev.transform);
          gGraticule.attr("transform", ev.transform);
        });
      svg.call(zoom as any);
    } else {
      svg.attr("width", W).attr("height", H);
      projection.fitSize([W, H], world as any);
      gLegend.attr("transform", `translate(16,${H - 64})`);
      gMap.selectAll("path.country").attr("d", path as any);
      gGraticule.selectAll("path").attr("d", path(d3.geoGraticule10())!);
    }
  }

  function zoomTo(feat: any) {
    const [[x0, y0], [x1, y1]] = path.bounds(feat) as any;
    const W = wrap.clientWidth || 1100;
    const H = Math.max(520, Math.round(W * 0.52));
    const dx = x1 - x0,
      dy = y1 - y0;
    const cx = (x0 + x1) / 2,
      cy = (y0 + y1) / 2;
    const k = Math.max(1, Math.min(8, 0.9 / Math.max(dx / W, dy / H)));
    svg
      .transition()
      .duration(700)
      .call(
        zoom.transform as any,
        d3.zoomIdentity
          .translate(W / 2, H / 2)
          .scale(k)
          .translate(-cx, -cy),
      );
    focusName = feat.properties[nameProp];
    drawSidePanel();
  }

  function resetZoom() {
    const W = wrap.clientWidth || 1100;
    const H = Math.max(520, Math.round(W * 0.52));
    svg
      .transition()
      .duration(700)
      .call(zoom.transform as any, d3.zoomIdentity);
    focusName = null;
    drawSidePanel();
  }

  function updateAll() {
    // recompute color domain
    const vals = features.map((f) => {
      const nm = f.properties[nameProp];
      if (continentFilter !== "All") {
        const cont = country2Continent.get(nm);
        if (cont && !cont.startsWith(continentFilter)) return 0;
      }
      return valueFor(nm, year);
    });
    const maxV = d3.max(vals) || 1;
    color = d3.scaleSequential(d3.interpolateYlOrRd).domain([0, maxV]);

    gMap
      .selectAll("path.country")
      .attr("fill", (d: any) => {
        const nm = d.properties[nameProp];
        if (continentFilter !== "All") {
          const cont = country2Continent.get(nm);
          if (cont && !cont.startsWith(continentFilter)) return "#e5e7eb";
        }
        const v = valueFor(nm, year);
        return v ? color(v) : "#f1f5f9";
      })
      .attr("opacity", (d: any) =>
        focusName && d.properties[nameProp] !== focusName ? 0.7 : 1,
      )
      .attr("stroke-width", (d: any) =>
        focusName && d.properties[nameProp] === focusName ? 1.6 : 0.8,
      );

    drawLegend(maxV);
    drawSidePanel();
  }

  function drawLegend(maxV: number) {
    gLegend.selectAll("*").remove();
    const W = 260,
      H = 12;

    const defs = gLegend.append("defs");
    const grad = defs
      .append("linearGradient")
      .attr("id", "legendGrad")
      .attr("x1", "0%")
      .attr("x2", "100%");
    const stops = d3.range(0, 1.0001, 0.1);
    stops.forEach((t) =>
      grad
        .append("stop")
        .attr("offset", `${t * 100}%`)
        .attr(
          "stop-color",
          color(
            color.domain()[0] + t * (color.domain()[1] - color.domain()[0]),
          ),
        ),
    );

    gLegend
      .append("rect")
      .attr("x", 0)
      .attr("y", 0)
      .attr("width", W)
      .attr("height", H)
      .attr("fill", "url(#legendGrad)")
      .attr("rx", 4);

    const x = d3.scaleLinear().domain([0, maxV]).range([0, W]);
    gLegend
      .append("g")
      .attr("transform", `translate(0,${H})`)
      .call(d3.axisBottom(x).ticks(4).tickSize(4).tickPadding(6) as any)
      .selectAll("text")
      .style("font-size", "11px");

    gLegend
      .append("text")
      .attr("x", 0)
      .attr("y", -6)
      .style("font-size", "12px")
      .style("font-weight", 700)
      .text(
        `Cumulative ${
          metric === "unique" ? "unique authors" : "authorships"
        } to ${year}`,
      );
  }

  function drawSidePanel() {
    if (!sideEl) return;
    const el = d3.select(sideEl);
    el.html("");
    if (!focusName) return;

    const series = seriesFor(focusName);
    el.append("div").attr("class", "sideTitle").text(focusName);

    if (!series.length) {
      el.append("div").attr("class", "muted").text("No data");
      return;
    }

    const W = 300,
      H = 90,
      M = { l: 26, r: 14, t: 8, b: 18 };
    const iw = W - M.l - M.r,
      ih = H - M.t - M.b;

    const svgS = el.append("svg").attr("width", W).attr("height", H);
    const g = svgS.append("g").attr("transform", `translate(${M.l},${M.t})`);
    const x = d3.scaleLinear().domain([yearMin, yearMax]).range([0, iw]);
    const y = d3
      .scaleLinear()
      .domain([0, d3.max(series, (d) => d[1]) || 1])
      .range([ih, 0]);
    const line = d3
      .line<[number, number]>()
      .x((d) => x(d[0]))
      .y((d) => y(d[1]))
      .curve(d3.curveMonotoneX);
    g.append("path")
      .datum(series)
      .attr("d", line as any)
      .attr("fill", "none")
      .attr("stroke", "#0f172a")
      .attr("stroke-width", 2.2);
    g.append("g")
      .attr("transform", `translate(0,${ih})`)
      .call(d3.axisBottom(x).ticks(3).tickFormat(d3.format("d")) as any)
      .selectAll("text")
      .style("font-size", "10px");
    g.append("g")
      .call(d3.axisLeft(y).ticks(2) as any)
      .selectAll("text")
      .style("font-size", "10px");

    const yF = perYearField.get(focusName)?.get(year);
    if (yF && yF.size) {
      const top = Array.from(yF.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6);
      const list = el.append("div").attr("class", "fields");
      list.append("div").attr("class", "muted").text(`Top fields in ${year}`);
      top.forEach(([f, v]) =>
        list
          .append("div")
          .attr("class", "row")
          .html(`<span>${f}</span><span><b>${d3.format(",")(v)}</b></span>`),
      );
    }
  }

  function togglePlay() {
    playing = !playing;
    if (playing) {
      timer = setInterval(() => {
        year = year >= yearMax ? yearMin : year + 1;
        updateAll();
      }, 900);
    } else clearInterval(timer);
  }

  function onMetric(m: "unique" | "authorships") {
    if (metric !== m) {
      metric = m;
      updateAll();
    }
  }

  function onContChange(e: Event) {
    continentFilter = (e.target as HTMLSelectElement).value as any;
    updateAll();
  }
</script>

<h2>Where are AI researchers located around the world?</h2>

<div class="toolbar">
  <div class="group">
    <span
      class="pill {metric === 'unique' ? 'active' : ''}"
      on:click={() => onMetric("unique")}>Unique</span
    >
    <span
      class="pill {metric === 'authorships' ? 'active' : ''}"
      on:click={() => onMetric("authorships")}>Authorships</span
    >
  </div>

  <div class="group">
    <span class="pill {playing ? 'active' : ''}" on:click={togglePlay}>
      {playing ? "Pause" : "Play"}
    </span>
    <span class="muted">Year</span>
    <input
      type="range"
      min={yearMin}
      max={yearMax}
      bind:value={year}
      on:input={updateAll}
    />
    <span class="muted">{year}</span>
  </div>

  <div class="group">
    <span class="muted">Continent</span>
    <select on:change={onContChange} bind:value={continentFilter}>
      <option>All</option>
      <option>Africa</option>
      <option>Americas</option>
      <option>Asia</option>
      <option>Europe</option>
      <option>Oceania</option>
    </select>
  </div>

  <div class="group">
    <span
      class="pill"
      on:click={() => ((focusName = null), resetZoom(), updateAll())}
      >Reset view</span
    >
  </div>
</div>

<div class="layout">
  <div class="mapwrap" bind:this={wrap}></div>
  <div class="side" bind:this={sideEl}></div>
</div>

<div class="tooltip" bind:this={tooltipEl}></div>

<style>
  :root {
    --ink: #0f172a;
    --muted: #6b7280;
    --line: #e5e7eb;
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
    gap: 10px;
    align-items: center;
  }
  .muted {
    color: var(--muted);
  }
  .pill {
    padding: 6px 12px;
    border: 1px solid var(--line);
    border-radius: 999px;
    cursor: pointer;
    user-select: none;
  }
  .pill.active {
    background: #111;
    color: #fff;
    border-color: #111;
  }
  select {
    padding: 6px 10px;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: #fff;
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
  .mapwrap {
    border: 1px solid var(--line);
    border-radius: 16px;
    overflow: hidden;
    background: linear-gradient(180deg, #fff, #fafafa);
    min-height: 520px;
  }
  .side {
    border: 1px solid var(--line);
    border-radius: 16px;
    padding: 12px;
    min-height: 120px;
    background: #fff;
  }
  .sideTitle {
    font-weight: 900;
    font-size: 16px;
    margin-bottom: 6px;
  }
  .fields {
    margin-top: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .fields .row {
    display: flex;
    justify-content: space-between;
    font-size: 13px;
  }
  .fields .muted {
    color: #6b7280;
    margin-bottom: 4px;
  }
  .tooltip {
    position: absolute;
    pointer-events: none;
    opacity: 0;
    background: rgba(255, 255, 255, 0.98);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 10px 12px;
    box-shadow: 0 10px 24px rgba(0, 0, 0, 0.08);
    font-size: 13px;
  }
  svg text {
    fill: #0f172a;
    font-family:
      ui-sans-serif,
      system-ui,
      -apple-system,
      "Segoe UI",
      Roboto,
      Helvetica,
      Arial;
  }
  .grat path {
    pointer-events: none;
  }
</style>
