import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { clamp, roundTo } from "../utils.js";

export async function loadProfileTemplates(specDir) {
  return parseYaml(await readFile(join(specDir, "fixtures", "profile-templates.yaml"), "utf8"), { uniqueKeys: true });
}

export function generateSpecializedProfiles(config, templates) {
  const categories = config.specs["categories.yaml"].categories;
  const statIds = Object.keys(config.specs["stats.yaml"].stats);
  const profiles = [];
  for (const categoryId of templates.applicable_categories) {
    const category = categories[categoryId];
    for (const [specialization, template] of Object.entries(templates.profiles)) {
      const stats = {};
      const placements = {};
      for (const stat of statIds) {
        if (template.placements[stat]) {
          const fraction = clamp(0, 1, template.placements[stat].value);
          stats[stat] = roundTo(category.range.min.value + (category.range.max.value - category.range.min.value) * fraction, 2);
          placements[stat] = fraction;
        } else {
          stats[stat] = category.default.value;
          placements[stat] = "category_default";
        }
      }
      profiles.push({
        id: `${categoryId}:${specialization}`,
        category: categoryId,
        specialization,
        description: template.description,
        resolved_stats: stats,
        provenance: { placements }
      });
    }
  }
  return {
    version: "0.3",
    generatedFrom: ["categories.yaml", "stats.yaml", "fixtures/profile-templates.yaml"],
    categoryCount: templates.applicable_categories.length,
    specializationsPerCategory: Object.keys(templates.profiles).length,
    profiles
  };
}

export function validateSpecializedProfiles(config, generated) {
  const issues = [];
  const categories = config.specs["categories.yaml"].categories;
  const statIds = Object.keys(config.specs["stats.yaml"].stats);
  for (const profile of generated.profiles) {
    const category = categories[profile.category];
    for (const stat of statIds) {
      const value = profile.resolved_stats[stat];
      if (!Number.isFinite(value) || value < category.range.min.value || value > category.range.max.value) {
        issues.push(`${profile.id}.${stat}=${value} outside ${category.range.min.value}..${category.range.max.value}`);
      }
    }
  }
  return { ok: issues.length === 0, issues };
}
