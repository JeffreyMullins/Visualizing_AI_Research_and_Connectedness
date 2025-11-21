<script lang="ts">
  import { onMount } from "svelte";
  import * as d3 from "d3";
  import {
    loadWorks,
    yearsFrom,
    splitFieldString,
    type WorkRow,
  } from "$lib/vis/worksData";

  let metric: "unique" | "authorships" = "authorships";
  let years: number[] = [];
  let yearMin = 1970;
  let yearMax = 2025;
  let rangeStart: number;
  let rangeEnd: number;

  let sel1 = "";
  let sel2 = "";
  let showTotal = false;
  let shouldAnimate = true;

  let rows: WorkRow[] = [];

  const seriesUnique = new Map<string, Array<[number, number]>>();
  const seriesAuth = new Map<string, Array<[number, number]>>();
  let totalUnique: Array<[number, number]> = [];
  let totalAuth: Array<[number, number]> = [];

  let allFields: string[] = [];
  let colorScale: d3.ScaleOrdinal<string, string>;
  const fieldColor = (f: string) =>
    colorScale ? (colorScale(f) as string) : "#888";

  // ... keep your existing DOM refs (wrap, miniWrap, svg, etc.)
  // ... keep your existing drawing functions (initChart, initMini, drawChart, drawMini, brushed, handleMove, handleLeave, etc.)

  const fmt = d3.format(",");

  onMount(async () => {
    rows = await loadWorks();
    years = yearsFrom(rows);
    yearMin = years[0];
    yearMax = years.at(-1)!;
    rangeStart = yearMin;
    rangeEnd = yearMax;
    aggregate();
    initChart();
    initMini();
    updateAll();
    window.addEventListener("resize", () => {
      initChart(true);
      initMini(true);
      updateAll();
    });
  });

  function aggregate() {
    seriesUnique.clear();
    seriesAuth.clear();

    const byFU = new Map<string, Map<number, Set<string>>>();
    const byFA = new Map<string, Map<number, number>>();
    const uniqByYear = new Map<number, Set<string>>();
    const authByYear = new Map<number, number>();

    for (const r of rows) {
      const y = r.year;
      const aid = r.authorId;
      const fields = splitFieldString(r.field);
      if (!fields.length) continue;

      (uniqByYear.get(y) ?? uniqByYear.set(y, new Set()).get(y)!).add(aid);
      authByYear.set(y, (authByYear.get(y) ?? 0) + 1);

      for (const f of fields) {
        const u = byFU.get(f) ?? (byFU.set(f, new Map()), byFU.get(f)!);
        (u.get(y) ?? u.set(y, new Set()).get(y)!).add(aid);

        const a = byFA.get(f) ?? (byFA.set(f, new Map()), byFA.get(f)!);
        a.set(y, (a.get(y) ?? 0) + 1);
      }
    }

    for (const f of byFA.keys()) {
      seriesUnique.set(
        f,
        years.map((y) => [y, byFU.get(f)?.get(y)?.size ?? 0]),
      );
      seriesAuth.set(
        f,
        years.map((y) => [y, byFA.get(f)?.get(y) ?? 0]),
      );
    }

    totalUnique = years.map((y) => [y, uniqByYear.get(y)?.size ?? 0]);
    totalAuth = years.map((y) => [y, authByYear.get(y) ?? 0]);

    allFields = Array.from(
      new Set<string>([...seriesUnique.keys(), ...seriesAuth.keys()]),
    ).sort();
    const pal = d3.quantize(
      d3.interpolateRainbow,
      Math.max(12, allFields.length),
    );
    colorScale = d3.scaleOrdinal<string, string>().domain(allFields).range(pal);

    sel1 = allFields[0] ?? "";
    sel2 = "";
  }

  // keep your existing helpers: currentSeriesMap, totalSeries, within, toggleMetric, onSel1, onSel2, toggleTotal, updateAll (they use the maps above)
</script>
