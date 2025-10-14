<script lang="ts">
  import type { TMovie } from "../types";
  import * as d3 from "d3";
  // define the props of the line component
  type Props = {
    movies: TMovie[];
    progress?: number;
    width?: number;
    height?: number;
  };
  // progress is 100 by default unless specified
  let { movies, progress = 100, width = 1850, height = 400 }: Props = $props();

  let selectedGenre: string = $state("");
  // let selectedGenre: string = $state();

  // processing the data; $derived is used to create a reactive variable that updates whenever the dependent variables change
  const yearRange = $derived(d3.extent(movies.map((d) => d.year)));

  function getUpYear(yearRange: [undefined, undefined] | [Date, Date]) {
    if (!yearRange[0]) return new Date();
    const timeScale = d3.scaleTime().domain(yearRange).range([0, 100]);
    return timeScale.invert(progress);
  }
  const upYear: Date = $derived(getUpYear(yearRange!));

  function getGenreNums(movies: TMovie[], upYear: Date) {
    let res: { [genre: string]: { [year: number]: number } } = {};
    movies
    .filter(movie => movie.year <= upYear)
    .forEach(movie => {
      movie.genres.forEach(genre => {
        // Initialize genre object if missing
        if (!res[genre]) res[genre] = {};
        const year = movie.year.getFullYear();
        // Initialize count if missing
        if (!res[genre][year]) res[genre][year] = 0;
        res[genre][year] += 1;
      });
    });

    // movies
    //   .filter((movie) => movie.year <= upYear)
    //   .forEach((movie) => {
    //     movie.genres.forEach((genre: string) => {
    //       res[genre][movie.year.getFullYear()] = (res[genre][movie.year.getFullYear()] || 0) + 1;
    //     });
    //   });
    return res;
  }

  const genreNums = $derived(getGenreNums(movies, upYear));
  let genrenumssize = $derived(Object.keys(genreNums).length);
  // drawing the line chart

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
      .scaleLinear()
      .range([usableArea.left,usableArea.right])
      // try to get a list of all unique years from genreNums
      .domain([
          Math.min(...Object.values(genreNums).flatMap(obj => Object.keys(obj).map(Number))),
          Math.max(...Object.values(genreNums).flatMap(obj => Object.keys(obj).map(Number)))
      ] 
    )
  );

  let minyear = $derived(
    Math.min(...Object.values(genreNums).flatMap(obj => Object.keys(obj).map(Number)))
  );

  let maxyear = $derived(
    Math.max(...Object.values(genreNums).flatMap(obj => Object.keys(obj).map(Number)))
  );
  

  const yScale = $derived(
    // tip: use d3.scaleLinear() to create a linear scale for the y-axis
    d3
      .scaleLinear()
      .range([usableArea.bottom, usableArea.top])
      .domain([0, getMaxGenreCount(genreNums) || 0])
    );
    
  function getMaxGenreCount(genreNums: { [genre: string]: { [year: number]: number } }) {
    let maxCount = 0;
    for (const genre in genreNums) {
      for (const year in genreNums[genre]) {
        if (genreNums[genre][year] > maxCount){
          maxCount = genreNums[genre][year];
        }
      }
    }
    return maxCount || 0;
  }

  function makeGenreArrays(genreNums: { [genre: string]: { [year: number]: number } }) {
    let res: {[genre: string]: number[][]} = {};
    for (const genre in genreNums) {
      const yearMap = genreNums[genre];

    // Convert yearMap to array of [year, count] pairs
    const yearData = Object.entries(yearMap)
      .map(([year, count]) => [Number(year), count]) // Ensure year is a number
      .sort((a, b) => a[0] - b[0]); // Optional: sort by year

    res[genre] = yearData;
    }
    return res;
  }

  let genrearray = $derived(makeGenreArrays(genreNums));

  


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

const colorScale = $derived(
  d3.scaleOrdinal(d3.schemeCategory10)
    .domain(Object.keys(genreNums))
);

const genres = $derived(Object.keys(genreNums));

const topGenresByYear = $derived(() => {
  const yearToCounts: { [year: number]: { genre: string; count: number }[] } = {};

  // Build a structure where each year maps to all genre counts for that year
  for (const [genre, yearCounts] of Object.entries(genrearray)) {
    for (const [year, count] of yearCounts) {
      if (!yearToCounts[year]) {
        yearToCounts[year] = [];
      }
      yearToCounts[year].push({ genre, count });
    }
  }

  // For each year, pick the top 3 genres by count
  const top3ByYear: { [year: number]: Set<string> } = {};
  for (const [yearStr, genreCounts] of Object.entries(yearToCounts)) {
    const year = Number(yearStr);
    const top3 = genreCounts
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map(entry => entry.genre);
    top3ByYear[year] = new Set(top3);
  }

  return top3ByYear;
});
</script>

<h3>
  The Popularity of Genres By Year {yearRange[0]?.getFullYear()} - {yearRange[1]?.getFullYear()} 
</h3>

<div style="margin-bottom: 12px; display: flex; flex-wrap: wrap; gap: 12px;">
  {#each genres as genre}
    <div style="display: flex; align-items: center;">
      <svg width="14" height="14" style="margin-right: 6px;">
        <rect width="14" height="14" fill={colorScale(genre)} />
      </svg>
      <span style="font-size: 14px;">{genre}</span>
    </div>
  {/each}
</div>

{#if movies.length > 0}
  <svg {width} {height}>
    <g class="lines">
      {#each Object.entries(genrearray) as [genre, yearCnt]}
        {#each yearCnt as [year, cnt], i}
        <g class={genre}>

            {#if i != yearCnt.length - 1}
              <line
                x1={xScale(year)}
                x2={xScale(yearCnt[i+1][0])}
                y1={yScale(cnt)}
                y2={yScale(yearCnt[i+1][1])}
                stroke={colorScale(genre)}
                stroke-width={topGenresByYear()?.[year]?.has(genre) ? 4 : 1.5}
                role="button"
                tabindex="0"
                
              />
            {/if}
              
            
        
          </g>
          {/each}
      {/each}
    </g>

    <g transform="translate(0, {usableArea.bottom})" bind:this={xAxis} />
    <g transform="translate({usableArea.left}, 0)" bind:this={yAxis} />
  </svg>
{/if}

<style>
  .line {
    transition:
      y 0.1s ease,
      height 0.1s ease,
      width 0.1s ease; /* Smooth transition for height */
  }
</style>
