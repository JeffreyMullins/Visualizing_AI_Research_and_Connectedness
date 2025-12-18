<script lang="ts">
  import { onMount } from "svelte";
  import * as d3 from "d3";

  // CSV paths
  export let topicsFilePath = "./topics_sampled.csv";
  export let worksFilePath = "./works_sampled.csv";

  // Chart size
  export let width = 1500;
  export let height = 500;

  let svg: SVGSVGElement;
  let data: any[] = [];
  let colorScale: d3.ScaleOrdinal<string, string>;
  let tooltip: HTMLDivElement | null = null;

  // raw topics + year mapping for recomputing on dropdown change
  let rawTopics: any[] = [];
  let yearById: Map<string, number> | null = null;

  // "domain" group by topic_domain_display_name
  // "field"  group by topic_field_display_name
  let groupingMode: "domain" | "field" = "domain";

  onMount(async () => {
    // Load topics and works CSVs
    const [topicsRaw, worksRaw] = await Promise.all([
      d3.csv(topicsFilePath),
      d3.csv(worksFilePath)
    ]);

    rawTopics = topicsRaw;

    // work id to publication year
    yearById = new Map<string, number>();
    worksRaw.forEach((row: any) => {
      const id = row.id as string;
      const yearStr = row.pub_year as string;
      const year = yearStr ? +yearStr : NaN;
      if (id && !Number.isNaN(year)) {
        yearById!.set(id, year);
      }
    });
  });

  // Recompute aggregated data whenever rawTopics or groupingMode changes
  $: if (rawTopics.length && yearById && groupingMode) {
    updateAggregatedData();
  }

  function updateAggregatedData() {
    if (!rawTopics.length || !yearById) return;

    // Choose field to group by
    const keyField =
      groupingMode === "domain"
        ? "topic_domain_display_name"
        : "topic_field_display_name";

    // Collect series (domains or fields), yearMap, and total counts per series
    const seriesSet = new Set<string>();
    const yearMap = new Map<number, Record<string, number>>();
    const seriesTotals = new Map<string, number>();

    rawTopics.forEach((row: any) => {
      const workId = row.work_id as string;
      const series = row[keyField] as string;
      const year = yearById!.get(workId);

      if (!year || !series) return;

      seriesSet.add(series);

      if (!yearMap.has(year)) {
        yearMap.set(year, {});
      }
      const obj = yearMap.get(year)!;
      if (obj[series] == null) obj[series] = 0;
      obj[series] += 1;

      const prevTotal = seriesTotals.get(series) ?? 0;
      seriesTotals.set(series, prevTotal + 1);
    });

    // Determine which series to show: top 15 by total count (or fewer if < 15)
    let seriesList = Array.from(seriesSet).sort();
    if (seriesList.length > 15) {
      seriesList = Array.from(seriesTotals.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([s]) => s);
    }

    // Build data array: one row per year, only with top series, missing values filled with 0
    data = Array.from(yearMap, ([year, countsObj]) => {
      const row: any = { year };
      seriesList.forEach(s => {
        row[s] = countsObj[s] ?? 0;
      });
      return row;
    }).sort((a, b) => a.year - b.year);

    // Keep only the most recent N years on the x-axis
    const maxYearsToShow = 40; // you can change to 30 / 20 etc.
    let years = data.map(d => d.year).sort((a, b) => a - b);
    if (years.length > maxYearsToShow) {
      const cutoffYear = years[years.length - maxYearsToShow];
      data = data.filter(d => d.year >= cutoffYear);
    }

    // Color scale for (top) series
    colorScale = d3.scaleOrdinal<string, string>()
      .domain(seriesList)
      .range(d3.schemeTableau10.concat(d3.schemeSet3).slice(0, seriesList.length));

    drawArea();
  }

  function drawArea() {
    if (!svg || !data.length) return;
    svg.innerHTML = "";

    // Extract series keys from the first data row (all keys except "year")
    const domainKeys = Object.keys(data[0]).filter(k => k !== "year");

    const stack = d3.stack().keys(domainKeys)(data);

    // Margins and inner chart size (extra space on the right for legend)
    const margin = { top: 30, right: 300, bottom: 60, left: 70 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const svgEl = d3.select(svg)
      .attr("width", width)
      .attr("height", height)
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const years = data.map(d => d.year);

    const xScale = d3.scaleLinear()
      .domain(d3.extent(data, d => d.year) as [number, number])
      .range([0, innerWidth]);

    const yScale = d3.scaleLinear()
      .domain([
        0,
        d3.max(data, d => domainKeys.reduce((sum, k) => sum + d[k], 0)) as number
      ])
      .nice()
      .range([innerHeight, 0]);

    const area = d3.area<any>()
      .x(d => xScale(d.data.year))
      .y0(d => yScale(d[0]))
      .y1(d => yScale(d[1]));

    const paths = svgEl.selectAll("path")
      .data(stack)
      .enter()
      .append("path")
      .attr("d", area)
      .style("fill", d => colorScale(d.key))
      .style("stroke", "white")
      .style("stroke-width", 1)
      .style("opacity", 1);

    // Create tooltip once
    if (!tooltip) {
      tooltip = d3.select("body").append("div")
        .style("position", "absolute")
        .style("background", "rgba(255,255,255,0.95)")
        .style("border", "1px solid #ccc")
        .style("padding", "6px 10px")
        .style("border-radius", "4px")
        .style("pointer-events", "none")
        .style("font-size", "13px")
        .style("opacity", 0)
        .style("color", "#111")   
        .node() as HTMLDivElement;
    }

    // Hover interactions
    paths
      .on("mouseover", function (event, d: any) {
        d3.selectAll("path").style("opacity", 0.3);
        d3.select(this).style("opacity", 1);
        d3.select(tooltip).style("opacity", 1);
      })
      .on("mousemove", function (event, d: any) {
        const [mx] = d3.pointer(event);
        const year = Math.round(xScale.invert(mx));
        const yearData = data.find(y => y.year === year);
        let count = 0;
        let total = 0;
        if (yearData) {
          count = yearData[d.key] ?? 0;
          total = domainKeys.reduce((sum, k) => sum + yearData[k], 0);
        }
        d3.select(tooltip)
          .html(`
            <strong>${d.key}</strong><br>
            Year: ${year}<br>
            Count: ${count}<br>
            Total (all series): ${total}
          `)
          .style("left", (event.pageX + 12) + "px")
          .style("top", (event.pageY - 28) + "px");
      })
      .on("mouseout", function () {
        d3.selectAll("path").style("opacity", 1);
        d3.select(tooltip).style("opacity", 0);
      });

    // X axis (only years that appear in data)
    const xAxis = svgEl.append("g")
      .attr("transform", `translate(0,${innerHeight})`)
      .call(
        d3.axisBottom(xScale)
          .tickValues(years)
          .tickFormat(d3.format("d"))
      );

    // Rotate tick labels
    xAxis.selectAll("text")
      .attr("transform", "rotate(45)")   // or 60°, if you prefer
      .style("text-anchor", "start")
      .attr("dx", "0.5em")
      .attr("dy", "0.3em");

    // Y axis (counts)
    svgEl.append("g")
      .call(d3.axisLeft(yScale));

    // Legend on the right (top 15 series)
    const legend = svgEl.selectAll(".legend")
      .data(domainKeys)
      .enter()
      .append("g")
      .attr("class", "legend")
      .attr("transform", (d, i) => `translate(${innerWidth + 20},${i * 30})`);

    legend.append("rect")
      .attr("x", 0)
      .attr("y", 0)
      .attr("width", 16)
      .attr("height", 16)
      .style("fill", d => colorScale(d));

    legend.append("text")
      .attr("x", 22)
      .attr("y", 12)
      .text(d => d)
      .style("font-size", "14px")
      .style("alignment-baseline", "middle");
  }
</script>

<div style="margin-bottom: 8px;">
  <label for="groupby">Group by: </label>
  <select bind:value={groupingMode}>
    <option value="domain">Domain</option>
    <option value="field">Field</option>
  </select>
</div>

<svg bind:this={svg}></svg>

<!-- 
LLMs including ChatGPT, and so on have been used for help with doing this task.
-->