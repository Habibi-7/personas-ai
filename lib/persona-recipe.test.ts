import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getRecipeStatus,
  installPersonaRecipe,
  parsePersonaRecipe,
  readPersonaRecipe,
  syncPersonaRecipe,
  writePersonaRecipe,
} from "./persona-recipe";
import { personaPaths } from "./personas";

const ORIGINAL_CWD = process.cwd();
const TMP_ROOT = join(tmpdir(), `persona-recipe-test-${process.pid}`);

beforeEach(async () => {
  await rm(TMP_ROOT, { recursive: true, force: true });
  await mkdir(join(TMP_ROOT, "data", "personas", "demo-persona", "documents"), {
    recursive: true,
  });
  await mkdir(join(TMP_ROOT, "data", "personas", "demo-persona", "index"), {
    recursive: true,
  });

  await writeFile(
    join(TMP_ROOT, "data", "personas", "demo-persona", "persona.json"),
    `${JSON.stringify(
      {
        id: "demo-persona",
        name: "Demo Persona",
        description: "Test persona",
        documentLabel: "sources",
        examplePrompts: [],
        voicePrompt: "Test voice",
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  process.chdir(TMP_ROOT);
});

afterEach(async () => {
  process.chdir(ORIGINAL_CWD);
  await rm(TMP_ROOT, { recursive: true, force: true });
});

describe("parsePersonaRecipe", () => {
  test("accepts string links and inline documents", () => {
    const recipe = parsePersonaRecipe({
      schema: 1,
      links: ["https://example.com/a", { url: "https://example.com/b", slug: "b" }],
      documents: [{ title: "Note", content: "Body text" }],
    });

    expect(recipe.links).toHaveLength(2);
    expect(recipe.links[1].slug).toBe("b");
    expect(recipe.documents).toHaveLength(1);
  });

  test("rejects unsupported schema", () => {
    expect(() => parsePersonaRecipe({ schema: 2, links: ["https://example.com"] })).toThrow(
      /Unsupported recipe schema/
    );
  });
});

describe("readPersonaRecipe / writePersonaRecipe", () => {
  test("round-trips a recipe file", async () => {
    await writePersonaRecipe("demo-persona", {
      schema: 1,
      links: [{ url: "https://example.com/article", slug: "article" }],
    });

    const recipe = await readPersonaRecipe("demo-persona");
    expect(recipe.links[0].url).toBe("https://example.com/article");
    expect(recipe.links[0].slug).toBe("article");
  });
});

describe("getRecipeStatus", () => {
  test("reports needs-bootstrap when index is missing", async () => {
    await writePersonaRecipe("demo-persona", {
      schema: 1,
      links: [{ url: "https://example.com/article" }],
    });

    expect(await getRecipeStatus("demo-persona")).toBe("needs-bootstrap");
  });
});

describe("syncPersonaRecipe", () => {
  test("writes sources.json from ingest input and results", async () => {
    const recipe = await syncPersonaRecipe("demo-persona", {
      links: ["https://example.com/article"],
      documents: [{ title: "Notes", content: "Pinned insight." }],
      results: [
        {
          source: "https://example.com/article",
          ok: true,
          action: "fetched",
          slug: "article",
          title: "Article",
        },
        {
          source: "Notes",
          ok: true,
          action: "written",
          slug: "notes",
          title: "Notes",
        },
      ],
    });

    expect(recipe.links).toHaveLength(1);
    expect(recipe.links[0]).toEqual({
      url: "https://example.com/article",
      slug: "article",
      title: "Article",
    });
    expect(recipe.documents).toHaveLength(1);
    expect(recipe.documents?.[0].slug).toBe("notes");

    const persisted = await readPersonaRecipe("demo-persona");
    expect(persisted.links[0].slug).toBe("article");
  });

  test("merges new links into an existing recipe", async () => {
    await writePersonaRecipe("demo-persona", {
      schema: 1,
      links: [{ url: "https://example.com/a", slug: "a", title: "A" }],
    });

    const recipe = await syncPersonaRecipe("demo-persona", {
      links: ["https://example.com/b"],
      results: [
        {
          source: "https://example.com/b",
          ok: true,
          action: "fetched",
          slug: "b",
          title: "B",
        },
      ],
    });

    expect(recipe.links).toHaveLength(2);
    expect(recipe.links.map((link) => link.slug).sort()).toEqual(["a", "b"]);
  });
});

describe("installPersonaRecipe", () => {
  test("index-only rebuilds from existing documents", async () => {
    await writePersonaRecipe("demo-persona", {
      schema: 1,
      links: [{ url: "https://example.com/article", slug: "article" }],
    });

    const { documentsDir, indexDir } = personaPaths("demo-persona");
    await writeFile(
      join(documentsDir, "article.md"),
      [
        "---",
        'title: "Article"',
        "slug: article",
        "url: https://example.com/article",
        "---",
        "",
        "# Article",
        "",
        "alpha beta gamma",
        "",
      ].join("\n"),
      "utf8"
    );

    const result = await installPersonaRecipe("demo-persona", { indexOnly: true }, {
      embed: async () => [1, 0, 0, 0],
    });
    expect(result.indexed).toBe(true);
    expect(result.index?.documentCount).toBe(1);
    expect(existsSync(join(indexDir, "manifest.json"))).toBe(true);
  });

  test("skips existing URLs unless forceRefetch is set", async () => {
    await writePersonaRecipe("demo-persona", {
      schema: 1,
      links: [{ url: "https://example.com/article", slug: "article" }],
    });

    const { documentsDir } = personaPaths("demo-persona");
    await writeFile(
      join(documentsDir, "article.md"),
      [
        "---",
        'title: "Article"',
        "slug: article",
        "url: https://example.com/article",
        "---",
        "",
        "# Article",
        "",
        "Existing corpus text.",
        "",
      ].join("\n"),
      "utf8"
    );

    const extractUrl = async () => {
      throw new Error("extractUrl should not run when URL already exists");
    };

    const { ingestPersonaSources } = await import("./persona-sources");
    const { results } = await ingestPersonaSources({
      personaId: "demo-persona",
      links: [{ url: "https://example.com/article", slug: "article" }],
      skipExistingUrls: true,
      extractUrl,
      embed: async () => [1, 0, 0, 0],
    });

    expect(results).toHaveLength(1);
    expect(results[0].action).toBe("skipped");
    expect(results[0].slug).toBe("article");
  });
});
