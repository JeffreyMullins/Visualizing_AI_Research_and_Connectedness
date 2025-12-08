import pandas as pd
from pathlib import Path

# Path to your static folder
base_dir = Path("/Users/mingyangpang/Visualizing_AI_Research_and_Connectedness/static")

# Input and output files
in_path = base_dir / "authors_mingyang_large.csv"
out_path = base_dir / "authors_mingyang_15p.csv"  # 15% sample

# Read the large CSV
df = pd.read_csv(in_path)

# Randomly keep 15% of the rows
df_small = df.sample(frac=0.15, random_state=42)

# Save to new CSV
df_small.to_csv(out_path, index=False)

print(f"Original rows: {len(df)}")
print(f"Reduced rows:  {len(df_small)}")
print(f"Saved to:      {out_path}")
