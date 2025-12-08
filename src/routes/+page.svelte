<script lang="ts">
  import * as d3 from "d3";
  import { onMount } from "svelte";
  import type { TTopic } from "../../types";
  import type { Tsankey_authors } from "../../types";
  import type { Tbubble_chart } from "../../types";
  import Bar_topics from "$lib/Bar_topics.svelte";
  import FieldsGalaxy from "$lib/vis/FieldsGalaxy.svelte";
  import FieldTrends from "$lib/vis/FieldTrends.svelte";
  import AiGeoMap from "$lib/vis/AiGeoMap.svelte";
  import CoauthorNetwork from "$lib/vis/CoauthorNetwork.svelte";
  import AiFieldNetwork from "$lib/vis/AiFieldNetwork.svelte";
  import WordCloud from "$lib/vis/WordCloud.svelte";
  import StackedArea from "$lib/vis/StackedArea.svelte";
  
  // --- Topic data ---
  let topics: TTopic[] = [];
  let author_sankey: Tsankey_authors[] = [];
  let bubble_chart_data: Tbubble_chart[] = [];
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

    try {
      const csvUrl = "./author_publication_sankey.csv";
      author_sankey = await d3.csv(csvUrl, (row) => {
        return {
          first_publication_topic: String(row.first_publication_topic),
          publication_order: Number(row.publication_order),
          topic_order: Number(row.topic_order),
          author_count: Number(row.author_count),

        };
      });
      console.log("Loaded CSV Data:", author_sankey);
    } catch (error) {
      console.error("Error loading CSV:", error);
    }

    try {
      const csvUrl = "./data_for_bubble_chart_large.csv";
      bubble_chart_data = await d3.csv(csvUrl, (row) => {
        return {
          pub_year: Number(row.pub_year),
          topic_field_display_name: String(row.topic_field_display_name),
          num_publications: Number(row.num_publications),
          cross_collaboration_metric: Number(row.cross_collaboration_metric),
          authors: Number(row.authors),

        };
      });
      console.log("Loaded CSV Data:", bubble_chart_data);
    } catch (error) {
      console.error("Error loading CSV:", error);
    }

  }

  onMount(loadCsv);

  // --- Network Data & Visualization ---

  let fieldCount = 0;

  
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


    <!-- Jeff: sankey diagram -->
    <section class="panel">
      <div class="panel-header">
        <h2>Topic Distribution</h2>
        <p>
          Eachasdfhklas;dfaklsdfja;s lkdfajlk sdfj;al sdfkla;jsdlfkajsd f;lka.
        </p>
      </div>

      <div class="panel-body">
        <Sankey {author_sankey} />
      </div>
    </section>


    <section class="panel">
      <div class="panel-header">
        <h2>Topic Distribution</h2>
        <p>
          Eachasdfhklas;dfaklsdfja;s lkdfajlk sdfj;al sdfkla;jsdlfkajsd f;lka.
        </p>
      </div>

      <div class="panel-body">
        <Bubble_chart {bubble_chart_data} />
      </div>
    </section>



    <!-- Wenwen: Network -->
    <section class="panel">
      <h2>AI Collaboration Network (All Subfield)</h2>
      <AiFieldNetwork {topics} />
    </section>

    

  <!-- Mingyang: Author -->
  <section class="panel">
    <FieldsGalaxy />
  </section>

  <section class="panel">
    <FieldTrends />
  </section>

  <section class="panel">
    <AiGeoMap />
  </section>

  <section class="panel">
    <CoauthorNetwork />
  </section>



  <!-- Jikai: Wordcloud & Stack area -->
  <section class="panel">
    <div class="panel-header">
      <h2>Topic Word Cloud</h2>
      <p>
        A word cloud visualization representing the most prominent topics (Top 30 each year) in AI research.
      </p>
    <div class="panel-body">
      <WordCloud/>
    </div>
  </section>  

  <section class="panel">
    <div class="panel-header">
      <h2>Stacked Area Chart of Topics Over Time</h2>
      <p>
        This stacked area chart illustrates the distribution of AI research topics over the years, grouped by domain or field.
      </p>  
    <div class="panel-body">
      <StackedArea
        topicsFilePath="/topics_sampled.csv"
        worksFilePath="/works_sampled.csv"
        width={1200}
        height={300}
      />
    </div>
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

<!-- 
LLMs including ChatGPT, and so on have been used for help with doing this task.
-->
