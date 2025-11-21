// src/lib/vis/worksData.ts
import { csvParse } from "d3-dsv";

export type WorkRow = {
	workId: string;    // OpenAlex work URL
	authorId: string;  // OpenAlex author URL
	country: string;   // e.g. "France"
	field: string;     // topic_field_display_name
	year: number;      // pub_year
};

const CSV_URL = "/works_with_authors.csv";

let cache: WorkRow[] | null = null;

// Basic ISO2 -> country-name mapping for most research-heavy countries.
// If you see a country not mapped correctly, you can extend this object.
const iso2ToName: Record<string, string> = {
	US: "United States of America",
	GB: "United Kingdom",
	FR: "France",
	DE: "Germany",
	CN: "China",
	JP: "Japan",
	KR: "South Korea",
	CA: "Canada",
	AU: "Australia",
	BR: "Brazil",
	IN: "India",
	IT: "Italy",
	ES: "Spain",
	NL: "Netherlands",
	SE: "Sweden",
	NO: "Norway",
	DK: "Denmark",
	FI: "Finland",
	CH: "Switzerland",
	SG: "Singapore",
	RU: "Russia",
	ZA: "South Africa",
	MX: "Mexico",
	AR: "Argentina",
	BE: "Belgium",
	AT: "Austria",
	PL: "Poland",
	IE: "Ireland",
	NZ: "New Zealand",
	IL: "Israel",
};

// countries column example: "['FR']" or "['FR', 'DE']" or "[]"
function parseCountry(raw: any): string {
	if (raw == null) return "";
	let s = String(raw).trim();
	if (!s) return "";

	if (s.startsWith("[") && s.endsWith("]")) {
		s = s.slice(1, -1); // remove brackets
	}

	const parts = s
		.split(",")
		.map((p) => p.replace(/['"]/g, "").trim())
		.filter(Boolean);

	if (!parts.length) return "";

	const code = parts[0].toUpperCase();
	return iso2ToName[code] ?? code; // fall back to the code itself
}

// handle single or multiple fields, or JSON-style list
export function splitFieldString(raw: string): string[] {
	if (!raw) return [];
	let s = String(raw).trim();
	if (!s) return [];

	if (s.startsWith("[") && s.endsWith("]")) {
		s = s.slice(1, -1);
	}

	return s
		.split(/[|,;]+/)
		.map((p) => p.replace(/['"]/g, "").trim())
		.filter(Boolean);
}

export async function loadWorks(): Promise<WorkRow[]> {
	if (cache) return cache;

	const res = await fetch(CSV_URL);
	if (!res.ok) throw new Error(`Failed to load ${CSV_URL}`);
	const text = await res.text();

	const raw = csvParse(text) as any[];

	cache = raw
		.map((r) => {
			const year = +r.pub_year || +r.year;
			return {
				workId: String(r.work_id ?? r.work ?? ""),
				authorId: String(r.author_id ?? ""),
				country: parseCountry(r.countries),
				field: String(r.topic_field_display_name ?? "").trim(),
				year,
			} as WorkRow;
		})
		.filter((d) => d.workId && d.authorId && !isNaN(d.year));

	return cache;
}

export function yearsFrom(rows: WorkRow[]): number[] {
	return Array.from(new Set(rows.map((d) => d.year))).sort((a, b) => a - b);
}

export function shortAuthorId(authorId: string): string {
	if (!authorId) return "";
	const parts = authorId.split("/");
	const last = parts[parts.length - 1];
	return last || authorId;
}
