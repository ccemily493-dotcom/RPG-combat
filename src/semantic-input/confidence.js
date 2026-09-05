export function fieldConfidence(evidence, config) {
  const values = config?.spec?.confidence_evidence ?? {};
  const lookup = {
    exact_dictionary: values.exact_dictionary?.value ?? 0.99,
    normalized_dictionary: values.normalized_dictionary?.value ?? 0.95,
    rule_pattern: values.rule_pattern?.value ?? 0.90,
    explicit_name: values.unique_entity?.value ?? 0.95,
    self_correction: values.unique_entity?.value ?? 0.95,
    deterministic_distance: values.unique_entity?.value ?? 0.95,
    unique_context: values.unique_entity?.value ?? 0.95,
    declared_default: values.unique_entity?.value ?? 0.95,
    contextual_pronoun: values.contextual_pronoun?.value ?? 0.88,
    ability_alias: values.ability_alias?.value ?? 0.99,
    fallback: values.fallback_candidate?.value ?? 0.75,
    ambiguous: 1 - (values.ambiguous_penalty?.value ?? 0.30),
    missing: 0
  };
  return lookup[evidence] ?? 0.8;
}

export function overallConfidence(fields) {
  const values = Object.values(fields).filter(Number.isFinite);
  return values.length ? Math.min(...values) : 0;
}
