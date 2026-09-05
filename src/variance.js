import { createHash } from "node:crypto";
import { clamp, roundTo } from "./utils.js";

function unitInterval(key) {
  const digest = createHash("sha256").update(key).digest();
  const integer = digest.readBigUInt64BE(0);
  return Number(integer) / Number(2n ** 64n - 1n);
}

function configuredSample(config, key) {
  const variance = config.specs["attack.yaml"].micro_variance;
  const distribution = variance.distribution;
  if (!variance.supported_distributions.includes(distribution)) {
    throw new RangeError(`Unsupported micro-variance distribution: ${distribution}`);
  }
  if (distribution === "uniform") return { distribution, samples: [unitInterval(key)] };
  if (distribution === "centered_triangular") {
    return { distribution, samples: [unitInterval(key), unitInterval(`${key}\u001e1`)] };
  }
  const count = variance.bounded_normal_like.sample_count.value;
  if (!Number.isInteger(count) || count < 2) throw new RangeError("bounded_normal_like sample_count must be an integer >= 2.");
  return {
    distribution,
    samples: Array.from({ length: count }, (_, index) => unitInterval(index === 0 ? key : `${key}\u001e${index}`))
  };
}

export function varianceKey({ seed, simulationId, turn, actionId, targetId, component }) {
  return [seed, simulationId, turn, actionId, targetId, component].map(String).join("\u001f");
}

export function microVariance(config, identity) {
  const variance = config.specs["attack.yaml"].micro_variance;
  const minimum = variance.minimum_factor.value;
  const maximum = variance.maximum_factor.value;
  const key = varianceKey(identity);
  const configured = configuredSample(config, key);
  const sample = configured.samples.reduce((sum, value) => sum + value, 0) / configured.samples.length;
  return Object.freeze({
    key,
    distribution: configured.distribution,
    samples: Object.freeze(configured.samples),
    sample,
    factor: roundTo(minimum + (maximum - minimum) * sample, 15),
    minimum,
    maximum
  });
}

export function applyMicroVariance(value, config, identity, bounds = [-Infinity, Infinity]) {
  const variance = microVariance(config, identity);
  return Object.freeze({
    input: value,
    ...variance,
    output: roundTo(clamp(bounds[0], bounds[1], value * variance.factor), 12)
  });
}
