import Ajv2020 from "ajv/dist/2020.js";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { extensionError } from "./errors.js";

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const manifestSchema = JSON.parse(await readFile(join(ROOT, "extension-manifest.schema.json"), "utf8"));
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validateManifestSchema = ajv.compile(manifestSchema);

export function validateExtensionManifest(manifest) {
  if (!validateManifestSchema(manifest)) throw extensionError("EXTENSION_SCHEMA_ERROR", "Extension manifest failed validation.", "manifest", structuredClone(validateManifestSchema.errors));
  if (manifest.extension_id !== manifest.namespace && !manifest.extension_id.startsWith(`${manifest.namespace}.`)) {
    throw extensionError("EXTENSION_NAMESPACE_ERROR", `Extension ${manifest.extension_id} is outside namespace ${manifest.namespace}.`, "extension_id");
  }
  return manifest;
}

export { manifestSchema };
