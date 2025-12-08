#!/usr/bin/env python3
"""
data_mingyang.py  (version for when this file is in /static)

Builds the merged dataset `authors_mingyang.csv` from:
  - author_publication_topics_sankey.csv
  - authors_sampled.csv
  - works_sampled.csv

All files are expected to be in the **same folder** as this script.

Output: authors_mingyang.csv with columns:
  work_id, author_id, countries, topic_field_display_name, pub_year

Rules:
  - author_id in the output is actually the human-readable author name (a_name).
  - For publication_order == 1, if topic_field_display_name is missing,
    fill it with first_publication_topic (don’t leave it empty).
"""

from pathlib import Path
import pandas as pd

# ---------------------------------------------------------------------
# Paths: since this script sits inside /static, use its own directory
# ---------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent  # this is .../static

AUTHORS_FILE = BASE_DIR / "authors_sampled_large.csv"
WORKS_FILE = BASE_DIR / "works_sampled_large.csv"
TOPICS_FILE = BASE_DIR / "author_publication_topics_sankey.csv"
OUTPUT_FILE = BASE_DIR / "authors_mingyang_large.csv"


def build_authors_mingyang() -> pd.DataFrame:
    # --------------------------------------------------------------
    # 1. Load source CSVs
    # --------------------------------------------------------------
    authors = pd.read_csv(AUTHORS_FILE)
    works = pd.read_csv(WORKS_FILE)
    topics = pd.read_csv(TOPICS_FILE)

    # --------------------------------------------------------------
    # 2. Prepare works: rename id -> work_id so it matches authors
    # --------------------------------------------------------------
    if "id" in works.columns and "work_id" not in works.columns:
        works = works.rename(columns={"id": "work_id"})

    # keep only work_id + pub_year
    works_small = works[["work_id", "pub_year"]]

    # attach publication year to each author–work row
    authors_with_year = authors.merge(works_small, on="work_id", how="left")

    # --------------------------------------------------------------
    # 3. Prepare topics:
    #    - keep only publication_order == 1
    #    - fill missing topic_field_display_name from first_publication_topic
    # --------------------------------------------------------------
    topics_first = topics.loc[topics["publication_order"] == 1].copy()

    topics_first["topic_field_display_name"] = (
        topics_first["topic_field_display_name"]
        .replace("", pd.NA)
        .fillna(topics_first["first_publication_topic"])
    )

    topics_small = topics_first[["a_id", "topic_field_display_name"]]

    # --------------------------------------------------------------
    # 4. Merge topics into authors_with_year
    # --------------------------------------------------------------
    authors_topics = authors_with_year.merge(
        topics_small,
        on="a_id",
        how="left",
    )

    # --------------------------------------------------------------
    # 5. Build final dataframe
    #    - author_id column actually holds a_name
    # --------------------------------------------------------------
    if "a_name" not in authors_topics.columns:
        raise KeyError(
            "Column 'a_name' not found in authors_sampled.csv "
            "(expected the human-readable author name)."
        )

    authors_topics["author_id"] = authors_topics["a_name"]

    final = (
        authors_topics[
            ["work_id", "author_id", "countries", "topic_field_display_name", "pub_year"]
        ]
        .sort_values(["work_id", "author_id"])
        .reset_index(drop=True)
    )

    # --------------------------------------------------------------
    # 6. Save and return
    # --------------------------------------------------------------
    final.to_csv(OUTPUT_FILE, index=False, encoding="utf-8")
    print(f"[data_mingyang] wrote {len(final):,} rows -> {OUTPUT_FILE}")
    return final


if __name__ == "__main__":
    build_authors_mingyang()
