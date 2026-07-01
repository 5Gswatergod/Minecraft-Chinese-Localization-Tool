import { describe, expect, it } from "vitest";
import { collectJsonTextValues, extractStringLiterals, parseLangJson, parseLangProperties } from "./parsers";

describe("parsers", () => {
  it("parses Minecraft lang JSON files", () => {
    expect(parseLangJson(JSON.stringify({ "item.example": "Copper Gear", "id.only": "mod:item" }))).toEqual([
      { key: "item.example", value: "Copper Gear" }
    ]);
  });

  it("parses legacy .lang files", () => {
    expect(parseLangProperties("item.example=Copper Gear\n# comment\nempty=\n")).toEqual([{ key: "item.example", value: "Copper Gear" }]);
  });

  it("collects nested JSON text values", () => {
    const values = collectJsonTextValues({ display: { title: "Enter the Nether", description: "Build a portal" } });
    expect(values.map((value) => value.path.join("."))).toEqual(["display.title", "display.description"]);
  });

  it("extracts string literals from script-like text", () => {
    expect(extractStringLiterals('event.add("Nether Alloy", "mod:item")')).toEqual(["Nether Alloy"]);
  });
});
