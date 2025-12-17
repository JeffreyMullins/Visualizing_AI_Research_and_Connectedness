<script lang="ts">
  import type { Tbubble_chart } from "../types";
  import * as d3 from "d3";
  import { onMount } from "svelte";
  
  // define the props of the line component
  type Props = {
    bubble_chart_data: Tbubble_chart[];
    progress?: number;
    width?: number;
    height?: number;
  };
  
  let { bubble_chart_data, width = 1100, height: height_ = 500 }: Props = $props();
  console.log("Bubble chart data length:", bubble_chart_data.length);

  let body_height = height_ + 10;
  let svgElement: SVGSVGElement;
  let selectedYear = $state<number | null>(null);
  let years = $state<number[]>([]);
  let isPlaying = $state(false);
  let animationInterval: number | null = null;
  
  const margin = { top: 20, right: 150, bottom: 60, left: 80 };
  
  // Get unique years from data
  $effect(() => {
    if (bubble_chart_data.length > 0) {
      const uniqueYears = [...new Set(bubble_chart_data.map(d => d.pub_year))].sort((a, b) => a - b);
      years = uniqueYears;
      if (uniqueYears.length > 0) {
        selectedYear = uniqueYears[0];
      }
    }
  });

  // Filter data based on selected year
  let filteredData = $derived(
    selectedYear !== null ? bubble_chart_data.filter(d => d.pub_year === selectedYear) : []
  );

  // Draw the bubble chart with smooth transitions
  $effect(() => {
    if (!svgElement || !bubble_chart_data.length || !filteredData.length) return;

    const svg = d3.select(svgElement);

    // Create scales
    const xScale = d3.scaleLinear()
      .domain([0, d3.max(bubble_chart_data, d => d.num_publications) * 1.1 || 100])
      .range([margin.left, width - margin.right]);

    const yScale = d3.scaleLinear()
      .domain([0, 1])
      .range([height_ - margin.bottom, margin.top]);

    const radiusScale = d3.scaleSqrt()
      .domain([0, d3.max(bubble_chart_data, d => d.authors) || 100])
      .range([3, 40]);

    const colorScale = d3.scaleOrdinal(d3.schemeCategory10)
      .domain([...new Set(bubble_chart_data.map(d => d.topic_field_display_name))]);

    // Only create static elements once
    if (svg.selectAll('g.axes').empty()) {
      // Add axes group
      const axesGroup = svg.append('g').attr('class', 'axes');
      
      axesGroup.append('g')
        .attr('class', 'x-axis')
        .attr('transform', `translate(0,${height_ - margin.bottom})`);

      axesGroup.append('g')
        .attr('class', 'y-axis')
        .attr('transform', `translate(${margin.left},0)`);

      // Add axis labels
      axesGroup.append('text')
        .attr('class', 'x-label')
        .attr('x', width / 2)
        .attr('y', height_ - 10)
        .attr('text-anchor', 'middle')
        .style('font-size', '14px')
        .style('font-weight', 'bold')
        .text('Number of Publications');

      axesGroup.append('text')
        .attr('class', 'y-label')
        .attr('transform', 'rotate(-90)')
        .attr('x', -height_ / 2)
        .attr('y', 20)
        .attr('text-anchor', 'middle')
        .style('font-size', '14px')
        .style('font-weight', 'bold')
        .text('Cross Collaboration Metric');

      // Create bubbles group
      svg.append('g').attr('class', 'bubbles');

      // Create legend group
      svg.append('g')
        .attr('class', 'legend')
        .attr('transform', `translate(${width - margin.right + 20}, ${margin.top})`);
    }

    // Update axes
    const xAxis = d3.axisBottom(xScale).ticks(10);
    const yAxis = d3.axisLeft(yScale).ticks(10);

    svg.select('.x-axis')
      .transition()
      .duration(500)
      .call(xAxis)
      .style('font-size', '12px');

    svg.select('.y-axis')
      .transition()
      .duration(500)
      .call(yAxis)
      .style('font-size', '12px');

    // Create tooltip once
    let tooltip = d3.select('body').select('.bubble-tooltip-d3');
    if (tooltip.empty()) {
      tooltip = d3.select('body').append('div')
        .attr('class', 'bubble-tooltip-d3')
        .style('position', 'absolute')
        .style('background', 'white')
        .style('padding', '10px')
        .style('border', '1px solid #ccc')
        .style('border-radius', '4px')
        .style('pointer-events', 'none')
        .style('opacity', 0)
        .style('font-size', '12px')
        .style('box-shadow', '0 2px 4px rgba(0,0,0,0.1)')
        .style('z-index', '1000')
        .style('color', '#000000');
    }

    // Update bubbles with smooth transitions
    const bubbles = svg.select('.bubbles')
      .selectAll('circle.bubble')
      .data(filteredData, d => d.topic_field_display_name);

    // Enter: new bubbles
    const bubblesEnter = bubbles.enter()
      .append('circle')
      .attr('class', 'bubble')
      .attr('cx', d => xScale(d.num_publications))
      .attr('cy', d => yScale(d.cross_collaboration_metric))
      .attr('r', 0)
      .attr('fill', d => colorScale(d.topic_field_display_name))
      .attr('opacity', 0)
      .attr('stroke', '#333')
      .attr('stroke-width', 1)
      .style('cursor', 'pointer');

    // Update: existing bubbles
    bubbles.merge(bubblesEnter)
      .on('mouseover', function(event, d) {
        d3.select(this)
          .transition()
          .duration(200)
          .attr('opacity', 1)
          .attr('stroke-width', 2);
        
        tooltip
          .style('opacity', 1)
          .html(`
            <strong>${d.topic_field_display_name}</strong><br/>
            Publications: ${d.num_publications}<br/>
            Collaboration: ${d.cross_collaboration_metric.toFixed(3)}<br/>
            Authors: ${d.authors}
          `)
          .style('left', (event.pageX + 10) + 'px')
          .style('top', (event.pageY - 10) + 'px');
      })
      .on('mouseout', function() {
        d3.select(this)
          .transition()
          .duration(200)
          .attr('opacity', 0.7)
          .attr('stroke-width', 1);
        
        tooltip.style('opacity', 0);
      })
      .transition()
      .duration(400)
      .attr('cx', d => xScale(d.num_publications))
      .attr('cy', d => yScale(d.cross_collaboration_metric))
      .attr('r', d => radiusScale(d.authors))
      .attr('fill', d => colorScale(d.topic_field_display_name))
      .attr('opacity', 0.7);

    // Exit: removed bubbles
    bubbles.exit()
      .transition()
      .duration(800)
      .attr('r', 0)
      .attr('opacity', 0)
      .remove();

    // Update legend
    const uniqueFields = [...new Set(filteredData.map(d => d.topic_field_display_name))];
    
    const legend = svg.select('.legend');
    legend.selectAll('*').remove();

    uniqueFields.forEach((field, i) => {
      const legendRow = legend.append('g')
        .attr('transform', `translate(0, ${i * 20})`);

      legendRow.append('circle')
        .attr('r', 6)
        .attr('fill', colorScale(field))
        .attr('opacity', 0.7);

      legendRow.append('text')
        .attr('x', 12)
        .attr('y', 4)
        .style('font-size', '11px')
        .text(field.length > 25 ? field.substring(0, 25) + '...' : field);
    });

    // Cleanup function
    return () => {
      d3.select('body').selectAll('.bubble-tooltip-d3').remove();
    };
  });

  // Animation control functions
  function toggleAnimation() {
    if (isPlaying) {
      stopAnimation();
    } else {
      startAnimation();
    }
  }

  function startAnimation() {
    if (years.length === 0 || selectedYear === null) return;
    
    isPlaying = true;
    
    animationInterval = window.setInterval(() => {
      const currentIndex = years.indexOf(selectedYear!);
      if (currentIndex < years.length - 1) {
        selectedYear = years[currentIndex + 1];
      } else {
        // Loop back to start
        selectedYear = years[0];
      }
    }, 500); // Change year every 1.5 seconds
  }

  function stopAnimation() {
    isPlaying = false;
    if (animationInterval !== null) {
      window.clearInterval(animationInterval);
      animationInterval = null;
    }
  }

  // Cleanup animation on component unmount
  $effect(() => {
    return () => {
      stopAnimation();
    };
  });


  onMount(async () => {
    console.log("Bubble chart data length:", bubble_chart_data.length);
  });

</script>

<div class="bubble-chart-container">
  <h3>
    The World of Academic Publication Across Different Fields
  </h3>
  
  {#if years.length > 0 && selectedYear !== null}
    <div class="slider-container">
      <button 
        class="play-button"
        onclick={toggleAnimation}
        aria-label={isPlaying ? "Pause animation" : "Play animation"}
      >
        {#if isPlaying}
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="6" y="4" width="4" height="16"></rect>
            <rect x="14" y="4" width="4" height="16"></rect>
          </svg>
        {:else}
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polygon points="5 3 19 12 5 21 5 3"></polygon>
          </svg>
        {/if}
      </button>
      <label>
        <strong>Year: {selectedYear}</strong>
      </label>
      <input
        type="range"
        min={Math.min(...years)}
        max={Math.max(...years)}
        step={years.length > 1 ? years[1] - years[0] : 1}
        bind:value={selectedYear}
        oninput={stopAnimation}
        class="year-slider"
      />
    </div>
  {:else}
    <div class="slider-container">
      <p>Loading data...</p>
    </div>
  {/if}

  <div class="chart-wrapper">
    <svg
      bind:this={svgElement}
      {width}
      height={body_height}
    />
  </div>

  <div class="chart-note">
    <p>Bubble size represents number of authors. Hover over bubbles for details.</p>
  </div>
</div>

<style>
  .bubble-chart-container {
    width: 100%;
    padding: 1.5rem;
  }

  h3 {
    font-size: 1.5rem;
    font-weight: bold;
    margin-bottom: 1.5rem;
    text-align: center;
  }

  .slider-container {
    display: flex;
    align-items: center;
    gap: 1rem;
    max-width: 60rem;
    margin: 0 auto 1.5rem;
  }

  .slider-container label {
    font-size: 1.125rem;
    min-width: fit-content;
  }

  .play-button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 3rem;
    height: 3rem;
    background: #3b82f6;
    border: none;
    border-radius: 50%;
    cursor: pointer;
    color: white;
    transition: background-color 0.2s;
    flex-shrink: 0;
  }

  .play-button:hover {
    background: #2563eb;
  }

  .play-button:active {
    background: #1d4ed8;
  }

  .year-slider {
    flex: 1;
    height: 0.5rem;
    background: #e5e7eb;
    border-radius: 0.5rem;
    appearance: none;
    cursor: pointer;
  }

  .year-slider::-webkit-slider-thumb {
    appearance: none;
    width: 1.25rem;
    height: 1.25rem;
    background: #3b82f6;
    border-radius: 50%;
    cursor: pointer;
  }

  .year-slider::-moz-range-thumb {
    width: 1.25rem;
    height: 1.25rem;
    background: #3b82f6;
    border-radius: 50%;
    cursor: pointer;
    border: none;
  }

  .chart-wrapper {
    overflow-x: auto;
  }

  svg {
    max-width: 100%;
    height: auto;
  }

  .chart-note {
    margin-top: 1rem;
    text-align: center;
    font-size: 0.875rem;
    color: #6b7280;
  }
</style>