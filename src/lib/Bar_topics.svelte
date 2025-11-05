<script lang="ts">
  import type { TTopic } from "../types";
  import * as d3 from "d3";
  // define the props of the Bar component
  type Props = {
    topics: TTopic[];
    progress?: number;
    width?: number;
    height?: number;
  };
  // progress is 100 by default unless specified
  let { topics, progress = 100, width = 1000, height = 400 }: Props = $props();

  let selectedGenre: string = $state("");
  // let selectedGenre: string = $state();


  
  
  function getTopicNums(topics: TTopic[]) {
    let res: { [topic_field_display_name: string]: number } = {};
    topics
      .forEach((topic) => {
          res[topic.topic_field_display_name] = (res[topic.topic_field_display_name] || 0) + 1;  
      });
    return res;
  }

  const topicNums = $derived(getTopicNums(topics));

  // drawing the bar chart

  const margin = {
    top: 15,
    bottom: 50,
    left: 30,
    right: 10,
  };

  let usableArea = {
    top: margin.top,
    right: width - margin.right,
    bottom: height - margin.bottom,
    left: margin.left,
  };

  const xScale = $derived(
    // tip: use d3.scaleBand() to create a band scale for the x-axis
    d3
      .scaleBand()
      .range([usableArea.left,usableArea.right])
      .domain(Object.keys(topicNums))
      .padding(0.1),
  );

  const yScale = $derived(
    // tip: use d3.scaleLinear() to create a linear scale for the y-axis
    d3
      .scaleLinear()
      .range([usableArea.bottom, usableArea.top])
      .domain([0, d3.max(Object.values(topicNums)) || 0])
  );

  const xBarwidth: number = $derived(xScale.bandwidth());

  let xAxis: any = $state(),
    yAxis: any = $state();

  function updateAxis() {
    d3.select(xAxis)
      .call(d3.axisBottom(xScale))
      .selectAll("text")
      .attr("transform", "rotate(45)")
      .style("text-anchor", "start");

    // tip:
    // similar to the x-axis, create a y-axis using d3.axisLeft() and bind it to the yAxis variable
    d3.select(yAxis)
      .call(d3.axisLeft(yScale))
      .selectAll("text")
      .attr("transform", "rotate(45)")
      .style("text-anchor", "start");
  }

  // the $effect function is used to run a function whenever the reactive variables change, also known as a side effect
  $effect(() => {
    updateAxis();
  });


</script>

<h3>
  The Distribution of {Object.keys(topicNums).length > 0 ? Object.keys(topicNums).length : " (no data available)"} Topics
</h3>


{#if Object.keys(topicNums).length > 0}
  <svg {width} {height}>
    <g class="bars">
      {#each Object.entries(topicNums) as [topic, cnt]}
        <g class={topic}>
          <!-- tip: draw bars here using the svg <rect/> component -->
          <rect
            width={xBarwidth}
            height={yScale(0) - yScale(cnt)}
            x={xScale(topic)}
            y={yScale(cnt)}
            fill="#1E90FF"
            class="bar"
            opacity={.8}
            role="button"
            tabindex="0"
            
            onmouseover={() => selectedGenre = topic}
            onmouseout={() => selectedGenre = ""}
            onfocus={() => selectedGenre = ""}
            onblur={() => selectedGenre = ""}
            />
            
          {#if selectedGenre === topic}
          <text
            x={xScale(topic)! + xBarwidth / 2}
            y={yScale(cnt) - 5}
            font-size="12"
            text-anchor="middle"
          >
          <!-- tip: the text below should change with the hover on interaction -->
            {cnt} {topic} Publications  
          </text>
          {/if}
        </g>
      {/each}
    </g>

    <g transform="translate(0, {usableArea.bottom})" bind:this={xAxis} />
    <g transform="translate({usableArea.left}, 0)" bind:this={yAxis} />
  </svg>
{/if}

<style>
  .bar {
    transition:
      y 0.1s ease,
      height 0.1s ease,
      width 0.1s ease; /* Smooth transition for height */
  }
</style>
