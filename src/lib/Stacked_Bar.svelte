<script lang="ts">
  import type { Tsankey_authors } from "../types";
  import * as d3 from "d3";
  import { onMount } from "svelte";

  
  type Props = {
    author_data: Tsankey_authors[];
    progress?: number;
    width?: number;
    height?: number;
  };
  
  let { author_data=[], width = 1150, height = 500 }: Props = $props();
    console.log("Author data length:", author_data.length);

  const parsedData = $derived(author_data.filter(d => d.publication_order <= 50));
  const margin = { top: 20, right: 120, bottom: 60, left: 60 };
  
  let svgElement = $state<SVGSVGElement>();
  let selectedTopic = $state<string>("");

    // onMount(async () => {
    // try {
    //   const csvUrl = "./author_publication_sankey.csv";
    //   author_data = await d3.csv(csvUrl, (row) => {
    //     return {
    //       first_publication_topic: String(row.first_publication_topic),
    //       publication_order: Number(row.publication_order),
    //       topic_order: Number(row.topic_order),
    //       author_count: Number(row.author_count),

    //     };
    //   });
    //   console.log("Loaded author_data Data:", author_data);
    // } catch (error) {
    //   console.error("Error loading CSV:", error);
    // }
    // });
  
  // Get unique topics for dropdown
  const uniqueTopics = Array.from(new Set(parsedData.map(d => d.first_publication_topic))).sort();
  
  // Filter data based on selection
  const filteredData = $derived(
    selectedTopic ? parsedData.filter(d => d.first_publication_topic === selectedTopic) : parsedData
  );
  
   // Prepare data for stacking
  const chartData = $derived.by(() => {
    // Group by both publication_order and first_publication_topic when "All Topics" is selected
    const grouped = d3.group(filteredData, d => d.publication_order);
    
    const result = Array.from(grouped, ([pub_order, values]) => {
      const obj: any = { publication_order: pub_order };
      
      // For each unique combination of publication_order and topic_order, sum the author_counts
      const topicSums = d3.rollup(
        values,
        v => d3.sum(v, d => d.author_count),
        d => d.topic_order
      );
      
      let total = 0;
      topicSums.forEach((count, topic_order) => {
        obj[`topic_${topic_order}`] = count;
        total += count;
      });
      
      obj.total = total;
      return obj;
    }).sort((a, b) => a.publication_order - b.publication_order);
    
    return result;
  });
  
// Get all topic_order keys
  const topicKeys = $derived.by(() => {
    const keys = new Set<string>();
    filteredData.forEach(d => keys.add(`topic_${d.topic_order}`));
    return Array.from(keys).sort((a, b) => {
      const numA = parseInt(a.replace('topic_', ''));
      const numB = parseInt(b.replace('topic_', ''));
      return numA - numB;
    });
  });

  
  // Create stack generator and series
  const series = $derived.by(() => {
    const stack = d3.stack()
      .keys(topicKeys)
      .value((d: any, key) => {
        const val = d[key] || 0;
        return (val / d.total) * 100;
      });
    
    return stack(chartData);
  });
  
  // Scales
  const xScale = $derived(
    d3.scaleBand()
      .domain(chartData.map(d => d.publication_order))
      .range([margin.left, width - margin.right])
      .padding(0)
  );
  
  const yScale = $derived(
    d3.scaleLinear()
      .domain([0, 100])
      .range([height - margin.bottom, margin.top])
  );
  
  // Color scale
  const colorScale = $derived(
    d3.scaleOrdinal()
      .domain(topicKeys)
      .range(d3.schemeCategory10)
  );
</script>

<div style="padding: 20px;">
  <h3 style="margin-bottom: 10px;">
    The Different Number of Topics Published in by Authors Over Time
  </h3>
  
  <div style="margin-bottom: 20px;">
    <label for="topic-filter" style="margin-right: 10px; font-weight: bold;">
      Filter by First Publication Topic:
    </label>
    <select
      id="topic-filter"
      bind:value={selectedTopic}
      style="padding: 5px 10px; font-size: 14px; border-radius: 4px; border: 1px solid #ccc;"
    >
      <option value="">All Topics</option>
      {#each uniqueTopics as topic}
        <option value={topic}>{topic}</option>
      {/each}
    </select>
  </div>
  
  <svg {width} {height}>
    <!-- Y-axis -->
    <g transform="translate({margin.left}, 0)">
      {#each yScale.ticks(10) as tick}
        <g transform="translate(0, {yScale(tick)})">
          <line
            x1={0}
            x2={width - margin.left - margin.right}
            stroke="#e0e0e0"
            stroke-width={1}
          />
          <text
            x={-10}
            y={0}
            text-anchor="end"
            alignment-baseline="middle"
            font-size={12}
            fill="#666"
          >
            {tick}%
          </text>
        </g>
      {/each}
    </g>
    
    <!-- X-axis -->
    <g transform="translate(0, {height - margin.bottom})">
      <line
        x1={margin.left}
        x2={width - margin.right}
        stroke="#000"
        stroke-width={1}
      />
      {#each chartData as d}
        <text
          x={xScale(d.publication_order) + xScale.bandwidth() / 2}
          y={20}
          text-anchor="middle"
          font-size={12}
          fill="#666"
        >
          {d.publication_order}
        </text>
      {/each}
    </g>
    
    <!-- Stacked bars -->
    {#each series as s}
      <g>
        {#each s as d, j}
          <rect
            x={xScale(d.data.publication_order)}
            y={yScale(d[1])}
            width={xScale.bandwidth()}
            height={yScale(d[0]) - yScale(d[1])}
            fill={colorScale(s.key)}
            stroke="white"
            stroke-width={0.5}
          />
        {/each}
      </g>
    {/each}
    
    <!-- Y-axis label -->
    <text
      transform="translate({margin.left - 40}, {height / 2}) rotate(-90)"
      text-anchor="middle"
      font-size={14}
      font-weight="bold"
      fill="#333"
    >
      Percentage (%)
    </text>
    
    <!-- X-axis label -->
    <text
      x={width / 2}
      y={height - 10}
      text-anchor="middle"
      font-size={14}
      font-weight="bold"
      fill="#333"
    >
      Publication Number
    </text>
    
    <!-- Legend -->
    <g transform="translate({width - margin.right + 20}, {margin.top})">
      <text
        x={0}
        y={0}
        font-size={12}
        font-weight="bold"
        fill="#333"
      >
        Topic Order
      </text>
      {#each topicKeys as key, i}
        <g transform="translate(0, {i * 25 + 20})">
          <rect
            x={0}
            y={-10}
            width={15}
            height={15}
            fill={colorScale(key)}
          />
          <text
            x={20}
            y={0}
            font-size={12}
            alignment-baseline="middle"
            fill="#666"
          >
            {key.replace('topic_', 'Topic ')}
          </text>
        </g>
      {/each}
    </g>
  </svg>
</div>