import { describe, expect, it } from "vitest";
import {
  EMPTY_ADVANCED_FILTERS,
  SEARCH_QUERY_MAX_CODE_POINTS,
  codePointLength,
  compileAdvancedQuery,
  parseSearchPage,
  quoteScryfallTerm,
  validateSearchInput,
  type AdvancedFilters,
} from "@/lib/advanced-search";

function filters(partial: Partial<AdvancedFilters>): AdvancedFilters {
  return { ...EMPTY_ADVANCED_FILTERS, ...partial };
}

describe("advanced search compiler", () => {
  it("compiles each core filter", () => {
    expect(compileAdvancedQuery("", filters({ formats: ["modern"] })).q).toBe("f:modern");
    expect(compileAdvancedQuery("", filters({ formats: ["modern", "legacy"] })).q).toBe(
      "(f:modern OR f:legacy)",
    );
    expect(compileAdvancedQuery("", filters({ colors: ["w", "u"] })).q).toBe("c=wu");
    expect(compileAdvancedQuery("", filters({ colors: ["u", "w"], colorMode: "including" })).q).toBe(
      "c>=wu",
    );
    expect(compileAdvancedQuery("", filters({ colors: ["w", "u"], colorMode: "atMost" })).q).toBe(
      "c<=wu",
    );
    expect(
      compileAdvancedQuery("", filters({ colors: ["w"], colorIdentity: true, colorMode: "including" })).q,
    ).toBe("id>=w");
    expect(compileAdvancedQuery("", filters({ colors: ["c", "w"] })).q).toBe("c=c");
    expect(compileAdvancedQuery("", filters({ colors: ["c"], colorIdentity: true })).q).toBe("id=c");
    expect(compileAdvancedQuery("", filters({ typeLine: "Legendary Creature" })).q).toBe(
      't:"Legendary Creature"',
    );
    expect(compileAdvancedQuery("", filters({ oracle: ["draw a card", "flying"] })).q).toBe(
      'o:"draw a card" o:"flying"',
    );
    expect(compileAdvancedQuery("", filters({ manaValue: "3", manaOp: ">=" })).q).toBe("mv>=3");
    expect(compileAdvancedQuery("", filters({ manaValue: "0", manaOp: "<" })).q).toBe("mv<0");
    expect(compileAdvancedQuery("", filters({ rarities: ["mythic"] })).q).toBe("r:mythic");
    expect(compileAdvancedQuery("", filters({ rarities: ["rare", "mythic"] })).q).toBe(
      "(r:rare OR r:mythic)",
    );
    expect(compileAdvancedQuery("", filters({ setCode: "MH3" })).q).toBe("e:mh3");
    expect(compileAdvancedQuery("", filters({ setCode: "mh3", setExcluded: true })).q).toBe("-e:mh3");
  });

  it("combines a name with filters and keeps sort outside q", () => {
    const compiled = compileAdvancedQuery(
      "sol ring",
      filters({
        formats: ["commander"],
        colors: ["c"],
        typeLine: "Artifact",
        manaValue: "1",
        rarities: ["uncommon"],
        order: "cmc",
        direction: "desc",
        uniquePrints: true,
      }),
    );
    expect(compiled.q).toBe('name:"sol ring" f:commander c=c t:"Artifact" mv=1 r:uncommon');
    expect(compiled.display).toBe(
      'name:"sol ring" f:commander c=c t:"Artifact" mv=1 r:uncommon order:cmc dir:desc unique:prints',
    );
    expect(compiled.order).toBe("cmc");
    expect(compiled.dir).toBe("desc");
    expect(compiled.unique).toBe("prints");
  });

  it("quotes user text so it cannot add operators", () => {
    expect(quoteScryfallTerm('angel" OR f:vintage')).toBe('"angel\\" OR f:vintage"');
    expect(compileAdvancedQuery("", filters({ typeLine: 'angel" OR f:vintage' })).q).toBe(
      't:"angel\\" OR f:vintage"',
    );
    expect(compileAdvancedQuery("", filters({ oracle: ["(draw a card)"] })).q).toBe(
      'o:"(draw a card)"',
    );
    expect(compileAdvancedQuery('foo" OR legal:vintage', filters({})).q).toBe(
      'name:"foo\\" OR legal:vintage"',
    );
    expect(compileAdvancedQuery("", filters({ typeLine: "slash\\path" })).q).toBe('t:"slash\\\\path"');
    expect(quoteScryfallTerm("bad\nline")).toBeNull();
    expect(compileAdvancedQuery("", filters({ setCode: 'mh3" OR f:vintage' })).q).toBe("");
    expect(compileAdvancedQuery("", filters({ manaValue: "3 OR f:vintage" })).q).toBe("");
  });

  it("counts code points and rejects a bad page", () => {
    expect(codePointLength("😀".repeat(200))).toBe(200);
    expect("😀".repeat(200).length).toBe(400);
    expect(validateSearchInput("😀".repeat(200), null)).toEqual({ ok: true, page: 1 });
    expect(validateSearchInput("😀".repeat(201), "1")).toEqual({
      ok: false,
      error: "Search query is too long",
    });
    expect(validateSearchInput("a".repeat(SEARCH_QUERY_MAX_CODE_POINTS + 1), null).ok).toBe(false);
    expect(parseSearchPage(null)).toBe(1);
    expect(parseSearchPage("2")).toBe(2);
    expect(parseSearchPage("10")).toBe(10);
    expect(parseSearchPage("11")).toBeNull();
    expect(parseSearchPage("0")).toBeNull();
    expect(parseSearchPage("-1")).toBeNull();
    expect(parseSearchPage("1.5")).toBeNull();
    expect(parseSearchPage("Infinity")).toBeNull();
    expect(parseSearchPage("01")).toBeNull();
  });
});
