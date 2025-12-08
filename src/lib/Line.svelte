<script lang="ts">
  import * as d3 from "d3";
  type TProps = {
    data: Array<{ x: Date; y: number }>;
    yearRange: [Date, Date] | undefined;
    width?: number;
    height?: number;
  };
  let {
    data = [],
    yearRange = $bindable(),
    height = 150,
    width = 600,
  }: TProps = $props();

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
    d3
      .scaleTime()
      .domain(d3.extent(data.map((d) => d.x)) as [Date, Date])
      .range([usableArea.left, usableArea.right])
  );

  const yScale = $derived(
    d3
      .scaleLinear()
      .domain(d3.extent(data.map((d) => d.y)) as [number, number])
      .range([usableArea.bottom, usableArea.top])
  );

  // tip2: this line generator will create a svg path from the data
  const lineGenerator = d3
      .line()
      .x((d) => xScale(d.x)) // Map x-coordinate
      .y((d) => yScale(d.y)) // Map y-coordinate
      .curve(d3.curveBasis);

  const path = $derived(lineGenerator(data));

  let xAxis: any = $state(),
    yAxis: any = $state(),
    brushElement: any = $state();

  function updateAxis() {
    if (!xScale || !yScale) {
      return;
    }
    d3.select(xAxis).call(d3.axisBottom(xScale));

    d3.select(yAxis).call(d3.axisLeft(yScale));
  }

  function handleBrush(event: any) {
    // tip3: this function will be called at Brush end, and we will use it to update the yearRange
    const selection = event.selection;
    if (selection) {
        const [start, end] = selection; // Convert from pixel values to Date
        yearRange = [xScale.invert(start), xScale.invert(end)];
    } else {
        yearRange = undefined
    }
  }

  function setupBrush() {
    const brush = d3
      .brushX()
      .extent([
        [usableArea.left, usableArea.top],
        [usableArea.right, usableArea.bottom],
      ])
      .on("brush end", handleBrush);

    d3.select(brushElement).call(brush);
  }

  // the $effect function is used to run a function whenever the reactive variables change, also known as a side effect
  $effect(() => {
    setupBrush();
    updateAxis();
  });
</script>

<svg {width} {height} class="line">
  <!-- tip2: add the line here, the circles can help validate your curve -->
  <path d={path} fill='transparent' stroke='black' stroke-width="1" />
  <g class="points">
        {#each data as point (point.x)}
            <circle
                cx={xScale ? xScale(point.x) : usableArea.left}
                cy={yScale ? yScale(point.y) : usableArea.bottom}
                r=1
                fill="black"
                stroke="black"
                stroke-width="1"
            />
        {/each}
    </g>
  <g transform="translate(0, {usableArea.bottom})" bind:this={xAxis} />
  <g transform="translate({usableArea.left}, 0)" bind:this={yAxis} />

  <!-- tip3: add the brush here. -->
  <g class="brush" bind:this={brushElement} />

  <text x={width / 2} y={height - 5} text-anchor="middle">
    Number of Publications by Year:
  </text>
  {#if yearRange}
    <text x={width / 2} y={height - 20} text-anchor="middle">
      {yearRange[0].getFullYear()} - {yearRange[1].getFullYear()}
    </text>
  {:else}
    <text x={width / 2} y={height - 20} text-anchor="middle">
      Brush to select a range
    </text>
  {/if}
</svg>
