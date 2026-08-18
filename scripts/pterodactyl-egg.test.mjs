import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const egg = JSON.parse(readFileSync(path.join(projectRoot, "pterodactyl", "egg-native-media-studio.json"), "utf8"));
const variables = new Map(egg.variables.map(variable => [variable.env_variable, variable]));

describe("Pterodactyl egg", () => {
  it("is importable PTDL v2 configuration with the native startup entrypoint", () => {
    expect(egg.meta.version).toBe("PTDL_v2");
    expect(egg.startup).toBe("bash /opt/native-media-studio/pterodactyl/entrypoint.sh");
    expect(Object.keys(egg.docker_images)).toHaveLength(1);
  });

  it("requires database and signing secrets without exposing them in the panel", () => {
    expect(variables.get("DATABASE_URL")).toMatchObject({ user_viewable: false, user_editable: true, rules: expect.stringContaining("required") });
    expect(variables.get("JWT_SECRET")).toMatchObject({ user_viewable: false, user_editable: true, rules: expect.stringContaining("min:32") });
  });

  it("uses the Pterodactyl persistent media path", () => {
    expect(variables.get("MEDIA_WORK_DIR")?.default_value).toBe("/home/container/data/media-jobs");
  });
});
