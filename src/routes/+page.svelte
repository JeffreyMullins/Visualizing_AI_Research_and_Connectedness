<script lang="ts">
  import * as d3 from "d3";
  import { onMount } from "svelte";
  import type { TMovie } from "../../types";
    import { parse } from "svelte/compiler";
  import Bar from "$lib/Bar.svelte";
  import Line from "$lib/Line.svelte";
  
  // Reactive variable for storing the data
  let movies: TMovie[] = [];

  // Function to load the CSV
  async function loadCsv() {
    try {
      const csvUrl = "./summer_movies.csv";
      movies = await d3.csv(csvUrl, (row) => {
        // TIP: in row, all values are strings, so we need to use a row conversion function here to format them
        return {
          // ...row, // spread syntax to copy all properties from row
          num_votes: Number(row.num_votes),
          runtime_minutes:  Number(row.runtime_minutes),
          genres: row.genres.split(","), 
          year: new Date(row.year),
          average_rating: Number(row.average_rating),
          tconst: String(row.tconst),
          title_type: String(row.title_type) ,
          primary_title: String(row.primary_title),
          original_title: String(row.original_title),
          // num_votes: Number(row.num_votes),
          // year: new Date(row.year),
          // please also format the values for other non-string attributes. You can check the attributes in the CSV file
        };
      });

      console.log("Loaded CSV Data:", movies);
    } catch (error) {
      console.error("Error loading CSV:", error);
    }
  }
  // Call the loader when the component mounts
  onMount(loadCsv);



// --- Network Data & Visualization ---
let networkContainer: HTMLDivElement;

onMount(async () => {
  const nodes: any[] = await d3.json("/field_nodes.json");
  const links: any[] = await d3.json("/field_links.json");
  if (!nodes || !links) return;

  const width = 1400;
  const height = 900;

  // // Color scale by field id
  // const colorScale = d3.scaleOrdinal(d3.schemeSet2);

  // Unique color for each field
  const uniqueFields = [...new Set(nodes.map((d: any) => d.id))];
  const colorScale = d3.scaleSequential()
    .domain([0, uniqueFields.length])
    .interpolator(d3.interpolateRainbow);


  // Node size scale
  const sizeScale = d3.scaleSqrt()
    .domain(d3.extent(nodes, (d: any) => d.count) as [number, number])
    .range([6, 28]); // min/max node radius

  // Edge thickness scale
  const linkWidthScale = d3.scaleLinear()
    .domain(d3.extent(links, (d: any) => d.count) as [number, number])
    .range([1, 6]);

  const svg = d3
    .select(networkContainer)
    .append("svg")
    .attr("width", width)
    .attr("height", height);

  // Legend
const legend = svg.append("g")
  .attr("transform", `translate(${width - 260}, 20)`);

uniqueFields.forEach((field, i) => {
  const g = legend.append("g")
    .attr("transform", `translate(0, ${i * 24})`);

  g.append("circle")
    .attr("r", 7)
    .attr("fill", colorScale(i));   

  g.append("text")
    .attr("x", 16)
    .attr("y", 5)
    .text(field)
    .attr("font-size", "12px");
});



  const simulation = d3
    .forceSimulation(nodes)
    .force("link", d3.forceLink(links).id((d: any) => d.id).distance(140))
    .force("charge", d3.forceManyBody().strength(-260))
    .force("center", d3.forceCenter(width / 2, height / 2));

  const link = svg.append("g")
    .selectAll("line")
    .data(links)
    .enter()
    .append("line")
    .attr("stroke", "#999")
    .attr("stroke-width", (d: any) => linkWidthScale(d.count))
    .attr("stroke-opacity", 0.8);

  const node = svg.append("g")
    .selectAll("circle")
    .data(nodes)
    .enter()
    .append("circle")
    .attr("r", (d: any) => sizeScale(d.count))
    // .attr("fill", (d: any) => colorScale(d.id))
    .attr("fill", (d: any) => colorScale(uniqueFields.indexOf(d.id)))
    .call(
      d3.drag()
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
        })
    );

  const label = svg.append("g")
    .selectAll("text")
    .data(nodes)
    .enter()
    .append("text")
    .text((d: any) => d.id)
    .attr("font-size", "11px")
    .attr("fill", "#333")
    .attr("dx", 8)
    .attr("dy", 4);

  simulation.on("tick", () => {
    link
      .attr("x1", (d: any) => d.source.x)
      .attr("y1", (d: any) => d.source.y)
      .attr("x2", (d: any) => d.target.x)
      .attr("y2", (d: any) => d.target.y);

    node
      .attr("cx", (d: any) => d.x)
      .attr("cy", (d: any) => d.y);

    label
      .attr("x", (d: any) => d.x)
      .attr("y", (d: any) => d.y);
  });
});


  
</script>

<h1>Summer Movies</h1>

<p>Here are {movies.length == 0 ? "..." : movies.length + " "} movies</p>
<Bar {movies} />

<hr />

<h2>Field Co-occurrence Network</h2>
<p>This network shows how academic fields co-occur across works.</p>

<div bind:this={networkContainer} style="margin-top: 16px;"></div>




