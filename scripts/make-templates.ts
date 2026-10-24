/** Writes blank CSV import templates (one per dataset) with the preferred column headers. */
import fs from "node:fs";
import { DATASETS } from "@/lib/import/datasets";
fs.mkdirSync("samples/templates", { recursive: true });
for (const d of DATASETS) {
  const header = d.fields.map((f) => (f.required ? `${f.label} *` : f.label).replace(/,/g, ""));
  fs.writeFileSync(`samples/templates/${d.type}.csv`, header.join(",") + "\n");
}
const md = ["# Import templates", "", "Columns marked * are required. Any column order or header wording is accepted — the Import Centre maps headers automatically and you can adjust and save the mapping per client.", "",
  "| Record type | File | Description |", "|---|---|---|", ...DATASETS.map((d) => `| ${d.label} | \`${d.type}.csv\` | ${d.description} |`)].join("\n");
fs.writeFileSync("samples/templates/README.md", md + "\n");
console.log(`${DATASETS.length} templates written`);
