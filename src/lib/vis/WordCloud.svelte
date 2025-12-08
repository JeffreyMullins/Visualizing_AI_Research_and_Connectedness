<script lang="ts">
  import { onMount } from "svelte";
  import * as d3 from "d3";

  type TopicRow = {
    pub_year: number;
    topic_display_name: string;
    topic_field_display_name: string;
    topic_domain_display_name: string;
    count: number;
  };

  let data: TopicRow[] = [];

  let svg: SVGSVGElement;
  let width = 1200;
  let height = 800;

  let selectedDomain = "";
  let selectedField = "";
  let selectedYear: number;

  let domains: string[] = [];
  let fields: string[] = [];
  let years: number[] = [];

  let domainFilteredData: TopicRow[] = [];
  let fieldFilteredData: TopicRow[] = [];
  let yearData: TopicRow[] = [];

  // color / size scales
  let baseColor: string;          
  let darknessScale: (c: number) => number;
  let fontSizeScale: (c: number) => number;

  // will hold d3-cloud after dynamic import
  let cloudLib: any;

  // Dynamically load d3-cloud only in the browser, then load data
  onMount(async () => {
    const mod = await import("d3-cloud");
    cloudLib = mod.default;
    await loadData();
  });

  // Load CSV files and match work_id to retrieve pub_year
  async function loadData() {
    const [topicsRaw, worksRaw] = await Promise.all([
      d3.csv("/topics_sampled.csv"),
      d3.csv("/works_sampled.csv")
    ]);

    // work id to publication year
    const yearById = new Map<string, number>();
    worksRaw.forEach((row: any) => {
      const id = row.id;
      const yearStr = row.pub_year;
      const year = yearStr ? +yearStr : NaN;
      if (id && !Number.isNaN(year)) {
        yearById.set(id, year);
      }
    });

    // Aggregate count for each (year, topic, field, domain)
    const countMap = new Map<string, TopicRow>();

    topicsRaw.forEach((row: any) => {
      const workId = row.work_id;
      const pubYear = yearById.get(workId);
      if (!pubYear) return;

      const topic = row.topic_display_name;
      const field = row.topic_field_display_name;
      const domain = row.topic_domain_display_name;
      if (!topic || !field || !domain) return;

      const key = `${pubYear}|${topic}|${field}|${domain}`;

      if (!countMap.has(key)) {
        countMap.set(key, {
          pub_year: pubYear,
          topic_display_name: topic,
          topic_field_display_name: field,
          topic_domain_display_name: domain,
          count: 0
        });
      }
      countMap.get(key)!.count += 1;
    });

    data = Array.from(countMap.values());

    // Initialize domain dropdown
    domains = Array.from(
      new Set(data.map(d => d.topic_domain_display_name))
    ).sort();
    if (domains.length && !selectedDomain) {
      selectedDomain = domains[0];
    }
  }

  //filter

  // Filter by domain
  $: domainFilteredData = selectedDomain
    ? data.filter(d => d.topic_domain_display_name === selectedDomain)
    : data;

  // Generate field options from domain-filtered data
  $: fields = Array.from(
    new Set(domainFilteredData.map(d => d.topic_field_display_name))
  ).sort();

  // If the current field is no longer available, reset it
  $: if (selectedField && !fields.includes(selectedField)) {
    selectedField = "";
  }

  // Filter by field
  $: fieldFilteredData = selectedField
    ? domainFilteredData.filter(
        d => d.topic_field_display_name === selectedField
      )
    : domainFilteredData;

  // Generate year list based on filtered data
  $: years = Array.from(
    new Set(fieldFilteredData.map(d => d.pub_year))
  ).sort((a, b) => a - b);

  // Ensure selectedYear is valid
  $: if (years.length && (!selectedYear || !years.includes(selectedYear))) {
    selectedYear = years[years.length - 1]; // default to latest year
  }

  // Extract top 30 topics for the selected year
  $: yearData = fieldFilteredData
    .filter(d => d.pub_year === selectedYear)
    .sort((a, b) => b.count - a.count)
    .slice(0, 30);

  // baseColor depends on selectedDomain
  $: {
    const palette = d3.schemeCategory10 as string[];

    if (!selectedDomain || !domains.length) {
      baseColor = "#555";
    } else {
      const idx = domains.indexOf(selectedDomain);
      const safeIndex = idx >= 0 ? idx : 0;
      baseColor = palette[safeIndex % palette.length];
    }
  }

  //  count to darkness
  $: darknessScale = (() => {
    if (!yearData.length) return (count: number) => 0.5;
    const counts = yearData.map(d => d.count);
    const minC = Math.min(...counts);
    const maxC = Math.max(...counts);
    // Lightness from 0.75 (light) to 0.25 (dark)
    return d3
      .scaleLinear<number, number>()
      .domain([minC, maxC])
      .range([0.75, 0.25]);
  })();

  // Font size (sqrt scale, cap at 50px)
  $: fontSizeScale = (() => {
    if (!yearData.length) return (count: number) => 16;
    const counts = yearData.map(d => d.count);
    return d3
      .scaleSqrt<number, number>()
      .domain([Math.min(...counts), Math.max(...counts)])
      .range([16, 50]);
  })();

  // Final color for each word: same hue per selectedDomain, lightness per count
  function getColor(count: number) {
    const c = d3.hsl(baseColor || "#555");
    c.l = darknessScale(count);
    return c.toString();
  }

  // Draw word cloud
  function drawWordCloud() {
    // guard: need svg, data, and d3-cloud loaded
    if (!svg || !yearData.length || !cloudLib) return;
    svg.innerHTML = ""; // clear existing content

    const layout = cloudLib()
      // shrink layout a bit so more likely to stay in bounds
      .size([width - 40, height - 40])
      .words(
        yearData.map(d => ({
          text: d.topic_display_name,
          size: fontSizeScale(d.count),
          domain: d.topic_domain_display_name,
          count: d.count
        }))
      )
      .padding(5)
      .rotate(0)
      .fontSize((d: any) => d.size)
      .on("end", draw);

    layout.start();

    function draw(words: any[]) {
      const svgEl = d3
        .select(svg)
        .attr("width", width)
        .attr("height", height)
        .style("overflow", "hidden")
        .append("g")
        .attr("transform", `translate(${width / 2},${height / 2})`);

      const text = svgEl
        .selectAll("text")
        .data(words)
        .enter()
        .append("text")
        .text(d => d.text)
        .attr("text-anchor", "middle")
        .attr("transform", d => `translate(${d.x},${d.y})rotate(${d.rotate})`)
        .style("fill", (d: any) => getColor(d.count))
        .style("font-size", (d: any) => `${d.size}px`)
        .style("transition", "all 0.2s")
        .style("cursor", "pointer");

      // Hover effect: enlarge, change color, show count
      text
        .on("mouseover", function (event, d: any) {
          const hoverSize = Math.min(d.size * 1.3, 60);
          d3.select(this)
            .style("fill", "#800020")
            .style("font-weight", "bold")
            .style("font-size", `${hoverSize}px`)
            .text(`${d.text} (${d.count})`);
        })
        .on("mouseout", function (event, d: any) {
          d3.select(this)
            .style("fill", getColor(d.count))
            .style("font-weight", "normal")
            .style("font-size", `${d.size}px`)
            .text(d.text);
        });
    }
  }

  // Redraw whenever year, domain, or field changes
  $: if (yearData.length && cloudLib && svg) {
    drawWordCloud();
  }
</script>

<style>
  .controls {
    margin-bottom: 10px;
    display: flex;
    gap: 12px;
    align-items: center;
    flex-wrap: wrap;
  }

  .controls > div label {
    margin-right: 4px;
  }

  svg {
    display: block;
  }
</style>

<div>
  <div class="controls">
    <div>
      <label for="domain-select">Domain:</label>
      <select bind:value={selectedDomain}>
        {#each domains as d}
          <option value={d}>{d}</option>
        {/each}
      </select>
    </div>

    <div>
      <label for="field-select">Field:</label>
      <select bind:value={selectedField}>
        <option value="">All fields</option>
        {#each fields as f}
          <option value={f}>{f}</option>
        {/each}
      </select>
    </div>

    <div>
      <label for="year-select">Year:</label>
      <select bind:value={selectedYear}>
        {#each years as y}
          <option value={y}>{y}</option>
        {/each}
      </select>
    </div>
  </div>

  <svg bind:this={svg}></svg>
</div>

<!-- 
LLMs including ChatGPT, and so on have been used for help with doing this task.
-->