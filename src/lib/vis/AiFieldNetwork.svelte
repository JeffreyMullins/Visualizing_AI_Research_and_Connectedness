<script lang="ts">
  import * as d3 from "d3";
  import { onMount } from "svelte";

  let networkContainer: HTMLDivElement;

  // Step 1: CSV Raw Data
  let topicsRaw = [];
  let topicsAI = [];

  // Case-insensitive AI detection
  const isAI = (d) => {
    const t1 = d.topic_display_name?.toLowerCase() || "";
    const t2 = d.topic_sub_field_display_name?.toLowerCase() || "";
    const t3 = d.topic_field_display_name?.toLowerCase() || "";
    return (
      t1.includes("artificial intelligence") ||
      t2.includes("artificial intelligence") ||
      t3.includes("artificial intelligence")
    );
  };

  // Step 2: Build nodes/links from subfields
  let nodes = [];
  let links = [];

  function buildNetwork(data) {
    const subfieldCount = d3.rollup(
      data,
      v => v.length,
      d => d.topic_sub_field_display_name
    );

    nodes = Array.from(subfieldCount, ([sub, count]) => ({
      id: sub,
      count
    }));

    const linkMap = new Map();
    const grouped = d3.group(data, d => d.work_id);

    for (const [workId, rows] of grouped) {
      const subs = Array.from(
        new Set(rows.map(r => r.topic_sub_field_display_name))
      );
      if (subs.length <= 1) continue;

      for (let i = 0; i < subs.length; i++) {
        for (let j = i + 1; j < subs.length; j++) {
          const key = subs[i] + "||" + subs[j];
          linkMap.set(key, (linkMap.get(key) || 0) + 1);
        }
      }
    }

    links = Array.from(linkMap, ([key, count]) => {
      const [source, target] = key.split("||");
      return { source, target, count };
    });
  }

  onMount(async () => {
    topicsRaw = await d3.csv("./topics_sampled.csv");

    const aiIDs = new Set(topicsRaw.filter(isAI).map(d => d.work_id));

    topicsAI = topicsRaw.filter(d => aiIDs.has(d.work_id));

    buildNetwork(topicsAI);

    drawNetwork();
  });

  // Step 3: Draw network
  function drawNetwork() {
    if (!networkContainer || nodes.length === 0) return;

    const width = networkContainer.clientWidth || 1200;
    const height = 700;

    const svg = d3
      .select(networkContainer)
      .append("svg")
      .attr("width", "100%")
      .attr("height", "100%")
      .attr("viewBox", `${-50} ${-50} ${width + 100} ${height + 100}`);

    // A group inside for zooming
    const g = svg.append("g");

    const color = d3.scaleOrdinal(d3.schemeTableau10);

    const sizeScale = d3.scaleSqrt()
      .domain(d3.extent(nodes, d => d.count))
      .range([5, 30]);

    const linkScale = d3.scaleLinear()
      .domain(d3.extent(links, d => d.count))
      .range([1, 6]);

    const simulation = d3
      .forceSimulation(nodes)
      .force("link", d3.forceLink(links).id(d => d.id).distance(100))
      .force("charge", d3.forceManyBody().strength(-450))
      .force("collision", d3.forceCollide().radius(d => sizeScale(d.count) + 6))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("labelForce", d3.forceCollide().radius(d => sizeScale(d.count) + 18));

    const link = g
      .append("g")
      .attr("stroke", "#ccc")
      .attr("stroke-opacity", 0.7)
      .selectAll("line")
      .data(links)
      .enter()
      .append("line")
      .attr("stroke-width", d => linkScale(d.count));

    const node = g
      .append("g")
      .selectAll("circle")
      .data(nodes)
      .enter()
      .append("circle")
      .attr("r", d => sizeScale(d.count))
      .attr("fill", d => color(d.id))
      .attr("stroke", "#000")
      .attr("stroke-width", 0.3)
      .call(
        d3.drag()
          .on("start", (event, d) => {
            if (!event.active) simulation.alphaTarget(0.2).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on("drag", (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on("end", (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          })
      );

    const label = g
      .append("g")
      .selectAll("text")
      .data(nodes)
      .enter()
      .append("text")
      .text(d => d.id)
      .attr("font-size", "10px")
      .attr("dx", 10)
      .attr("dy", 4);

    // ------------------------------------
    // ⭐⭐⭐ HOVER HIGHLIGHT ADDED HERE ⭐⭐⭐
    // ------------------------------------

    // 构建邻接表，用于判断相连节点
    const adjacency = {};
    links.forEach(l => {
      adjacency[l.source.id + "-" + l.target.id] = true;
      adjacency[l.target.id + "-" + l.source.id] = true;
    });

    function isConnected(a, b) {
      return adjacency[a.id + "-" + b.id] || a.id === b.id;
    }

    node
      .on("mouseover", (_, d) => {
        node.style("opacity", o => (isConnected(d, o) ? 1 : 0.1));
        link.style("opacity", o => (o.source.id === d.id || o.target.id === d.id ? 1 : 0.05));
        label.style("opacity", o => (isConnected(d, o) ? 1 : 0.1));
      })
      .on("mouseout", () => {
        node.style("opacity", 1);
        link.style("opacity", 0.7);
        label.style("opacity", 1);
      });

    // ------------------------------------

    simulation.on("tick", () => {
      link
        .attr("x1", d => d.source.x)
        .attr("y1", d => d.source.y)
        .attr("x2", d => d.target.x)
        .attr("y2", d => d.target.y);

      node.attr("cx", d => d.x).attr("cy", d => d.y);
      label.attr("x", d => d.x).attr("y", d => d.y);
    });

    // zoom/pan
    svg.call(
      d3.zoom().scaleExtent([0.2, 4]).on("zoom", (event) => {
        g.attr("transform", event.transform);
      })
    );
  }
</script>

<div bind:this={networkContainer} class="network-container"></div>

<style>
.network-container {
  width: 100%;
  height: 650px;
  background: #fff;
  border-radius: 16px;
  border: 1px solid #e5e7eb;
  overflow: hidden;
}
</style>