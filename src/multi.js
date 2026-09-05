import { coefficient } from "./config.js";
import { ValidationError } from "./errors.js";
import { roundTo } from "./utils.js";

export function planMultiAttack(config, quantity, powerPerAttack, costTotals = {}) {
  if (!Number.isInteger(quantity) || quantity < 1) throw new ValidationError("Attack quantity must be a positive integer.");
  const multi = config.specs["attack.yaml"].multi_attack;
  const threshold = coefficient(multi.individual_resolution_max_count);
  const batchSize = coefficient(multi.batch_size);
  const groups = [];
  if (quantity <= threshold) {
    for (let index = 0; index < quantity; index += 1) {
      groups.push({ kind: "individual", startIndex: index, count: 1, representedPower: powerPerAttack });
    }
  } else {
    for (let startIndex = 0; startIndex < quantity; startIndex += batchSize) {
      const count = Math.min(batchSize, quantity - startIndex);
      groups.push({ kind: "batch", startIndex, count, representedPower: powerPerAttack * count });
    }
  }
  return Object.freeze({
    mode: quantity <= threshold ? "individual" : "batch",
    quantity,
    powerPerAttack,
    totalPower: roundTo(powerPerAttack * quantity),
    costTotals: structuredClone(costTotals),
    groups: Object.freeze(groups.map(Object.freeze)),
    representedCount: groups.reduce((sum, group) => sum + group.count, 0),
    representedPower: roundTo(groups.reduce((sum, group) => sum + group.representedPower, 0))
  });
}
