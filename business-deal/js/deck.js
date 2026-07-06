/* =============================================================================
 * deck.js — Card definitions, deck builder, and shuffle for "Business Deal"
 * -----------------------------------------------------------------------------
 * A faithful model of the 106 playable Monopoly Deal cards (the 4 Quick Start
 * rule cards are excluded). This module is pure data + helpers: no game state,
 * no DOM. It is consumed by game.js (rules engine), ai.js, and ui.js.
 *
 * Every card object carries a stable, unique `id` so the engine can reference
 * cards by identity rather than by array position.
 *
 * Loaded as a plain <script> in the browser (exposes `window.Deck`) and as a
 * CommonJS module in Node (for the headless self-test).
 * ===========================================================================*/
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Deck = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* --------------------------------------------------------------------------
   * Enums / constants
   * ------------------------------------------------------------------------*/

  // Top-level card categories used throughout the engine.
  const CARD_TYPES = {
    MONEY: 'money',
    PROPERTY: 'property',       // a single-color property card
    PROPERTY_WILD: 'wild',      // a property wildcard (2-color or multi-color)
    ACTION: 'action',           // an action card played to the center
    RENT: 'rent',               // a rent card (a kind of action card)
  };

  // Action card sub-types (the `action` field on an action card).
  const ACTIONS = {
    DEAL_BREAKER: 'deal_breaker',
    JUST_SAY_NO: 'just_say_no',
    PASS_GO: 'pass_go',
    FORCED_DEAL: 'forced_deal',
    SLY_DEAL: 'sly_deal',
    DEBT_COLLECTOR: 'debt_collector',
    BIRTHDAY: 'birthday',
    DOUBLE_RENT: 'double_rent',
    HOUSE: 'house',
    HOTEL: 'hotel',
  };

  // Canonical color keys. `railroad` and `utility` are color "sets" too.
  const COLORS = {
    BROWN: 'brown',
    LIGHT_BLUE: 'lightblue',
    PINK: 'pink',
    ORANGE: 'orange',
    RED: 'red',
    YELLOW: 'yellow',
    GREEN: 'green',
    DARK_BLUE: 'darkblue',
    RAILROAD: 'railroad',
    UTILITY: 'utility',
  };

  // Human-readable labels + a display hex (handy later for ui.js).
  const COLOR_META = {
    brown:     { label: 'Brown',      hex: '#7b4b2a' },
    lightblue: { label: 'Light Blue', hex: '#9fd8ef' },
    pink:      { label: 'Pink',       hex: '#d63b8f' },
    orange:    { label: 'Orange',     hex: '#e8821e' },
    red:       { label: 'Red',        hex: '#d22f27' },
    yellow:    { label: 'Yellow',     hex: '#f4d03f' },
    green:     { label: 'Green',      hex: '#2e8b57' },
    darkblue:  { label: 'Dark Blue',  hex: '#1f3a93' },
    railroad:  { label: 'Railroad',   hex: '#2b2b2b' },
    utility:   { label: 'Utility',    hex: '#9aa0a6' },
  };

  // How many property cards complete a full set for each color.
  const SET_REQUIREMENTS = {
    brown: 2,
    darkblue: 2,
    utility: 2,
    lightblue: 3,
    pink: 3,
    orange: 3,
    red: 3,
    yellow: 3,
    green: 3,
    railroad: 4,
  };

  // Rent charged by number of cards owned in the set (index 0 = 1 card, etc.).
  // Values verified against the official Monopoly Deal instruction card.
  const RENT_VALUES = {
    brown:     [1, 2],
    lightblue: [1, 2, 3],
    pink:      [1, 2, 4],
    orange:    [1, 3, 5],
    red:       [2, 3, 6],
    yellow:    [2, 4, 6],
    green:     [2, 4, 7],
    darkblue:  [3, 8],
    railroad:  [1, 2, 3, 4],
    utility:   [1, 2],
  };

  // Buildings add a flat bonus to a full set's rent (not for railroad/utility).
  const HOUSE_RENT_BONUS = 3;
  const HOTEL_RENT_BONUS = 4;
  // Colors that cannot hold buildings.
  const NO_BUILDING_COLORS = [COLORS.RAILROAD, COLORS.UTILITY];

  /* --------------------------------------------------------------------------
   * Card factory — assigns a unique id to every created card.
   * ------------------------------------------------------------------------*/
  let _nextId = 1;
  function makeCard(props) {
    return Object.assign({ id: 'c' + _nextId++ }, props);
  }

  /* --------------------------------------------------------------------------
   * Definitions used to build the deck. Each entry produces `count` cards.
   * ------------------------------------------------------------------------*/

  // 20 Money cards.
  const MONEY_DEFS = [
    { value: 1,  count: 6 },
    { value: 2,  count: 5 },
    { value: 3,  count: 3 },
    { value: 4,  count: 3 },
    { value: 5,  count: 2 },
    { value: 10, count: 1 },
  ];

  // 28 single-color Property cards: { color, value(money), count }.
  // `value` is the card's banking/payment value printed in the corner.
  const PROPERTY_DEFS = [
    { color: COLORS.BROWN,      value: 1, count: 2 },
    { color: COLORS.DARK_BLUE,  value: 4, count: 2 },
    { color: COLORS.UTILITY,    value: 2, count: 2 },
    { color: COLORS.LIGHT_BLUE, value: 1, count: 3 },
    { color: COLORS.PINK,       value: 2, count: 3 },
    { color: COLORS.ORANGE,     value: 2, count: 3 },
    { color: COLORS.RED,        value: 3, count: 3 },
    { color: COLORS.YELLOW,     value: 3, count: 3 },
    { color: COLORS.GREEN,      value: 4, count: 3 },
    { color: COLORS.RAILROAD,   value: 2, count: 4 },
  ];

  // 11 Property wildcards. `colors: 'any'` is the valueless multi-color wild.
  const WILDCARD_DEFS = [
    { colors: [COLORS.DARK_BLUE, COLORS.GREEN],    value: 4, count: 1 },
    { colors: [COLORS.GREEN, COLORS.RAILROAD],     value: 4, count: 1 },
    { colors: [COLORS.UTILITY, COLORS.RAILROAD],   value: 2, count: 1 },
    { colors: [COLORS.LIGHT_BLUE, COLORS.RAILROAD],value: 4, count: 1 },
    { colors: [COLORS.LIGHT_BLUE, COLORS.BROWN],   value: 1, count: 1 },
    { colors: [COLORS.PINK, COLORS.ORANGE],        value: 2, count: 2 },
    { colors: [COLORS.RED, COLORS.YELLOW],         value: 3, count: 2 },
    { colors: 'any',                               value: 0, count: 2 },
  ];

  // 34 Action cards. `value` is the corner (banking) value.
  const ACTION_DEFS = [
    { action: ACTIONS.DEAL_BREAKER,   name: 'Deal Breaker',     value: 5, count: 2 },
    { action: ACTIONS.JUST_SAY_NO,    name: 'Just Say No',      value: 4, count: 3 },
    { action: ACTIONS.PASS_GO,        name: 'Pass Go',          value: 1, count: 10 },
    { action: ACTIONS.FORCED_DEAL,    name: 'Forced Deal',      value: 3, count: 3 },
    { action: ACTIONS.SLY_DEAL,       name: 'Sly Deal',         value: 3, count: 3 },
    { action: ACTIONS.DEBT_COLLECTOR, name: 'Debt Collector',   value: 3, count: 3 },
    // NOTE: CLAUDE.md's action table lists Birthday x2, but its own header
    // states "34 Action Cards" / a 106-card deck — that only reconciles with
    // Birthday x3, which is also the official Monopoly Deal count. Using 3.
    { action: ACTIONS.BIRTHDAY,       name: "It's My Birthday", value: 2, count: 3 },
    { action: ACTIONS.DOUBLE_RENT,    name: 'Double The Rent',  value: 1, count: 2 },
    { action: ACTIONS.HOUSE,          name: 'House',            value: 3, count: 3 },
    { action: ACTIONS.HOTEL,          name: 'Hotel',            value: 4, count: 2 },
  ];

  // 13 Rent cards. Two-color rents charge ALL opponents on one of the two
  // colors; the multi-color wild rent (`colors: 'any'`) charges ONE chosen
  // opponent on any color you own.
  const RENT_DEFS = [
    { colors: [COLORS.DARK_BLUE, COLORS.GREEN],     value: 1, count: 2 },
    { colors: [COLORS.RED, COLORS.YELLOW],          value: 1, count: 2 },
    { colors: [COLORS.PINK, COLORS.ORANGE],         value: 1, count: 2 },
    { colors: [COLORS.LIGHT_BLUE, COLORS.BROWN],    value: 1, count: 2 },
    { colors: [COLORS.RAILROAD, COLORS.UTILITY],    value: 1, count: 2 },
    { colors: 'any',                                value: 3, count: 3 },
  ];

  /* --------------------------------------------------------------------------
   * buildDeck() — materialize every definition into individual card objects.
   * Returns a fresh array of 106 cards in a fixed (unshuffled) order.
   * ------------------------------------------------------------------------*/
  function buildDeck() {
    const deck = [];

    MONEY_DEFS.forEach(def => {
      for (let i = 0; i < def.count; i++) {
        deck.push(makeCard({
          type: CARD_TYPES.MONEY,
          name: def.value + 'M',
          value: def.value,
          canPay: true,
        }));
      }
    });

    PROPERTY_DEFS.forEach(def => {
      const label = COLOR_META[def.color].label;
      for (let i = 0; i < def.count; i++) {
        deck.push(makeCard({
          type: CARD_TYPES.PROPERTY,
          name: label + ' Property',
          color: def.color,
          value: def.value,
          canPay: true,
        }));
      }
    });

    WILDCARD_DEFS.forEach(def => {
      const isMulti = def.colors === 'any';
      const colorList = isMulti ? allPropertyColors() : def.colors.slice();
      const name = isMulti
        ? 'Multi-color Wildcard'
        : colorList.map(c => COLOR_META[c].label).join(' / ') + ' Wildcard';
      for (let i = 0; i < def.count; i++) {
        deck.push(makeCard({
          type: CARD_TYPES.PROPERTY_WILD,
          name: name,
          colors: colorList,         // the colors this wild may represent
          isMulti: isMulti,          // multi-color "any" wild
          value: def.value,          // 0 for multi-color
          canPay: !isMulti,          // multi-color wilds cannot be used to pay
          assignedColor: null,       // set when placed into a collection
        }));
      }
    });

    ACTION_DEFS.forEach(def => {
      for (let i = 0; i < def.count; i++) {
        deck.push(makeCard({
          type: CARD_TYPES.ACTION,
          action: def.action,
          name: def.name,
          value: def.value,
          canPay: true,
        }));
      }
    });

    RENT_DEFS.forEach(def => {
      const isWild = def.colors === 'any';
      const colorList = isWild ? allPropertyColors() : def.colors.slice();
      const name = isWild
        ? 'Wild Rent'
        : colorList.map(c => COLOR_META[c].label).join(' / ') + ' Rent';
      for (let i = 0; i < def.count; i++) {
        deck.push(makeCard({
          type: CARD_TYPES.RENT,
          name: name,
          colors: colorList,   // colors this rent can charge
          isWild: isWild,      // wild rent targets a single opponent
          value: def.value,
          canPay: true,
        }));
      }
    });

    return deck;
  }

  // Every color that can appear on a property (i.e., all set colors).
  function allPropertyColors() {
    return Object.keys(SET_REQUIREMENTS);
  }

  /* --------------------------------------------------------------------------
   * shuffle() — in-place, unbiased Fisher-Yates. Accepts an optional RNG
   * (returning [0,1)) so tests can be made deterministic.
   * ------------------------------------------------------------------------*/
  function shuffle(arr, rng) {
    const rand = rng || Math.random;
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  /* --------------------------------------------------------------------------
   * Small card helpers shared across modules.
   * ------------------------------------------------------------------------*/

  // The colors a card can legally be placed under as a property.
  function placeableColors(card) {
    if (card.type === CARD_TYPES.PROPERTY) return [card.color];
    if (card.type === CARD_TYPES.PROPERTY_WILD) return card.colors.slice();
    return [];
  }

  // Can this card be placed into a property collection at all?
  function isPlaceableProperty(card) {
    return card.type === CARD_TYPES.PROPERTY || card.type === CARD_TYPES.PROPERTY_WILD;
  }

  // Short human-readable description, used by the game log / self-test.
  function describe(card) {
    if (!card) return '(none)';
    if (card.type === CARD_TYPES.MONEY) return card.value + 'M';
    if (card.type === CARD_TYPES.PROPERTY) return COLOR_META[card.color].label + ' property';
    if (card.type === CARD_TYPES.PROPERTY_WILD) return card.name;
    return card.name; // action + rent
  }

  /* --------------------------------------------------------------------------
   * Public surface
   * ------------------------------------------------------------------------*/
  return {
    CARD_TYPES,
    ACTIONS,
    COLORS,
    COLOR_META,
    SET_REQUIREMENTS,
    RENT_VALUES,
    HOUSE_RENT_BONUS,
    HOTEL_RENT_BONUS,
    NO_BUILDING_COLORS,
    buildDeck,
    shuffle,
    allPropertyColors,
    placeableColors,
    isPlaceableProperty,
    describe,
    makeCard,
  };
});
