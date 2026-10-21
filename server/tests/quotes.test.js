// Quote marks as a keyboard types them (21 Oct 2026): an item named on a phone
// with ” must be found by a search typed with ".
//
//   node --test tests/

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { plainQuotes } from "../utils/quotes.js";

describe("quote marks", () => {
  it("are all made plain", () => {
    assert.equal(plainQuotes("6MM*8” Bolt"), '6MM*8" Bolt');
    assert.equal(plainQuotes("“Elbow” 2″"), '"Elbow" 2"');
    assert.equal(plainQuotes("O’Ring 3′"), "O'Ring 3'");
    assert.equal(plainQuotes('6MM*8" Bolt'), '6MM*8" Bolt', "plain ones are left alone");
    assert.equal(plainQuotes(null), "");
  });

  it("let either spelling find the other", () => {
    const stored = plainQuotes("6MM*8” Test Bolt MS".toLowerCase());
    assert.ok(stored.includes(plainQuotes('6mm*8"')));
    assert.ok(plainQuotes('6MM*8" Test Bolt'.toLowerCase()).includes(plainQuotes("6mm*8”")));
  });
});
