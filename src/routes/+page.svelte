<script lang="ts">
  import * as d3 from "d3";
  import { onMount } from "svelte";
  import type { TTopic } from "../../types";
  import Bar_topics from "$lib/Bar_topics.svelte";
  import FieldsGalaxy from "$lib/vis/FieldsGalaxy.svelte";
  import FieldTrends from "$lib/vis/FieldTrends.svelte";
  import AiGeoMap from "$lib/vis/AiGeoMap.svelte";
  import CoauthorNetwork from "$lib/vis/CoauthorNetwork.svelte";

  // --- Topic data ---
  let topics: TTopic[] = [];
  let uniqueTopics = 0;

  async function loadCsv() {
    try {
      const csvUrl = "./topics.csv";
      topics = await d3.csv(csvUrl, (row) => {
        return {
          work_id: String(row.work_id),
          topic_id: String(row.topic_id),
          topic_display_name: String(row.topic_display_name),
          topic_score: Number(row.topic_score),
          topic_sub_field_display_name: String(
            row.topic_sub_field_display_name,
          ),
          topic_field_display_name: String(row.topic_field_display_name),
          topic_domain_display_name: String(row.topic_domain_display_name),
        };
      });

      uniqueTopics = new Set(topics.map((d) => d.topic_display_name)).size;
      console.log("Loaded CSV Data:", topics);
    } catch (error) {
      console.error("Error loading CSV:", error);
    }
  }

  onMount(loadCsv);

  // --- Network Data & Visualization ---
  let networkContainer: HTMLDivElement;
  let fieldCount = 0;

  onMount(async () => {
    const nodes: any[] = await d3.json("/field_nodes.json");
    const links: any[] = await d3.json("/field_links.json");
    if (!nodes || !links) return;

    const width = networkContainer?.clientWidth || 1200;
    const height = 600;

    const uniqueFields = [...new Set(nodes.map((d: any) => d.id))];
    fieldCount = uniqueFields.length;

    const colorScale = d3
      .scaleSequential()
      .domain([0, uniqueFields.length])
      .interpolator(d3.interpolateRainbow);

    const sizeScale = d3
      .scaleSqrt()
      .domain(d3.extent(nodes, (d: any) => d.count) as [number, number])
      .range([6, 28]);

    const linkWidthScale = d3
      .scaleLinear()
      .domain(d3.extent(links, (d: any) => d.count) as [number, number])
      .range([1, 6]);

    const svg = d3
      .select(networkContainer)
      .append("svg")
      .attr("viewBox", `0 0 ${width} ${height}`)
      .attr("width", "100%")
      .attr("height", "100%");

    // Legend
    const legend = svg
      .append("g")
      .attr("transform", `translate(${width - 260}, 20)`);

    uniqueFields.forEach((field, i) => {
      const g = legend.append("g").attr("transform", `translate(0, ${i * 24})`);

      g.append("circle").attr("r", 7).attr("fill", colorScale(i));

      g.append("text")
        .attr("x", 16)
        .attr("y", 5)
        .text(field)
        .attr("font-size", "12px");
    });

    const simulation = d3
      .forceSimulation(nodes)
      .force(
        "link",
        d3
          .forceLink(links)
          .id((d: any) => d.id)
          .distance(140),
      )
      .force("charge", d3.forceManyBody().strength(-260))
      .force("center", d3.forceCenter(width / 2, height / 2));

    const link = svg
      .append("g")
      .attr("stroke", "#d4d4d8")
      .attr("stroke-opacity", 0.8)
      .selectAll("line")
      .data(links)
      .enter()
      .append("line")
      .attr("stroke-width", (d: any) => linkWidthScale(d.count));

    const node = svg
      .append("g")
      .selectAll("circle")
      .data(nodes)
      .enter()
      .append("circle")
      .attr("r", (d: any) => sizeScale(d.count))
      .attr("fill", (d: any) => colorScale(uniqueFields.indexOf(d.id)))
      .call(
        d3
          .drag()
          .on("start", (event, d: any) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on("drag", (event, d: any) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on("end", (event, d: any) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          }),
      );

    const label = svg
      .append("g")
      .selectAll("text")
      .data(nodes)
      .enter()
      .append("text")
      .text((d: any) => d.id)
      .attr("font-size", "11px")
      .attr("fill", "#374151")
      .attr("dx", 8)
      .attr("dy", 4);

    simulation.on("tick", () => {
      link
        .attr("x1", (d: any) => d.source.x)
        .attr("y1", (d: any) => d.source.y)
        .attr("x2", (d: any) => d.target.x)
        .attr("y2", (d: any) => d.target.y);

      node.attr("cx", (d: any) => d.x).attr("cy", (d: any) => d.y);

      label.attr("x", (d: any) => d.x).attr("y", (d: any) => d.y);
    });
  });
</script>

<main class="page">
  <header class="hero">
    <div class="hero-text">
      <p class="eyebrow">Final Project · Data Visualization with Svelte & D3</p>
      <h1>
        Visualizing Scientific Publications Connections and AI Research
        Expansion
      </h1>
      <p class="subtitle">
        An interactive overview of how AI-related publications are distributed
        across topics and how academic fields connect through co-authorship.
      </p>
    </div>

    <div class="hero-metrics">
      <div class="metric">
        <span class="metric-label">Publications</span>
        <span class="metric-value">
          {topics.length === 0 ? "…" : topics.length.toLocaleString()}
        </span>
      </div>
      <div class="metric">
        <span class="metric-label">Topics</span>
        <span class="metric-value">
          {topics.length === 0 ? "…" : uniqueTopics}
        </span>
      </div>
      <div class="metric">
        <span class="metric-label">Fields in network</span>
        <span class="metric-value">
          {fieldCount === 0 ? "…" : fieldCount}
        </span>
      </div>
    </div>
  </header>

  <section class="layout-grid">
    <!-- Jeff: Bar chart -->
    <section class="panel">
      <div class="panel-header">
        <h2>Topic Distribution</h2>
        <p>
          Each bar represents how many publications are associated with a given
          topic. Taller bars indicate areas where AI-related research is
          especially active.
        </p>
      </div>
      <div class="panel-body chart-body">
        <Bar_topics {topics} />
      </div>
    </section>

    <!-- Wenwen: Network -->
    <section class="panel">
      <div class="panel-header">
        <h2>Field Co-occurrence Network</h2>
        <p>
          Nodes show academic fields; links connect fields that co-occur in the
          same works. Larger nodes and thicker links represent stronger research
          activity and collaboration.
        </p>
      </div>

      <div class="panel-body">
        <div bind:this={networkContainer} class="network-container"></div>
        <p class="panel-footnote">
          Tip: drag nodes to explore clusters; the layout will re-balance
          automatically.
        </p>
      </div>
    </section>
  </section>
  <!-- Mingyang: Author -->
  <section class="panel">
    <FieldsGalaxy />
  </section>

  <section class="panel">
    <AiGeoMap />
  </section>
  <section class="panel">
    <CoauthorNetwork />
  </section>

  <footer class="footer">
    <p>
      Built with Svelte, D3.js, and CSV/JSON data on AI-related scientific
      publications.
    </p>
  </footer>
</main>

<style>
  :global(body) {
    margin: 0;
    font-family:
      system-ui,
      -apple-system,
      BlinkMacSystemFont,
      "Segoe UI",
      sans-serif;
    background: radial-gradient(circle at top left, #0f172a, #020617 60%);
    color: #e5e7eb;
  }

  .page {
    max-width: 1200px;
    margin: 0 auto;
    padding: 32px 20px 40px;
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  .hero {
    background: linear-gradient(135deg, #111827, #1f2937);
    border-radius: 24px;
    padding: 24px 28px;
    box-shadow: 0 18px 45px rgba(0, 0, 0, 0.45);
    display: flex;
    flex-wrap: wrap;
    gap: 24px;
    align-items: flex-end;
  }

  .hero-text {
    flex: 1 1 260px;
    min-width: 0;
  }

  .eyebrow {
    font-size: 0.8rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: #9ca3af;
    margin-bottom: 4px;
  }

  .hero h1 {
    font-size: clamp(1.7rem, 2.4vw, 2.2rem);
    line-height: 1.2;
    margin: 0 0 8px;
    color: #f9fafb;
  }

  .subtitle {
    margin: 0;
    font-size: 0.95rem;
    color: #d1d5db;
    max-width: 40rem;
  }

  .hero-metrics {
    display: flex;
    gap: 16px;
    flex-wrap: wrap;
  }

  .metric {
    background: rgba(15, 23, 42, 0.9);
    border-radius: 16px;
    padding: 10px 14px;
    min-width: 120px;
    border: 1px solid rgba(148, 163, 184, 0.4);
  }

  .metric-label {
    display: block;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: #9ca3af;
    margin-bottom: 2px;
  }

  .metric-value {
    font-size: 1.1rem;
    font-weight: 600;
    color: #e5e7eb;
  }

  .layout-grid {
    display: flex;
    flex-direction: column; /* stack panels vertically */
    gap: 24px; /* space between top and bottom card */
  }

  .panel {
    background: #f9fafb;
    color: #111827;
    border-radius: 20px;
    padding: 20px 20px 18px;
    box-shadow: 0 14px 32px rgba(15, 23, 42, 0.18);
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .panel-header h2 {
    margin: 0 0 4px;
    font-size: 1.15rem;
  }

  .panel-header p {
    margin: 0;
    font-size: 0.9rem;
    color: #4b5563;
  }

  .panel-body {
    margin-top: 4px;
  }

  .chart-body {
    /* helps avoid the chart touching the edges */
    padding-top: 6px;
  }

  .network-container {
    width: 100%;
    min-height: 520px;
    border-radius: 16px;
    background: #ffffff;
    border: 1px solid #e5e7eb;
    overflow: hidden;
  }

  .panel-footnote {
    margin-top: 8px;
    font-size: 0.8rem;
    color: #6b7280;
  }

  .footer {
    font-size: 0.8rem;
    color: #9ca3af;
    text-align: right;
    margin-top: 8px;
  }
</style>
