import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const egg = JSON.parse(readFileSync(path.join(projectRoot, "pterodactyl", "egg-native-media-studio.json"), "utf8"));
const importEggPath = path.join(projectRoot, "pterodactyl", "native-media-studio-import-egg.json");
const importEggRaw = readFileSync(importEggPath, "utf8");
const importEgg = JSON.parse(importEggRaw);
const variables = new Map(egg.variables.map(variable => [variable.env_variable, variable]));

describe("Pterodactyl egg", () => {
  it("is importable PTDL v2 configuration with the native startup entrypoint", () => {
    expect(egg.meta.version).toBe("PTDL_v2");
    expect(egg.startup).toBe("bash /opt/native-media-studio/pterodactyl/entrypoint.sh");
    expect(egg.docker_images).toEqual({
      "Native Media Studio (Pterodactyl)": "ghcr.io/jondunnigan/native-media-studio:latest",
    });
  });

  it("requires database and signing secrets without exposing them in the panel", () => {
    expect(variables.get("DATABASE_URL")).toMatchObject({ user_viewable: false, user_editable: true, rules: expect.stringContaining("required") });
    expect(variables.get("JWT_SECRET")).toMatchObject({ user_viewable: false, user_editable: true, rules: expect.stringContaining("min:32") });
  });

  it("uses the Pterodactyl persistent media path", () => {
    expect(variables.get("MEDIA_WORK_DIR")?.default_value).toBe("/home/container/data/media-jobs");
  });

  it("provides every field consumed by the Pterodactyl PTDL v2 importer", () => {
    expect(egg).toMatchObject({
      meta: { version: "PTDL_v2", update_url: null },
      name: expect.any(String),
      description: expect.any(String),
      features: null,
      file_denylist: expect.any(Array),
      startup: expect.any(String),
      config: {
        files: expect.any(String),
        startup: expect.any(String),
        logs: expect.any(String),
        stop: expect.any(String),
      },
      scripts: {
        installation: {
          script: expect.any(String),
          container: expect.any(String),
          entrypoint: expect.any(String),
        },
      },
      variables: expect.any(Array),
    });

    for (const [label, image] of Object.entries(egg.docker_images)) {
      expect(label).toBeTruthy();
      expect(image).toMatch(/^[a-z0-9][a-z0-9./:_-]*$/i);
    }

    for (const variable of egg.variables) {
      expect(variable).toMatchObject({
        name: expect.any(String),
        description: expect.any(String),
        env_variable: expect.any(String),
        default_value: expect.any(String),
        user_viewable: expect.any(Boolean),
        user_editable: expect.any(Boolean),
        rules: expect.any(String),
        field_type: expect.any(String),
      });
    }
  });

  it("ships a strict standalone replacement import artifact", () => {
    expect(importEgg.meta.version).toBe("PTDL_v2");
    expect(importEgg.docker_images["Native Media Studio (Pterodactyl)"]).toBe("ghcr.io/jondunnigan/native-media-studio:latest");
    // Assert the exact configurable surface rather than a count, so an added or removed
    // operator variable is caught by name in both egg artifacts.
    const expectedVariables = ["DATABASE_URL", "JWT_SECRET", "MEDIA_WORK_DIR", "MIGRATION_RETRY_ATTEMPTS", "MEDIA_MAX_VIDEO_HEIGHT"];
    expect(importEgg.variables.map(variable => variable.env_variable)).toEqual(expectedVariables);
    expect(egg.variables.map(variable => variable.env_variable)).toEqual(expectedVariables);
    const heightCeiling = importEgg.variables.find(variable => variable.env_variable === "MEDIA_MAX_VIDEO_HEIGHT");
    // The ceiling must stay optional so existing deployments keep uncapped selection.
    expect(heightCeiling.default_value).toBe("");
    expect(heightCeiling.rules).toContain("nullable");
    const controlCharacters = [...importEggRaw].filter(character => {
      const code = character.charCodeAt(0);
      return code < 32 && character !== "\n" && character !== "\r" && character !== "\t";
    });
    expect(controlCharacters).toEqual([]);
  });
});
