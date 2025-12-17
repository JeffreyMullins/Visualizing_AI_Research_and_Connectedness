<script lang="ts">
  import type { Tsankey_authors } from "../types";
  import * as d3 from "d3";
  import { sankey, sankeyLinkHorizontal } from "d3-sankey";
  import { onMount } from "svelte";

  // define the props of the component
  type Props = {
    author_sankey: Tsankey_authors[];
    progress?: number;
    width?: number;
    height?: number;
  };

  let { author_sankey, progress = 100, width = 1850, height = 400 }: Props = $props();
  
  let svgElement: SVGSVGElement;
  let selectedTopic = $state('all');
  
  const margin = { top: 20, right: 200, bottom: 20, left: 200 };

   // Filter out rows where publication_order > 20
  const dataFiltered = $derived(author_sankey.filter(d => d.publication_order <= 10));

  // Get unique topics for dropdown
  const uniqueTopics = $derived(['all', ...Array.from(new Set(dataFiltered.map(d => d.first_publication_topic)))]);

  // Filter data based on selection
  const filteredData = $derived(
    selectedTopic === 'all' 
      ? dataFiltered 
      : dataFiltered.filter(d => d.first_publication_topic === selectedTopic)
  );

  function drawSankey() {
    if (!svgElement || filteredData.length === 0) return;

    // Clear previous content
    d3.select(svgElement).selectAll('*').remove();

    // Transform data into Sankey format
    const nodes: any[] = [];
    const links: any[] = [];
    const nodeMap = new Map();

    // Create nodes for each publication_order + topic_order combination
    filteredData.forEach(d => {
      const sourceKey = `pub_${d.publication_order}_topic_${d.topic_order}`;
      const targetKey = d.publication_order < 4 
        ? `pub_${d.publication_order + 1}_topic_${d.topic_order}` 
        : null;

      if (!nodeMap.has(sourceKey)) {
        nodeMap.set(sourceKey, {
          id: sourceKey,
          name: `${d.topic_order} topic${d.topic_order > 1 ? 's' : ''}`,
          publication_order: d.publication_order,
          topic_order: d.topic_order
        });
      }

      if (targetKey && !nodeMap.has(targetKey)) {
        nodeMap.set(targetKey, {
          id: targetKey,
          name: `${d.topic_order} topic${d.topic_order > 1 ? 's' : ''}`,
          publication_order: d.publication_order + 1,
          topic_order: d.topic_order
        });
      }
    });

    nodes.push(...Array.from(nodeMap.values()));

    // Create links
    filteredData.forEach(d => {
      if (d.publication_order < 4) {
        const sourceKey = `pub_${d.publication_order}_topic_${d.topic_order}`;
        const targetKey = `pub_${d.publication_order + 1}_topic_${d.topic_order}`;
        
        const sourceIndex = nodes.findIndex(n => n.id === sourceKey);
        const targetIndex = nodes.findIndex(n => n.id === targetKey);
        
        if (sourceIndex !== -1 && targetIndex !== -1) {
          links.push({
            source: sourceIndex,
            target: targetIndex,
            value: d.author_count
          });
        }
      }
    });

    // Create Sankey generator
    const sankeyGenerator = sankey()
      .nodeWidth(15)
      .nodePadding(10)
      .extent([[margin.left, margin.top], [width - margin.right, height - margin.bottom]]);

    const graph = sankeyGenerator({
      nodes: nodes.map(d => ({ ...d })),
      links: links.map(d => ({ ...d }))
    });

    // Create SVG
    const svg = d3.select(svgElement)
      .attr('width', width)
      .attr('height', height);

    // Color scale
    const color = d3.scaleOrdinal(d3.schemeCategory10);

    // Draw links
    svg.append('g')
      .selectAll('path')
      .data(graph.links)
      .join('path')
      .attr('d', sankeyLinkHorizontal())
      .attr('stroke', (d: any) => color(d.source.topic_order))
      .attr('stroke-width', (d: any) => Math.max(1, d.width))
      .attr('fill', 'none')
      .attr('opacity', 0.3)
      .append('title')
      .text((d: any) => `${d.source.name} → ${d.target.name}\n${d.value.toLocaleString()} authors`);

    // Draw nodes
    svg.append('g')
      .selectAll('rect')
      .data(graph.nodes)
      .join('rect')
      .attr('x', (d: any) => d.x0)
      .attr('y', (d: any) => d.y0)
      .attr('height', (d: any) => d.y1 - d.y0)
      .attr('width', (d: any) => d.x1 - d.x0)
      .attr('fill', (d: any) => color(d.topic_order))
      .attr('stroke', '#000')
      .attr('opacity', 0.8)
      .append('title')
      .text((d: any) => `${d.name}\nPublication ${d.publication_order}\n${d.value?.toLocaleString() || 0} authors`);

    // Add labels
    svg.append('g')
      .selectAll('text')
      .data(graph.nodes)
      .join('text')
      .attr('x', (d: any) => d.x0 < width / 2 ? d.x1 + 6 : d.x0 - 6)
      .attr('y', (d: any) => (d.y1 + d.y0) / 2)
      .attr('dy', '0.35em')
      .attr('text-anchor', (d: any) => d.x0 < width / 2 ? 'start' : 'end')
      .attr('font-size', '12px')
      .text((d: any) => d.name);

    // Add publication order labels at top
    const pubOrders = Array.from(new Set(nodes.map(n => n.publication_order))).sort();
    svg.append('g')
      .selectAll('text.pub-label')
      .data(pubOrders)
      .join('text')
      .attr('class', 'pub-label')
      .attr('x', (pub: number) => {
        const nodesAtPub = graph.nodes.filter((n: any) => n.publication_order === pub);
        return d3.mean(nodesAtPub, (n: any) => (n.x0 + n.x1) / 2) || 0;
      })
      .attr('y', margin.top - 5)
      .attr('text-anchor', 'middle')
      .attr('font-size', '14px')
      .attr('font-weight', 'bold')
      .text((d: number) => `Publication ${d}`);
  }

  // Redraw when filtered data changes
  $effect(() => {
    if (filteredData) {
      drawSankey();
    }
  });

  onMount(() => {
    drawSankey();
  });
</script>

<div class="p-6">
  <h3 class="text-xl font-semibold mb-4">
    The Different Number of Topics Published in by Authors Over Time
  </h3>
  
  <div class="mb-4">
    <label class="mr-2 font-medium">Filter by First Publication Topic:</label>
    <select 
      bind:value={selectedTopic}
      class="px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      {#each uniqueTopics as topic}
        <option value={topic}>
          {topic === 'all' ? 'All Topics' : topic}
        </option>
      {/each}
    </select>
  </div>

  <svg bind:this={svgElement}></svg>
</div>

<style>
  .p-6 {
    padding: 1.5rem;
  }
  
  .text-xl {
    font-size: 1.25rem;
    line-height: 1.75rem;
  }
  
  .font-semibold {
    font-weight: 600;
  }
  
  .mb-4 {
    margin-bottom: 1rem;
  }
  
  .mr-2 {
    margin-right: 0.5rem;
  }
  
  .font-medium {
    font-weight: 500;
  }
  
  .px-3 {
    padding-left: 0.75rem;
    padding-right: 0.75rem;
  }
  
  .py-2 {
    padding-top: 0.5rem;
    padding-bottom: 0.5rem;
  }
  
  .border {
    border-width: 1px;
  }
  
  .border-gray-300 {
    border-color: #d1d5db;
  }
  
  .rounded-md {
    border-radius: 0.375rem;
  }
  
  .shadow-sm {
    box-shadow: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  }
  
  select:focus {
    outline: 2px solid transparent;
    outline-offset: 2px;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.5);
  }
</style>